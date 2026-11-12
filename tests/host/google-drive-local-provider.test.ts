import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeLayoutStamp, SHARED_LAYOUT_FILE } from '../../src/domain/sharing/layout.js';
import { createGoogleDriveLocalProviderDescriptor, type DriveLocationResolver } from '../../src/host/sharing/google-drive-local/descriptor.js';
import { createLocalFolderProviderDescriptor } from '../../src/host/sharing/local-folder-store.js';
import { isWithinPath } from '../../src/host/sharing/local-folder-path.js';
import type { DriveLocationView } from '../../src/shared/types.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), 'kanban-drive-local-'));
  roots.push(created);
  return realpath(created);
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const flow = (name: string): string => ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    label: ' + name, ''].join('\n');
const stamp = (): string => serializeLayoutStamp();

function resolver(rootPath: string, status: DriveLocationView['status'] = 'available') {
  const refreshes: number[] = [];
  const state: { locations: DriveLocationView[] } = { locations: [{ id: rootPath, rootPath, kind: 'account', status, account: 'member@example.test' }] };
  const value: DriveLocationResolver & { refreshes: number[]; state: typeof state } = {
    refreshes,
    state,
    locate: async candidate => {
      const location = state.locations.find(entry => isWithinPath(entry.rootPath, candidate));
      return location === undefined ? undefined : { location, path: candidate };
    },
    roots: async () => ({ state: 'ready', locations: state.locations }),
    refresh: async () => { refreshes.push(1); return { state: 'ready', locations: state.locations }; },
  };
  return value;
}

async function fixture(options: { status?: DriveLocationView['status']; connect?: boolean } = {}) {
  const root = await tempRoot();
  const driveRoot = path.join(root, 'drive');
  const project = path.join(driveRoot, 'Projetos');
  const managed = path.join(root, 'managed');
  await mkdir(project, { recursive: true });
  await mkdir(path.join(managed, 'hub'), { recursive: true });
  const discovery = resolver(driveRoot, options.status ?? 'available');
  const descriptor = createGoogleDriveLocalProviderDescriptor({ discovery, home: root, managedRoot: managed, platform: 'darwin' });
  const binding = options.connect === false ? {} : await descriptor.prepareBinding!({ hubId: 'hub', provider: 'google-drive-local', settings: { path: project } }, []);
  return { root, driveRoot, project, managed, discovery, descriptor, binding };
}

describe('Google Drive Local descriptor', () => {
  it('stores the resolved folder and display labels for a folder inside a location', async () => {
    const f = await fixture();
    expect(f.binding).toEqual(expect.objectContaining({ path: f.project, mountId: f.driveRoot, account: 'member@example.test', folderName: 'Projetos' }));
    expect(f.descriptor.describe({ provider: 'google-drive-local', intervalMinutes: 1, settings: f.binding })).toBe('member@example.test / Projetos');
  });

  it('refuses a folder outside every discovered location', async () => {
    const f = await fixture();
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    await expect(f.descriptor.prepareBinding!({ hubId: 'hub', provider: 'google-drive-local', settings: { path: outside } }, [])).rejects.toMatchObject({ code: 'SHARING_DRIVE_NOT_IN_MOUNT' });
  });

  it('refuses an unavailable location', async () => {
    const f = await fixture({ status: 'unavailable', connect: false });
    await expect(f.descriptor.prepareBinding!({ hubId: 'other', provider: 'google-drive-local', settings: { path: f.project } }, [])).rejects.toMatchObject({ code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE' });
  });

  it('refuses a path that is a file', async () => {
    const f = await fixture();
    const file = path.join(f.driveRoot, 'note.txt');
    await writeFile(file, 'x', 'utf8');
    await expect(f.descriptor.prepareBinding!({ hubId: 'hub', provider: 'google-drive-local', settings: { path: file } }, [])).rejects.toMatchObject({ code: 'SHARING_FOLDER_NOT_DIRECTORY' });
  });

  it('refuses a folder already bound to another Hub', async () => {
    const f = await fixture();
    await expect(f.descriptor.prepareBinding!(
      { hubId: 'other', provider: 'google-drive-local', settings: { path: f.project } },
      [{ hubId: 'hub', provider: 'google-drive-local', settings: f.binding }],
    )).rejects.toMatchObject({ code: 'SHARING_ADDRESS_IN_USE' });
  });

  it('refuses a folder another filesystem-backed storage already bound', async () => {
    const f = await fixture();
    await expect(f.descriptor.prepareBinding!(
      { hubId: 'other', provider: 'google-drive-local', settings: { path: f.project } },
      [{ hubId: 'hub', provider: 'local-folder', settings: { path: f.project } }],
    )).rejects.toMatchObject({ code: 'SHARING_ADDRESS_IN_USE' });
  });

  it('refuses a folder the local folder storage already bound', async () => {
    const f = await fixture();
    const local = createLocalFolderProviderDescriptor({ home: f.root, platform: 'darwin' });
    await expect(local.prepareBinding!(
      { hubId: 'other', provider: 'local-folder', settings: { path: f.project } },
      [{ hubId: 'hub', provider: 'google-drive-local', settings: f.binding }],
    )).rejects.toMatchObject({ code: 'SHARING_ADDRESS_IN_USE' });
  });

  it('names the unsupported platform and the missing application', async () => {
    const f = await fixture();
    for (const [state, code] of [['unsupported', 'SHARING_DRIVE_UNSUPPORTED'], ['app-missing', 'SHARING_DRIVE_APP_MISSING']] as const) {
      const discovery: DriveLocationResolver = {
        locate: async () => undefined,
        roots: async () => ({ state, locations: [] }),
        refresh: async () => ({ state, locations: [] }),
      };
      const descriptor = createGoogleDriveLocalProviderDescriptor({ discovery, home: f.root, platform: 'darwin' });
      await expect(descriptor.prepareBinding!({ hubId: 'hub', provider: 'google-drive-local', settings: { path: f.project } }, [])).rejects.toMatchObject({ code });
    }
  });

  it('refuses the managed publishing workspace', async () => {
    const f = await fixture();
    await expect(f.descriptor.prepareBinding!({ hubId: 'other', provider: 'google-drive-local', settings: { path: path.join(f.managed, 'hub') } }, [])).rejects.toMatchObject({ code: 'SHARING_FOLDER_RESERVED' });
  });

  it('rejects empty settings and drops unknown keys', async () => {
    const f = await fixture();
    expect(() => f.descriptor.normalizeSettings({})).toThrow();
    expect(f.descriptor.normalizeSettings({ path: '/drive/folder', account: 'member@example.test', extra: 'x' })).toEqual({ path: '/drive/folder', account: 'member@example.test' });
  });

  it('declares its default interval without authorization', async () => {
    const f = await fixture();
    expect(f.descriptor).toMatchObject({ id: 'google-drive-local', defaultIntervalMinutes: 1, requiresAuthorization: false });
  });
});

describe('Google Drive Local store', () => {
  it('writes and reads the layout stamp through the shared directory engine', async () => {
    const f = await fixture();
    const store = f.descriptor.createLayoutStore('hub', { provider: 'google-drive-local', intervalMinutes: 1, settings: f.binding }, {});
    await store.writeStamp(4, { expectedVersion: null });
    expect((await readFile(path.join(f.project, SHARED_LAYOUT_FILE), 'utf8')).length).toBeGreaterThan(0);
    await expect(store.readStamp()).resolves.toEqual({ version: 4 });
  });

  it('reports an unavailable mount when the location disappears, then resumes', async () => {
    const f = await fixture();
    const store = f.descriptor.createLayoutStore('hub', { provider: 'google-drive-local', intervalMinutes: 1, settings: f.binding }, {});
    await store.writeStamp(4, { expectedVersion: null });
    await rm(f.driveRoot, { recursive: true, force: true });
    await expect(store.readStamp()).rejects.toMatchObject({ code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE' });
    expect(f.discovery.refreshes.length).toBeGreaterThan(0);
    await mkdir(f.project, { recursive: true });
    await writeFile(path.join(f.project, SHARED_LAYOUT_FILE), stamp(), 'utf8');
    await expect(store.readStamp()).resolves.toEqual({ version: 4 });
  });

  it('refuses a folder replaced by a symlink that points outside the location', async () => {
    const f = await fixture();
    const store = f.descriptor.createLayoutStore('hub', { provider: 'google-drive-local', intervalMinutes: 1, settings: f.binding }, {});
    await store.writeStamp(4, { expectedVersion: null });
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    await rm(f.project, { recursive: true, force: true });
    await symlink(outside, f.project);
    await expect(store.readStamp()).rejects.toMatchObject({ code: 'SHARING_DRIVE_NOT_IN_MOUNT' });
  });

  it('refuses a location that discovery no longer reports while its directory remains', async () => {
    const f = await fixture();
    const store = f.descriptor.createLayoutStore('hub', { provider: 'google-drive-local', intervalMinutes: 1, settings: f.binding }, {});
    await store.writeStamp(4, { expectedVersion: null });
    f.discovery.state.locations = [];
    await expect(store.readStamp()).rejects.toMatchObject({ code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE' });
  });

  it('reports a missing folder when the location is still mounted', async () => {
    const f = await fixture();
    const store = f.descriptor.createLayoutStore('hub', { provider: 'google-drive-local', intervalMinutes: 1, settings: f.binding }, {});
    await rm(f.project, { recursive: true, force: true });
    await expect(store.readStamp()).rejects.toMatchObject({ code: 'SHARING_FOLDER_MISSING' });
  });
});
