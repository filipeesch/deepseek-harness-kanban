import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { SHARED_DOCUMENT_FILE } from '../../src/domain/sharing/document.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { GoogleDriveLocalDiscovery } from '../../src/host/sharing/google-drive-local/discovery.js';
import { nodeDiscoveryFs } from '../../src/host/sharing/google-drive-local/filesystem.js';
import type { DriveDiscoveryAdapter } from '../../src/host/sharing/google-drive-local/platform.js';
import { openHubSharing } from '../../src/index.js';
import { MemoryHubStorage } from './helpers.js';

function facility() {
  let closings = 0;
  const ctx = {
    storageDomain: {
      async open() {
        return {
          table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator](), keys: () => [][Symbol.iterator](), get size() { return 0; }, put: async () => {}, delete: async () => {}, update: async () => {} }),
          close: async () => { closings++; },
        };
      },
    },
  } as unknown as Context;
  return { ctx, get closings() { return closings; } };
}

const flow = (name: string): string => ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    label: ' + name, ''].join('\n');

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kanban-drive-runtime-')));
  roots.push(root);
  const driveRoot = path.join(root, 'Drive');
  const folder = path.join(driveRoot, 'Projetos');
  await mkdir(folder, { recursive: true });
  const adapter: DriveDiscoveryAdapter = {
    model: 'macos',
    async discover() {
      return { model: 'macos', mounts: [{ id: driveRoot, rootPath: driveRoot, kind: 'account', account: 'member@example.test' }], sources: [{ id: 'cloud-storage', ok: true }], applicationDetected: true };
    },
  };
  const discovery = new GoogleDriveLocalDiscovery({ adapter, fs: nodeDiscoveryFs, cacheMs: 0 });
  const f = facility();
  const hubs = await HubRepository.open(new MemoryHubStorage());
  const runtime = await openHubSharing(f.ctx, hubs, { root: path.join(root, 'managed'), home: root, discovery, report: () => {} });
  return { root, driveRoot, folder, runtime, hubs, f };
}

describe('Google Drive Local runtime wiring', () => {
  it('connects a discovered folder and publishes the document', async () => {
    const f = await fixture();
    const hubId = f.hubs.defaultHubId();
    await f.runtime.service.connect({ type: 'sharing.connect', hubId, provider: 'google-drive-local', settings: { path: f.folder } });
    const written = await readFile(path.join(f.folder, SHARED_DOCUMENT_FILE), 'utf8');
    expect(written).toContain('boards:');
    expect(f.runtime.service.view(hubId)).toMatchObject({ provider: 'google-drive-local', providerLabel: 'Google Drive Local', syncMode: 'continuous', intervalMinutes: 1 });
    await f.runtime.close();
    expect(f.f.closings).toBe(1);
    await f.hubs.close();
  });

  it('refuses the same folder for a second Hub', async () => {
    const f = await fixture();
    const first = f.hubs.defaultHubId();
    const second = (await f.hubs.createHub('Second')).id;
    await f.runtime.service.connect({ type: 'sharing.connect', hubId: first, provider: 'google-drive-local', settings: { path: f.folder } });
    await expect(f.runtime.service.connect({ type: 'sharing.connect', hubId: second, provider: 'google-drive-local', settings: { path: f.folder } })).rejects.toMatchObject({ code: 'SHARING_ADDRESS_IN_USE' });
    await f.runtime.close();
    await f.hubs.close();
  });

  it('adopts an existing document through the preview', async () => {
    const f = await fixture();
    await writeFile(path.join(f.folder, SHARED_DOCUMENT_FILE), ['version: 1', 'boards:', '  - key: flow', '    name: Team', '    workflow: "name: Flow\\ninitial_column: backlog\\ncolumns:\\n  - id: backlog\\n    label: Backlog\\n"', ''].join('\n'), 'utf8');
    const hubId = f.hubs.defaultHubId();
    await f.runtime.service.connect({ type: 'sharing.connect', hubId, provider: 'google-drive-local', settings: { path: f.folder } });
    expect(f.runtime.service.view(hubId)?.status).toBe('preview');
    await f.runtime.close();
    await f.hubs.close();
  });

  it('reports mount loss, keeps drafts, and resumes when the path returns', async () => {
    const f = await fixture();
    const hubId = f.hubs.defaultHubId();
    await f.runtime.service.connect({ type: 'sharing.connect', hubId, provider: 'google-drive-local', settings: { path: f.folder } });
    const board = f.hubs.requireHub(hubId).boards[0]!;
    await f.hubs.hub(hubId).saveBoardWorkflow(board.id, flow('Local'), f.hubs.requireHub(hubId).revision);
    expect(f.runtime.service.view(hubId)?.drafts).toBe(1);
    const published = await readFile(path.join(f.folder, SHARED_DOCUMENT_FILE), 'utf8');
    await rm(f.driveRoot, { recursive: true, force: true });
    await expect(f.runtime.service.check(hubId)).rejects.toMatchObject({ code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE' });
    const unavailable = f.runtime.service.view(hubId)!;
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.drafts).toBe(1);
    await mkdir(f.folder, { recursive: true });
    await writeFile(path.join(f.folder, SHARED_DOCUMENT_FILE), published, 'utf8');
    await f.runtime.service.check(hubId);
    const recovered = f.runtime.service.view(hubId)!;
    expect(recovered.status).toBe('published');
    expect(recovered.drafts).toBe(0);
    expect(await readFile(path.join(f.folder, SHARED_DOCUMENT_FILE), 'utf8')).toContain('Local');
    await f.runtime.close();
    await f.hubs.close();
  });

  it('exposes roots and browsing through the discovery service', async () => {
    const f = await fixture();
    const rootsView = await f.runtime.discovery.roots();
    expect(rootsView.locations).toHaveLength(1);
    const page = await f.runtime.discovery.browse(f.driveRoot);
    expect(page.entries).toEqual([{ name: 'Projetos', path: f.folder }]);
    await f.runtime.close();
    await f.hubs.close();
  });
});
