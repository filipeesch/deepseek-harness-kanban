import { describe, expect, it } from 'vitest';
import { sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { KanbanError } from '../../src/shared/errors.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import type { SharedConfigStore, SharedDocumentSnapshot } from '../../src/host/sharing/store.js';
import type { HubSharingRecord, HubSharingStore } from '../../src/host/sharing/state.js';
import type { ProviderDescription, SharingBinding, SharingProviderId, SharingProviderResolver } from '../../src/host/sharing/provider.js';
import type { SharingAuthorizationPort } from '../../src/host/sharing/auth-coordinator.js';
import { createGoogleDriveProviderDescriptor } from '../../src/host/sharing/google-drive-store.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
function flow(label = 'Backlog'): string {
  return ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    label: ' + label, ''].join('\n');
}
function documentOf(name: string, workflow: string): SharedHubDocument {
  return { version: 2, boards: [{ key: 'kanban', name, workflow }] };
}

class FakeStore implements SharedConfigStore {
  document: SharedHubDocument | null = null;
  token: string | null = null;
  failWriteOnce: KanbanError | undefined;
  async ensure(): Promise<void> {}
  async read(_signal?: AbortSignal, cached?: SharedDocumentSnapshot | null): Promise<SharedDocumentSnapshot | null> {
    if (this.document === null || this.token === null) return null;
    return cached && cached.token === this.token ? cached : { token: this.token, document: structuredClone(this.document) };
  }
  async write(document: SharedHubDocument, options: { expectedToken: string | null }): Promise<{ token: string }> {
    if (this.failWriteOnce) { const failure = this.failWriteOnce; this.failWriteOnce = undefined; throw failure; }
    if ((this.token ?? null) !== (options.expectedToken ?? null)) throw Object.assign(new Error('stale'), { code: 'SHARING_STALE_TOKEN' });
    this.document = structuredClone(document);
    this.token = sharedDocumentToken(document);
    return { token: this.token };
  }
  async destroy(): Promise<void> {}
  publish(document: SharedHubDocument): void { this.document = structuredClone(document); this.token = sharedDocumentToken(document); }
}

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

const driveDescriptor = createGoogleDriveProviderDescriptor({ auth: { accessToken: async () => 'test-token' } });

const resolver = (store: FakeStore): SharingProviderResolver => ({
  create: () => store,
  describe: (binding: SharingBinding): ProviderDescription => ({ id: binding.provider, label: binding.provider === 'git' ? 'Git repository' : 'Google Drive', address: binding.provider === 'git' ? 'repo' : 'drive/folder', syncMode: binding.provider === 'google-drive' ? 'continuous' : 'explicit', defaultIntervalMinutes: binding.provider === 'google-drive' ? 1 : 5, requiresAuthorization: binding.provider === 'google-drive' }),
  prepare: async (hubId, binding, existing) => {
    const prepare = driveDescriptor.prepareBinding;
    if (binding.provider !== 'google-drive' || prepare === undefined) return binding;
    return { ...binding, settings: await prepare({ hubId, provider: binding.provider, settings: binding.settings }, existing) };
  },
  normalize: (_provider: SharingProviderId, settings) => settings,
  defaultInterval: provider => provider === 'google-drive' ? 1 : 5,
});

const auth = { status: () => 'connected' as const, ensureConnected: async () => {}, cancel: async () => {} } satisfies SharingAuthorizationPort;

async function fixture() {
  const hubs = await HubRepository.open(new MemoryHubStorage(), { id: (() => { let n = 0; return () => 'id-' + (++n); })(), now: () => NOW });
  const hubId = hubs.defaultHubId();
  const boardId = hubs.requireHub(hubId).boards[0]!.id;
  const store = memorySharingStore();
  const fake = new FakeStore();
  const service = new HubSharingService({ hubs, store, providers: resolver(fake), auth, now: () => NOW, debounceMs: 10 });
  await service.connect({ type: 'sharing.connect', hubId, provider: 'google-drive', settings: { folderId: 'folder-1234567890' }, intervalMinutes: 1 });
  return { hubs, hubId, boardId, service, fake, store };
}

describe('continuous Google Drive synchronization', () => {
  it('serializes concurrent connections to one folder', async () => {
    const hubs = await HubRepository.open(new MemoryHubStorage(), { id: (() => { let n = 0; return () => 'id-' + (++n); })(), now: () => NOW });
    const first = hubs.defaultHubId();
    const second = (await hubs.createHub('Second')).id;
    const store = memorySharingStore();
    const fake = new FakeStore();
    const service = new HubSharingService({ hubs, store, providers: resolver(fake), auth, now: () => NOW, debounceMs: 10 });
    const results = await Promise.allSettled([
      service.connect({ type: 'sharing.connect', hubId: first, provider: 'google-drive', settings: { folderId: 'folder-1234567890' }, intervalMinutes: 1 }),
      service.connect({ type: 'sharing.connect', hubId: second, provider: 'google-drive', settings: { folderId: 'folder-1234567890' }, intervalMinutes: 1 }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'SHARING_ADDRESS_IN_USE' } });
  });

  it('refuses a folder already bound to another Hub', async () => {
    const f = await fixture();
    const second = await f.hubs.createHub('Second');
    await expect(f.service.connect({ type: 'sharing.connect', hubId: second.id, provider: 'google-drive', settings: { folderId: 'folder-1234567890' }, intervalMinutes: 1 })).rejects.toMatchObject({ code: 'SHARING_ADDRESS_IN_USE' });
  });

  it('publishes a local workflow change automatically', async () => {
    const f = await fixture();
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('Local'), revision);
    await f.service.check(f.hubId);
    expect(f.service.view(f.hubId)).toMatchObject({ status: 'published', syncMode: 'continuous', pending: 0, drafts: 0 });
    expect(f.fake.document?.boards[0]?.workflow).toBe(flow('Local'));
  });

  it('applies a team-only change automatically', async () => {
    const f = await fixture();
    f.fake.publish(documentOf('Kanban', flow('Team')));
    await f.service.check(f.hubId);
    expect(f.hubs.requireHub(f.hubId).boards[0]!.workflowYaml).toBe(flow('Team'));
    expect(f.service.view(f.hubId)).toMatchObject({ status: 'published', updates: 0, conflicts: 0 });
  });

  it('keeps a both-sides change for review and does not overwrite the team document', async () => {
    const f = await fixture();
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('Local'), revision);
    f.fake.publish(documentOf('Kanban', flow('Team')));
    await f.service.check(f.hubId);
    expect(f.service.view(f.hubId)).toMatchObject({ status: 'needs-review', conflicts: 1 });
    expect(f.hubs.requireHub(f.hubId).boards[0]!.workflowYaml).toBe(flow('Local'));
    expect(f.fake.document?.boards[0]?.workflow).toBe(flow('Team'));
  });

  it('resumes a pending change after a service restart', async () => {
    const f = await fixture();
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('After restart'), revision);
    const restarted = new HubSharingService({ hubs: f.hubs, store: f.store, providers: resolver(f.fake), auth, now: () => NOW });
    await restarted.check(f.hubId);
    expect(f.fake.document?.boards[0]?.workflow).toBe(flow('After restart'));
  });

  it('holds a concurrent-write review until an explicit manual check', async () => {
    const f = await fixture();
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('Local race'), revision);
    f.fake.failWriteOnce = new KanbanError('SHARING_CONCURRENT_WRITE', 'A concurrent write was detected.');
    await expect(f.service.check(f.hubId)).rejects.toMatchObject({ code: 'SHARING_CONCURRENT_WRITE' });
    const publishedBefore = f.fake.document?.boards[0]?.workflow;
    const read = f.fake.read.bind(f.fake);
    f.fake.read = async () => { throw Object.assign(new Error('offline'), { code: 'SHARING_UNREACHABLE' }); };
    await expect(f.service.check(f.hubId)).rejects.toMatchObject({ code: 'SHARING_UNREACHABLE' });
    f.fake.read = read;
    await f.service.check(f.hubId);
    expect(f.fake.document?.boards[0]?.workflow).toBe(publishedBefore);
    expect(f.service.view(f.hubId)).toMatchObject({ status: 'unavailable', drafts: 1 });
    await f.service.check(f.hubId, true);
    expect(f.fake.document?.boards[0]?.workflow).toBe(flow('Local race'));
    expect(f.service.view(f.hubId)).toMatchObject({ status: 'published', pending: 0 });
  });

  it('debounces a local save into a synchronization', async () => {
    const f = await fixture();
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('Debounced'), revision);
    f.service.noteLocalChange(f.hubId);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(f.fake.document?.boards[0]?.workflow).toBe(flow('Debounced'));
  });

  it('retries a pending local change after connectivity returns', async () => {
    const f = await fixture();
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('Recovered'), revision);
    const read = f.fake.read.bind(f.fake);
    f.fake.read = async () => { throw Object.assign(new Error('offline'), { code: 'SHARING_UNREACHABLE' }); };
    await expect(f.service.check(f.hubId)).rejects.toMatchObject({ code: 'SHARING_UNREACHABLE' });
    f.fake.read = read;
    await f.service.check(f.hubId);
    expect(f.fake.document?.boards[0]?.workflow).toBe(flow('Recovered'));
    expect(f.service.view(f.hubId)).toMatchObject({ status: 'published', pending: 0 });
  });

  it('removes a Drive binding on deletion and publishes a team-wide board removal', async () => {
    const f = await fixture();
    await f.service.removeHub(f.hubId);
    expect(f.store.load(f.hubId)).toBeUndefined();
    expect(f.fake.document).not.toBeNull();
    const second = await fixture();
    await second.hubs.hub(second.hubId).deleteBoard(second.boardId);
    await second.service.removeBoard(second.hubId, second.boardId, 'team', 'Kanban');
    await second.service.check(second.hubId, true);
    expect(second.fake.document?.boards).toHaveLength(0);
  });

  it('synchronizes a team board removal scheduled inside a lane', async () => {
    const f = await fixture();
    await f.hubs.hub(f.hubId).deleteBoard(f.boardId);
    await f.service.removeBoard(f.hubId, f.boardId, 'team', 'Kanban');
    // The debounce timer is scheduled inside the removal lane; it must still run
    // the check outside that lane instead of failing as reentrant.
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(f.fake.document?.boards).toHaveLength(0);
  });

  it('keeps the local change pending when the team storage is unavailable', async () => {
    const f = await fixture();
    const failing = f.service;
    const revision = f.hubs.requireHub(f.hubId).revision;
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('Offline'), revision);
    f.fake.read = async () => { throw Object.assign(new Error('offline'), { code: 'SHARING_UNREACHABLE' }); };
    await expect(failing.check(f.hubId)).rejects.toMatchObject({ code: 'SHARING_UNREACHABLE' });
    expect(f.service.view(f.hubId)).toMatchObject({ status: 'unavailable', drafts: 1 });
  });
});
