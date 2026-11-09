import { describe, expect, it } from 'vitest';
import { sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import type { SharingBinding } from '../../src/host/sharing/provider.js';
import type { SharedConfigStore, SharedConfigStoreFactory } from '../../src/host/sharing/store.js';
import type { HubSharingRecord, HubSharingStore } from '../../src/host/sharing/state.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import { placeTask } from '../../src/domain/hub-operations.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
const nl = String.fromCharCode(10);
type Stage = readonly [id: string, label: string, position?: readonly [number, number]];

function flow(stages: readonly Stage[]): string {
  const lines = ['name: Flow', 'columns:'];
  for (const [id, label, position] of stages) {
    lines.push('  - id: ' + id);
    lines.push('    label: ' + label);
    if (position !== undefined) lines.push('    position: {x: ' + position[0] + ', y: ' + position[1] + '}');
  }
  lines.push('');
  return lines.join(nl);
}

const BASE = flow([['backlog', 'Backlog', [0, 0]], ['plan', 'Plan', [200, 0]], ['done', 'Done']]);
const LOCAL = flow([['backlog', 'Backlog', [40, 0]], ['plan', 'Plan', [200, 0]], ['done', 'Done']]);
const TEAM = flow([['backlog', 'Backlog', [0, 0]], ['plan', 'Plan', [260, 0]], ['done', 'Done']]);

function documentOf(workflow: string): SharedHubDocument {
  return { version: 2, boards: [{ key: 'kanban', name: 'Kanban', workflow }] };
}

class FakeStore implements SharedConfigStore {
  document: SharedHubDocument | null = null;
  token: string | null = null;
  async ensure(): Promise<void> {}
  async read(): Promise<{ token: string; document: SharedHubDocument } | null> {
    if (this.document === null || this.token === null) return null;
    return { token: this.token, document: structuredClone(this.document) };
  }
  async write(document: SharedHubDocument, options: { expectedToken: string | null }): Promise<{ token: string }> {
    if ((this.token ?? null) !== (options.expectedToken ?? null)) throw new Error('stale token');
    this.publish(document);
    return { token: this.token! };
  }
  async destroy(): Promise<void> {}
  publish(document: SharedHubDocument): void { this.document = structuredClone(document); this.token = sharedDocumentToken(document); }
}

class FakeFactory implements SharedConfigStoreFactory {
  readonly stores = new Map<string, FakeStore>();
  create(hubId: string): SharedConfigStore { return this.storeFor(hubId); }
  describe(binding: { settings: Record<string, string> }) { return { id: 'git' as const, label: 'Git repository', address: binding.settings.repository ?? '', syncMode: 'explicit' as const, defaultIntervalMinutes: 5, requiresAuthorization: false }; }
  async prepare(_hubId: string, binding: SharingBinding) { return binding; }
  normalize(_provider: string, settings: Record<string, string>) { return settings; }
  defaultInterval() { return 5; }
  storeFor(hubId: string): FakeStore {
    const existing = this.stores.get(hubId);
    if (existing !== undefined) return existing;
    const store = new FakeStore();
    this.stores.set(hubId, store);
    return store;
  }
}

function memorySharingStore(): HubSharingStore {
  const records = new Map<string, HubSharingRecord>();
  return {
    load: hubId => { const value = records.get(hubId); return value === undefined ? undefined : structuredClone(value); },
    list: () => [...records.values()].map(value => structuredClone(value)),
    save: async value => { records.set(value.hubId, structuredClone(value)); },
    delete: async hubId => { records.delete(hubId); },
    close: async () => {},
  };
}

let generated = 0;
function ids(): string { generated += 1; return 'generated-' + generated; }

async function fixture() {
  const hubs = await HubRepository.open(new MemoryHubStorage(), { id: ids, now: () => NOW });
  const factory = new FakeFactory();
  const service = new HubSharingService({ hubs, store: memorySharingStore(), providers: factory, now: () => NOW, id: ids });
  const hubId = hubs.defaultHubId();
  const boardId = hubs.requireHub(hubId).boards[0]!.id;
  await hubs.hub(hubId).saveBoardWorkflow(boardId, BASE);
  await service.connect({ type: 'sharing.connect', hubId, repository: '/team/repo', intervalMinutes: 5 });
  return { hubs, hubId, boardId, factory, service };
}

describe('host placement merge', () => {
  it('applies a placement-only team change without asking for a choice', async () => {
    const context = await fixture();
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, LOCAL);
    context.factory.storeFor(context.hubId).publish(documentOf(TEAM));
    await context.service.getUpdates(context.hubId);
    const view = context.service.view(context.hubId)!;
    expect(view).toMatchObject({ conflicts: 0, updates: 0, drafts: 1 });
    expect(view.boards[0]).toMatchObject({ state: 'draft' });
    const stored = context.hubs.requireHub(context.hubId).boards[0]!.workflowYaml;
    expect(stored).toContain('position: {x: 40, y: 0}');
    expect(stored).toContain('position: {x: 260, y: 0}');
  });

  it('publishes the merged placement on the next publication', async () => {
    const context = await fixture();
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, LOCAL);
    const remote = context.factory.storeFor(context.hubId);
    remote.publish(documentOf(TEAM));
    await context.service.getUpdates(context.hubId);
    expect(context.service.view(context.hubId)).toMatchObject({ conflicts: 0, updates: 0, drafts: 1 });
    await context.service.publish(context.hubId);
    const published = remote.document!;
    expect(published.boards[0]!.workflow).toContain('position: {x: 40, y: 0}');
    expect(published.boards[0]!.workflow).toContain('position: {x: 260, y: 0}');
    expect(context.service.view(context.hubId)).toMatchObject({ drafts: 0, conflicts: 0, updates: 0 });
  });

  it('still refuses a merged workflow that would orphan a task column', async () => {
    const context = await fixture();
    await context.hubs.hub(context.hubId).saveProject({ name: 'P', projectPath: '/repo' });
    const project = context.hubs.requireHub(context.hubId).projects[0]!;
    await context.hubs.hub(context.hubId).createTask({ projectId: project.id, title: 'Task', description: '', boardId: context.boardId });
    await context.hubs.hub(context.hubId).transact(draft => {
      const task = draft.tasks.find(candidate => candidate.title === 'Task')!;
      placeTask(draft, task.id, 'plan', 'end', Date.now());
    });
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, LOCAL);
    context.factory.storeFor(context.hubId).publish(documentOf(flow([['backlog', 'Backlog', [0, 0]], ['done', 'Done']])));
    await expect(context.service.getUpdates(context.hubId)).rejects.toMatchObject({ code: 'SHARING_REFUSED' });
    expect(context.service.view(context.hubId)!.blockers[0]).toMatchObject({ code: 'SHARING_ORPHAN_COLUMNS', columnId: 'plan', tasks: 1 });
    expect(context.hubs.requireHub(context.hubId).boards[0]!.workflowYaml).toBe(LOCAL);
  });
});
