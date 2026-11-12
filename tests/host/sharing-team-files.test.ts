import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HubRepository } from '../../src/host/hub-repository.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import { SharingProviderRegistry, type ProviderDescription, type SharingBinding, type SharingProviderId, type SharingProviderResolver } from '../../src/host/sharing/provider.js';
import { createGitProviderDescriptor } from '../../src/host/sharing/git-store.js';
import { createGoogleDriveProviderDescriptor } from '../../src/host/sharing/google-drive-store.js';
import { createLocalFolderProviderDescriptor } from '../../src/host/sharing/local-folder-store.js';
import { MemoryLayoutStore } from '../support/memory-layout-store.js';
import type { AppendOptions, BoardLogSnapshot } from '../../src/host/sharing/ports.js';
import type { BoardChange } from '../../src/domain/journal/event.js';
import type { BoardLog } from '../../src/domain/journal/log.js';
import type { HubSharingRecord, HubSharingStore } from '../../src/host/sharing/state.js';
import { TeamFiles } from '../../src/host/team-files/service.js';
import { DirectoryTeamFileStore, TeamFileDirectory } from '../../src/host/sharing/team-file-directory.js';
import type { TeamFileContent, TeamFileEntry, TeamFileReadOptions, TeamFileStore, TeamFileWrite, TeamFileWriteOptions } from '../../src/host/sharing/team-file-store.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
const roots: string[] = [];

async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-team-sharing-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function memorySharingStore(): HubSharingStore {
  const records = new Map<string, HubSharingRecord>();
  return {
    load: id => { const value = records.get(id); return value === undefined ? undefined : structuredClone(value); },
    list: () => [...records.values()].map(value => structuredClone(value)),
    save: async value => { records.set(value.hubId, structuredClone(value)); },
    delete: async id => { records.delete(id); },
    close: async () => {},
  };
}

function memoryLayout(): MemoryLayoutStore {
  return new MemoryLayoutStore();
}

function descriptionOf(binding: SharingBinding, supportsFiles: boolean): ProviderDescription {
  return {
    id: binding.provider,
    label: binding.provider === 'google-drive' ? 'Google Drive' : 'Local folder',
    address: binding.settings.path ?? binding.settings.folderId ?? '',
    defaultIntervalMinutes: 1,
    requiresAuthorization: false,
    supportsFiles,
  };
}

/** A narrow resolver: it binds a location but offers no file store. */
function resolverWithoutFiles(): SharingProviderResolver {
  return {
    createLayoutStore: () => memoryLayout(),
    describe: binding => descriptionOf(binding, false),
    prepare: async (_hubId, binding) => binding,
    normalize: (_provider: SharingProviderId, settings) => settings,
    defaultInterval: () => 1,
  };
}

async function hubs(): Promise<{ hubs: HubRepository; hubId: string }> {
  const repository = await HubRepository.open(new MemoryHubStorage(), { id: (() => { let n = 0; return () => 'id-' + (++n); })(), now: () => NOW });
  return { hubs: repository, hubId: repository.defaultHubId() };
}

function providersFor(base: string): SharingProviderRegistry {
  return new SharingProviderRegistry([
    createGitProviderDescriptor({ root: path.join(base, 'shared'), runner: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    createGoogleDriveProviderDescriptor({ auth: { accessToken: async () => 'token' } }),
    createLocalFolderProviderDescriptor({ home: base }),
  ]);
}

async function boundToFolder(): Promise<{ repository: { hubs: HubRepository; hubId: string }; service: HubSharingService; files: TeamFiles; bound: string; sharingStore: HubSharingStore }> {
  const base = await temporary();
  const bound = path.join(base, 'team');
  await mkdir(bound);
  const repository = await hubs();
  const sharingStore = memorySharingStore();
  const service = new HubSharingService({ hubs: repository.hubs, store: sharingStore, providers: providersFor(base), now: () => NOW, debounceMs: 1 });
  await service.connect({ type: 'sharing.connect', hubId: repository.hubId, provider: 'local-folder', settings: { path: bound }, intervalMinutes: 0 });
  const files = new TeamFiles({ store: hubId => service.fileStoreFor(hubId), exclusive: (hubId, operation) => service.exclusive(hubId, operation) });
  return { repository, service, files, bound, sharingStore };
}

describe('team files on a bound Hub', () => {
  it('round-trips a document through the real folder binding and leaves every other entry alone', async () => {
    const { repository, files, bound, sharingStore } = await boundToFolder();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(bound, 'unrelated.txt'), 'not ours', 'utf8');
    const before = await readFile(path.join(bound, 'kanban-hub.yaml'), 'utf8').catch(() => null);
    const recordBefore = JSON.stringify(sharingStore.load(repository.hubId));

    const created = await files.create(repository.hubId, { path: 'docs/guide.md', content: 'hello team' });
    expect(created.size).toBe(10);
    const found = await files.search(repository.hubId, { content: 'team' });
    expect(found.matches).toEqual([{ path: 'docs/guide.md', line: 1, text: 'hello team' }]);
    const read = await files.read(repository.hubId, { path: 'docs/guide.md' });
    expect(read.lines).toEqual([{ number: 1, text: 'hello team' }]);
    await files.edit(repository.hubId, { path: 'docs/guide.md', edits: [{ old: 'hello', new: 'olá' }] });
    expect(await readFile(path.join(bound, 'team-files', 'docs', 'guide.md'), 'utf8')).toBe('olá team');
    const removed = await files.remove(repository.hubId, { path: 'docs/guide.md', confirmed: true });
    expect(removed.trashPath.startsWith('.trash/docs/guide.md.')).toBe(true);
    expect((await files.search(repository.hubId, {})).paths).toEqual([]);

    expect(await readFile(path.join(bound, 'unrelated.txt'), 'utf8')).toBe('not ours');
    expect(await readFile(path.join(bound, 'kanban-hub.yaml'), 'utf8').catch(() => null)).toBe(before);
    // A team file write never touches the document, its token, or the publishing record.
    expect(JSON.stringify(sharingStore.load(repository.hubId))).toBe(recordBefore);
    expect((await readdir(bound)).sort()).toEqual(['kanban-boards', 'kanban-hub.yaml', 'team-files', 'unrelated.txt']);
  });

  it('keeps populated team files when the Hub is disconnected', async () => {
    const { repository, service, files, bound } = await boundToFolder();
    await files.create(repository.hubId, { path: 'docs/keep.md', content: 'kept' });
    await service.disconnect(repository.hubId);
    expect(await readFile(path.join(bound, 'team-files', 'docs', 'keep.md'), 'utf8')).toBe('kept');
    expect(await readFile(path.join(bound, 'kanban-hub.yaml'), 'utf8')).toContain('version');
  });

  it('refuses an unbound Hub and a storage without file support', async () => {
    const base = await temporary();
    const bound = path.join(base, 'team');
    await mkdir(bound);
    const repository = await hubs();
    const service = new HubSharingService({ hubs: repository.hubs, store: memorySharingStore(), providers: resolverWithoutFiles(), now: () => NOW, debounceMs: 1 });
    const files = new TeamFiles({ store: hubId => service.fileStoreFor(hubId), exclusive: (hubId, operation) => service.exclusive(hubId, operation) });
    await expect(files.search(repository.hubId, {})).rejects.toMatchObject({ code: 'TEAM_FILES_UNAVAILABLE' });
    await service.connect({ type: 'sharing.connect', hubId: repository.hubId, provider: 'local-folder', settings: { path: bound }, intervalMinutes: 0 });
    await expect(files.search(repository.hubId, {})).rejects.toMatchObject({ code: 'TEAM_FILES_UNSUPPORTED' });
    await expect(files.search(repository.hubId, {})).rejects.toThrow('Local folder');
  });

  it('names the storage that cannot serve files', async () => {
    const repository = await hubs();
    const service = new HubSharingService({ hubs: repository.hubs, store: memorySharingStore(), providers: resolverWithoutFiles(), now: () => NOW, debounceMs: 1 });
    await service.connect({ type: 'sharing.connect', hubId: repository.hubId, provider: 'google-drive', settings: { folderId: 'folder-1234567890' }, intervalMinutes: 0 });
    const files = new TeamFiles({ store: hubId => service.fileStoreFor(hubId), exclusive: (hubId, operation) => service.exclusive(hubId, operation) });
    await expect(files.read(repository.hubId, { path: 'docs/a.md' })).rejects.toThrow('Google Drive');
  });

  it('serializes a whole team file write against document work in both directions', async () => {
    const { repository, service } = await boundToFolder();
    const order: string[] = [];
    // Record at the moment the lane admits the write, not when its promise settles.
    const files = new TeamFiles({
      store: hubId => service.fileStoreFor(hubId),
      exclusive: (hubId, operation) => service.exclusive(hubId, async () => { order.push('write'); return operation(); }),
    });
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = service.exclusive(repository.hubId, async () => { await gate; order.push('document-1'); });
    const write = files.create(repository.hubId, { path: 'docs/serial.md', content: 'x' });
    const second = service.exclusive(repository.hubId, async () => { order.push('document-2'); });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(order).toEqual([]);
    expect(service.busy(repository.hubId)).toBe(true);
    release();
    await Promise.all([first, write, second]);
    expect(order).toEqual(['document-1', 'write', 'document-2']);
    expect(service.busy(repository.hubId)).toBe(false);
  });

  it('queues a real document publish behind a team file write that holds the lane', async () => {
    const base = await temporary();
    const bound = path.join(base, 'team');
    await mkdir(bound);

    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const log: string[] = [];

    class RecordingLayout extends MemoryLayoutStore {
      constructor() { super({ version: 4 }); }
      override async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
        log.push('publish');
        return super.appendChanges(key, changes, options);
      }
      override async createLog(key: string, logValue: BoardLog): Promise<BoardLogSnapshot> {
        log.push('publish');
        return super.createLog(key, logValue);
      }
    }

    class BlockingFileStore implements TeamFileStore {
      constructor(private readonly inner: TeamFileStore) {}
      async ensure(): Promise<void> { await this.inner.ensure(); }
      async list(): Promise<TeamFileEntry[]> { return this.inner.list(); }
      async read(relative: string, options?: TeamFileReadOptions): Promise<TeamFileContent | null> { return this.inner.read(relative, options); }
      async create(relative: string, content: string): Promise<TeamFileWrite> { await gate; log.push('team-file-write'); return this.inner.create(relative, content); }
      async write(relative: string, content: string, options: TeamFileWriteOptions): Promise<TeamFileWrite> { return this.inner.write(relative, content, options); }
      async move(from: string, to: string, options: TeamFileWriteOptions): Promise<{ path: string }> { return this.inner.move(from, to, options); }
    }

    const document = new RecordingLayout();
    const fileStore = new BlockingFileStore(new DirectoryTeamFileStore(new TeamFileDirectory(path.join(bound, 'team-files'))));
    const providers: SharingProviderResolver = {
      createLayoutStore: () => document,
      createFileStore: () => fileStore,
      describe: binding => descriptionOf(binding, true),
      prepare: async (_hubId, binding) => binding,
      normalize: (_provider: SharingProviderId, settings) => settings,
      defaultInterval: () => 0,
    };
    const repository = await hubs();
    const service = new HubSharingService({ hubs: repository.hubs, store: memorySharingStore(), providers, now: () => NOW, debounceMs: 1 });
    await service.connect({ type: 'sharing.connect', hubId: repository.hubId, provider: 'local-folder', settings: { path: bound }, intervalMinutes: 0 });
    // A local workflow change makes the Hub dirty, so the publish really writes.
    const board = repository.hubs.requireHub(repository.hubId).boards[0]!;
    await repository.hubs.hub(repository.hubId).renameBoard(board.id, 'Renamed');
    log.length = 0;
    const files = new TeamFiles({ store: hubId => service.fileStoreFor(hubId), exclusive: (hubId, operation) => service.exclusive(hubId, operation) });

    const write = files.create(repository.hubId, { path: 'docs/order.md', content: 'x' });
    await new Promise(resolve => setTimeout(resolve, 20));
    const publish = service.publishBoard(repository.hubId, board.id);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(log).toEqual([]);
    release();
    await Promise.all([write, publish]);
    expect(log).toEqual(['team-file-write', 'publish']);
  });

  it('keeps two concurrent edits from overwriting each other', async () => {
    const { repository, files } = await boundToFolder();
    await files.create(repository.hubId, { path: 'docs/race.md', content: 'shared text' });
    const settled = await Promise.allSettled([
      files.edit(repository.hubId, { path: 'docs/race.md', edits: [{ old: 'shared', new: 'first' }] }),
      files.edit(repository.hubId, { path: 'docs/race.md', edits: [{ old: 'shared', new: 'second' }] }),
    ]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? (rejected.reason as { code?: string }).code : undefined).toBe('TEAM_FILE_EDIT_CONFLICT');
  });

  it('resolves the binding inside the lane, so a write queued behind a disconnect fails', async () => {
    const { repository, service, files } = await boundToFolder();
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holding = service.exclusive(repository.hubId, async () => { await gate; order.push('held'); });
    const disconnect = service.disconnect(repository.hubId).then(() => { order.push('disconnect'); });
    const write = files.create(repository.hubId, { path: 'docs/late.md', content: 'x' });
    release();
    await Promise.all([holding, disconnect]);
    await expect(write).rejects.toMatchObject({ code: 'TEAM_FILES_UNAVAILABLE' });
    expect(order).toEqual(['held', 'disconnect']);
  });
});
