import { describe, expect, it } from 'vitest';
import { sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { KanbanError } from '../../src/shared/errors.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import type { SharingBinding, SharingProviderResolver } from '../../src/host/sharing/provider.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import type { SharedConfigStore } from '../../src/host/sharing/store.js';
import type { HubSharingRecord, HubSharingStore } from '../../src/host/sharing/state.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
const flow = (name: string): string => ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    label: ' + name, ''].join('\n');
const documentOf = (name: string): SharedHubDocument => ({ version: 1, boards: [{ key: 'flow', name, workflow: flow(name) }] });

class FakeStore implements SharedConfigStore {
  document: SharedHubDocument | null;
  token: string | null;
  constructor(seed?: SharedHubDocument) { this.document = seed === undefined ? null : structuredClone(seed); this.token = seed === undefined ? null : sharedDocumentToken(seed); }
  async ensure(): Promise<void> {}
  async read(): Promise<{ token: string; document: SharedHubDocument } | null> { return this.document === null || this.token === null ? null : { token: this.token, document: structuredClone(this.document) }; }
  async write(document: SharedHubDocument, options: { expectedToken: string | null }): Promise<{ token: string }> {
    if ((this.token ?? null) !== (options.expectedToken ?? null)) throw new KanbanError('SHARING_STALE_TOKEN', 'stale');
    this.document = structuredClone(document); this.token = sharedDocumentToken(document); return { token: this.token };
  }
  async destroy(): Promise<void> {}
}

function memoryStore(): HubSharingStore {
  const records = new Map<string, HubSharingRecord>();
  return {
    load: hubId => { const value = records.get(hubId); return value === undefined ? undefined : structuredClone(value); },
    list: () => [...records.values()].map(value => structuredClone(value)),
    save: async value => { records.set(value.hubId, structuredClone(value)); },
    delete: async hubId => { records.delete(hubId); },
    close: async () => {},
  };
}

async function fixture(seed: Record<string, SharedHubDocument> = {}) {
  const hubs = await HubRepository.open(new MemoryHubStorage(), { now: () => NOW });
  const hubId = hubs.defaultHubId();
  const board = hubs.requireHub(hubId).boards[0]!;
  const stores = new Map<string, FakeStore>();
  const storeFor = (key: string): FakeStore => {
    const existing = stores.get(key);
    if (existing) return existing;
    const store = new FakeStore(seed[key]);
    stores.set(key, store);
    return store;
  };
  const providers: SharingProviderResolver = {
    create: (_hubId, binding: SharingBinding): SharedConfigStore => storeFor(binding.settings.path ?? binding.settings.repository ?? ''),
    describe: binding => ({
      id: binding.provider,
      label: binding.provider === 'google-drive-local' ? 'Google Drive Local' : 'Git repository',
      address: binding.settings.path ?? binding.settings.repository ?? '',
      syncMode: binding.provider === 'google-drive-local' ? 'continuous' : 'explicit',
      defaultIntervalMinutes: binding.provider === 'google-drive-local' ? 1 : 5,
      requiresAuthorization: false,
    }),
    normalize: (_provider, settings) => settings,
    defaultInterval: provider => provider === 'google-drive-local' ? 1 : 5,
    prepare: async (hubId, binding, existing) => {
      const path = binding.settings.path;
      if (path !== undefined && existing.some(record => record.hubId !== hubId
        && (record.provider === 'google-drive-local' || record.provider === 'local-folder')
        && record.settings.path === path)) throw new KanbanError('SHARING_ADDRESS_IN_USE', 'The selected folder is already bound to another Hub.');
      return binding;
    },
  };
  const sharingStore = memoryStore();
  const service = new HubSharingService({ hubs, store: sharingStore, providers, now: () => NOW });
  return { hubs, hubId, board, stores, service, sharingStore, record: () => sharingStore.load(hubId) };
}

describe('changing a Google Drive Local folder', () => {
  it('returns a typed refusal without confirmation', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: f.hubId, provider: 'google-drive-local', settings: { path: '/mount/one' } });
    await expect(f.service.command({ type: 'sharing.changeLocation', hubId: f.hubId, settings: { path: '/mount/two' }, confirmed: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('moves to an empty folder and publishes the local configuration', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: f.hubId, provider: 'google-drive-local', settings: { path: '/mount/one' } });
    const hub = f.hubs.requireHub(f.hubId);
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.board.id, flow('Local'), hub.revision);
    await f.service.command({ type: 'sharing.changeLocation', hubId: f.hubId, settings: { path: '/mount/two' }, confirmed: true });
    const record = f.record()!;
    expect(record.binding).toMatchObject({ provider: 'google-drive-local', settings: { path: '/mount/two' } });
    expect(f.stores.get('/mount/two')?.document?.boards[0]?.workflow).toBe(flow('Local'));
    expect(f.hubs.requireHub(f.hubId).boards.map(board => board.name)).toEqual([f.board.name]);
    expect(f.hubs.requireHub(f.hubId).boards[0]?.workflowYaml).toBe(flow('Local'));
    expect(Object.keys(record.bindings)).toHaveLength(1);
  });

  it('previews a folder that already has a published document', async () => {
    const f = await fixture({ '/mount/team': documentOf('Team') });
    await f.service.connect({ type: 'sharing.connect', hubId: f.hubId, provider: 'google-drive-local', settings: { path: '/mount/one' } });
    await f.service.command({ type: 'sharing.changeLocation', hubId: f.hubId, settings: { path: '/mount/team' }, confirmed: true });
    const record = f.record()!;
    expect(record.preview).not.toBeNull();
    expect(record.base).toBeNull();
    expect(record.bindings).toEqual({});
    expect(f.service.view(f.hubId)?.status).toBe('preview');
    expect(f.stores.get('/mount/team')?.document).toBeDefined();
  });

  it('refuses a folder change on another storage', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: f.hubId, repository: '/team/repo' });
    await expect(f.service.command({ type: 'sharing.changeLocation', hubId: f.hubId, settings: { path: '/mount/two' }, confirmed: true })).rejects.toMatchObject({ code: 'SHARING_UNSUPPORTED_STORAGE' });
  });

  it('keeps real tasks and notes, and resets publishing keys', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: f.hubId, provider: 'google-drive-local', settings: { path: '/mount/one' } });
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).transact(draft => {
      draft.projects.push({ id: 'project-1', name: 'Project', projectPath: '/repo' });
      draft.tasks.push({
        id: 'task-1', boardId: f.board.id, projectId: 'project-1', title: 'Keep me', description: 'Body', columnId: f.board.workflow.initialColumnId,
        position: 1, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: NOW, updatedAt: NOW,
      });
      draft.notes.push({ id: 'note-1', taskId: 'task-1', content: 'Keep this note', createdAt: NOW, updatedAt: NOW });
    }, revision);
    const record = f.record()!;
    await f.sharingStore.save({
      ...record,
      orphans: { orphan: { lastKey: 'orphan', lastPublishedName: 'Old' } },
      removed: { gone: { boardId: 'board-gone', name: 'Gone' } },
      pendingRemovals: ['gone'],
    });
    const before = f.hubs.snapshot();
    await f.service.command({ type: 'sharing.changeLocation', hubId: f.hubId, settings: { path: '/mount/two' }, confirmed: true });
    const after = f.hubs.snapshot();
    expect(after.hubs[0]?.tasks).toEqual(before.hubs[0]?.tasks);
    expect(after.hubs[0]?.notes).toEqual(before.hubs[0]?.notes);
    expect(after.hubs[0]?.tasks).toHaveLength(1);
    expect(after.hubs[0]?.notes).toHaveLength(1);
    const changed = f.record()!;
    expect(changed.orphans).toEqual({});
    expect(changed.removed).toEqual({});
    expect(changed.pendingRemovals).toEqual([]);
  });

  it('keeps the configured check interval when changing folders', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: f.hubId, provider: 'google-drive-local', settings: { path: '/mount/one' }, intervalMinutes: 0 });
    expect(f.record()?.binding.intervalMinutes).toBe(0);
    await f.service.command({ type: 'sharing.changeLocation', hubId: f.hubId, settings: { path: '/mount/two' }, confirmed: true });
    expect(f.record()?.binding.intervalMinutes).toBe(0);
  });

  it('serializes two Hubs changing to one folder', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: f.hubId, provider: 'google-drive-local', settings: { path: '/mount/one' } });
    const second = (await f.hubs.createHub('Second')).id;
    await f.service.connect({ type: 'sharing.connect', hubId: second, provider: 'google-drive-local', settings: { path: '/mount/second' } });
    const results = await Promise.allSettled([
      f.service.command({ type: 'sharing.changeLocation', hubId: f.hubId, settings: { path: '/mount/target' }, confirmed: true }),
      f.service.command({ type: 'sharing.changeLocation', hubId: second, settings: { path: '/mount/target' }, confirmed: true }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'SHARING_ADDRESS_IN_USE' } });
    const bound = [f.record(), f.sharingStore.load(second)].filter(record => record?.binding.settings.path === '/mount/target');
    expect(bound).toHaveLength(1);
  });
});
