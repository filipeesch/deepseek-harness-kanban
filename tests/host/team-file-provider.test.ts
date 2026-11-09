import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharingProviderRegistry } from '../../src/host/sharing/provider.js';
import { createGitProviderDescriptor } from '../../src/host/sharing/git-store.js';
import { createGoogleDriveProviderDescriptor } from '../../src/host/sharing/google-drive-store.js';
import { createGoogleDriveLocalProviderDescriptor } from '../../src/host/sharing/google-drive-local/descriptor.js';
import { createLocalFolderProviderDescriptor } from '../../src/host/sharing/local-folder-store.js';
import { DirectoryTeamFileStore } from '../../src/host/sharing/team-file-directory.js';
import { GitTeamFileStore } from '../../src/host/sharing/git-team-file-store.js';
import type { DriveDiscoveryView } from '../../src/shared/types.js';

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-team-provider-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function discoveryFor(locations: DriveDiscoveryView['locations']) {
  const view: DriveDiscoveryView = { state: locations.length === 0 ? 'app-missing' : 'available', locations } as DriveDiscoveryView;
  return { locate: async () => undefined, roots: async () => view, refresh: async () => view };
}

function registry(root: string): SharingProviderRegistry {
  return new SharingProviderRegistry([
    createGitProviderDescriptor({ root }),
    createGoogleDriveProviderDescriptor({ auth: { accessToken: async () => 'token' } }),
    createLocalFolderProviderDescriptor({ home: root }),
    createGoogleDriveLocalProviderDescriptor({ discovery: discoveryFor([]), home: root }),
  ]);
}

describe('storage descriptors and team files', () => {
  it('reports file support from the descriptor, not from a stored flag', () => {
    const providers = registry('/tmp/dsh-team-registry');
    expect(providers.supportsFiles('git')).toBe(true);
    expect(providers.supportsFiles('local-folder')).toBe(true);
    expect(providers.supportsFiles('google-drive-local')).toBe(true);
    expect(providers.supportsFiles('google-drive')).toBe(false);
    const folder = providers.describe({ provider: 'local-folder', intervalMinutes: 1, settings: { path: '/tmp/folder' } });
    expect(folder.supportsFiles).toBe(true);
    const drive = providers.describe({ provider: 'google-drive', intervalMinutes: 1, settings: { folderId: 'folder-1234567890' } });
    expect(drive.supportsFiles).toBe(false);
  });

  it('creates a directory store for a local folder and for a Google Drive Local folder', async () => {
    const root = await temporary();
    const providers = registry(root);
    const folder = providers.createFileStore('hub-1', { provider: 'local-folder', intervalMinutes: 1, settings: { path: root } }, {});
    expect(folder).toBeInstanceOf(DirectoryTeamFileStore);
    expect((folder as DirectoryTeamFileStore).path).toBe(path.join(root, 'team-files'));
    const driveLocal = providers.createFileStore('hub-1', { provider: 'google-drive-local', intervalMinutes: 1, settings: { path: root, mountId: root } }, {});
    expect(driveLocal).not.toBeInstanceOf(DirectoryTeamFileStore);
  });

  it('creates a Git store inside the managed clone and offers no store for Google Drive Cloud', async () => {
    const root = await temporary();
    const providers = registry(root);
    const git = providers.createFileStore('hub-1', { provider: 'git', intervalMinutes: 5, settings: { repository: 'git@example.com:team/repo.git' } }, {});
    expect(git).toBeInstanceOf(GitTeamFileStore);
    expect((git as GitTeamFileStore).path).toBe(path.join(root, 'hub-1', 'team-files'));
    const drive = providers.createFileStore('hub-1', { provider: 'google-drive', intervalMinutes: 1, settings: { folderId: 'folder-1234567890' } }, {});
    expect(drive).toBeUndefined();
  });

  it('re-proves the Drive location before every file operation', async () => {
    const root = await temporary();
    const bounds = { provider: 'google-drive-local' as const, intervalMinutes: 1, settings: { path: root, mountId: root } };

    const unlisted = createGoogleDriveLocalProviderDescriptor({ discovery: discoveryFor([]), home: root });
    const rejected = unlisted.createFileStore!('hub-1', bounds, {});
    await expect(rejected.list()).rejects.toMatchObject({ code: 'SHARING_DRIVE_MOUNT_UNAVAILABLE' });

    const listed = createGoogleDriveLocalProviderDescriptor({ discovery: discoveryFor([{ rootPath: root, account: 'member@example.test', driveName: 'My Drive', status: 'available' } as never]), home: root });
    const accepted = listed.createFileStore!('hub-1', bounds, {});
    await accepted.ensure();
    expect(await lstat(path.join(root, 'team-files'))).toBeTruthy();
    expect(await accepted.list()).toEqual([]);
  });
});
