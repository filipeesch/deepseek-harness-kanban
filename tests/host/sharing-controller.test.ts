import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { KanbanError } from '../../src/shared/errors.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { KanbanController } from '../../src/host/controller.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import type { ProviderDescription, SharingBinding, SharingProviderId, SharingProviderResolver } from '../../src/host/sharing/provider.js';
import type { SharedConfigStore, SharedConfigStoreFactory } from '../../src/host/sharing/store.js';
import type { HubSharingRecord, HubSharingStore } from '../../src/host/sharing/state.js';
import { KanbanApp } from '../../src/host/app.js';
import type { GoogleDriveLocalDiscovery } from '../../src/host/sharing/google-drive-local/discovery.js';
import { MemoryHubStorage, TestGit, TestSessions } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
class Store implements SharedConfigStore {
  document: SharedHubDocument | null = null;
  token: string | null = null;
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
  return { load: id => { const value = records.get(id); return value === undefined ? undefined : structuredClone(value); }, list: () => [...records.values()].map(value => structuredClone(value)), save: async value => { records.set(value.hubId, structuredClone(value)); }, delete: async id => { records.delete(id); }, close: async () => {} };
}

async function fixture() {
  const hubs = await HubRepository.open(new MemoryHubStorage(), { now: () => NOW });
  const store = new Store();
  const sharing = new HubSharingService({ hubs, store: memoryStore(), providers: {
      create: () => store,
      describe: (binding: SharingBinding): ProviderDescription => ({ id: binding.provider, label: 'Git repository', address: binding.settings.repository ?? '', syncMode: 'explicit', defaultIntervalMinutes: 5, requiresAuthorization: false }),
      prepare: async (_hubId, binding) => binding,
      normalize: (_provider: SharingProviderId, settings: Record<string, string>) => settings,
      defaultInterval: () => 5,
    } satisfies SharingProviderResolver, now: () => NOW });
  const app = new KanbanApp(hubs, new TestSessions(), new TestGit(), { sharing });
  const controller = new KanbanController(new Context(), app);
  const hubId = hubs.defaultHubId();
  return { hubs, sharing, controller, hubId };
}

describe('publishing controller', () => {
  it('returns the host snapshot for a valid publishing command', async () => {
    const { sharing, controller, hubId } = await fixture();
    await sharing.connect({ type: 'sharing.connect', hubId, repository: '/team/repo' });
    const result = await controller.sharing({ type: 'sharing.check', hubId });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sharing[hubId]).toMatchObject({ status: 'published' });
  });

  it('returns a typed outcome for a rejected publishing command', async () => {
    const { controller, hubId } = await fixture();
    const result = await controller.sharing({ type: 'sharing.check', hubId });
    expect(result).toMatchObject({ ok: false, error: { code: 'SHARING_NOT_PUBLISHED' } });
  });

  it('rejects a caller that is not the native host owner', async () => {
    const { hubs, sharing, hubId } = await fixture();
    await sharing.connect({ type: 'sharing.connect', hubId, repository: '/team/repo' });
    const foreign = new Proxy(new Context(), {
      get(target, property, receiver) {
        if (property === 'invocation') return { peer: { principal: { kind: 'agent' } } };
        return Reflect.get(target, property, receiver);
      },
    });
    const app = new KanbanApp(hubs, new TestSessions(), new TestGit(), { sharing });
    const controller = new KanbanController(foreign as never, app);
    const result = await controller.sharing({ type: 'sharing.check', hubId });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('local Drive query', () => {
  it('serves roots and browsing through the host controller', async () => {
    const { hubs } = await fixture();
    const roots = { state: 'ready' as const, locations: [{ id: '/drive', rootPath: '/drive', kind: 'account' as const, status: 'available' as const }] };
    const page = { rootId: '/drive', path: '/drive', parent: null, entries: [], hasDocument: false, truncated: false, total: 0 };
    const discovery = {
      roots: async () => roots,
      refresh: async () => roots,
      browse: async () => page,
    } as unknown as GoogleDriveLocalDiscovery;
    const app = new KanbanApp(hubs, new TestSessions(), new TestGit(), { localDrive: discovery });
    const controller = new KanbanController(new Context(), app);
    await expect(controller.localDrive({ action: 'roots' })).resolves.toMatchObject({ ok: true, value: { action: 'roots' } });
    await expect(controller.localDrive({ action: 'list', path: '/drive' })).resolves.toMatchObject({ ok: true, value: { action: 'list', page: { path: '/drive' } } });
  });

  it('rejects a caller that is not the native host owner', async () => {
    const { hubs } = await fixture();
    const discovery = {
      roots: async () => ({ state: 'empty' as const, locations: [] }),
      refresh: async () => ({ state: 'empty' as const, locations: [] }),
      browse: async () => { throw new Error('unused'); },
    } as unknown as GoogleDriveLocalDiscovery;
    const app = new KanbanApp(hubs, new TestSessions(), new TestGit(), { localDrive: discovery });
    const foreign = new Proxy(new Context(), {
      get(target, property, receiver) {
        if (property === 'invocation') return { peer: { principal: { kind: 'agent' } } };
        return Reflect.get(target, property, receiver);
      },
    });
    const controller = new KanbanController(foreign as never, app);
    await expect(controller.localDrive({ action: 'roots' })).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});
