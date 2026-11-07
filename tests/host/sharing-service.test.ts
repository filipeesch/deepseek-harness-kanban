import { describe, expect, it } from 'vitest';
import { sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { DEFAULT_WORKFLOW_YAML } from '../../src/domain/workflow.js';
import { placeTask } from '../../src/domain/hub-operations.js';
import { KanbanError } from '../../src/shared/errors.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import type { SharingBinding } from '../../src/host/sharing/provider.js';
import type { SharedConfigStore, SharedConfigStoreFactory } from '../../src/host/sharing/store.js';
import type { HubSharingRecord, HubSharingStore } from '../../src/host/sharing/state.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import { KanbanApp } from '../../src/host/app.js';
import { MemoryHubStorage, TestGit, TestSessions } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
const DEFAULT_COLUMNS = ['backlog', 'plan', 'in_progress', 'in_review', 'done'];

function flow(columns: string[] = DEFAULT_COLUMNS, initial = columns[0]!): string {
  return ['name: Flow', 'initial_column: ' + initial, 'columns:', ...columns.flatMap(column => ['  - id: ' + column, '    label: ' + column]), ''].join('\n');
}
function documentOf(name = 'Kanban', workflow = DEFAULT_WORKFLOW_YAML, key = 'kanban'): SharedHubDocument {
  return { version: 1, boards: [{ key, name, workflow }] };
}
function ids(): () => string { let value = 0; return () => 'generated-' + (++value); }

class FakeStore implements SharedConfigStore {
  document: SharedHubDocument | null;
  token: string | null;
  destroyed = false;
  onRead?: () => void | Promise<void>;
  failRead?: KanbanError;
  failWrite?: KanbanError;
  constructor(seed?: SharedHubDocument) {
    this.document = seed === undefined ? null : structuredClone(seed);
    this.token = seed === undefined ? null : sharedDocumentToken(seed);
  }
  async ensure(): Promise<void> {}
  async read(): Promise<{ token: string; document: SharedHubDocument } | null> {
    await this.onRead?.();
    if (this.failRead) throw this.failRead;
    if (this.document === null || this.token === null) return null;
    return { token: this.token, document: structuredClone(this.document) };
  }
  async write(document: SharedHubDocument, options: { expectedToken: string | null }): Promise<{ token: string }> {
    if (this.failWrite) throw this.failWrite;
    if ((this.token ?? null) !== (options.expectedToken ?? null)) throw new KanbanError('SHARING_STALE_TOKEN', 'The team configuration changed.');
    this.document = structuredClone(document);
    this.token = sharedDocumentToken(document);
    return { token: this.token };
  }
  async destroy(): Promise<void> { this.destroyed = true; }
  publish(document: SharedHubDocument): void { this.document = structuredClone(document); this.token = sharedDocumentToken(document); }
}

class FakeFactory implements SharedConfigStoreFactory {
  readonly stores = new Map<string, FakeStore>();
  constructor(private readonly seed?: SharedHubDocument) {}
  create(hubId: string): SharedConfigStore { return this.storeFor(hubId); }
  describe(binding: { settings: Record<string, string> }) { return { id: 'git' as const, label: 'Git repository', address: binding.settings.repository ?? '', syncMode: 'explicit' as const, defaultIntervalMinutes: 5, requiresAuthorization: false }; }
  async prepare(_hubId: string, binding: SharingBinding) { return binding; }
  normalize(_provider: string, settings: Record<string, string>) { return settings; }
  defaultInterval() { return 5; }
  storeFor(hubId: string): FakeStore {
    const existing = this.stores.get(hubId);
    if (existing) return existing;
    const store = new FakeStore(this.seed);
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

async function fixture(seed?: SharedHubDocument) {
  const storage = new MemoryHubStorage();
  const hubs = await HubRepository.open(storage, { id: ids(), now: () => NOW });
  const store = memorySharingStore();
  const factory = new FakeFactory(seed);
  const service = new HubSharingService({ hubs, store, providers: factory, now: () => NOW, id: ids() });
  const hubId = hubs.defaultHubId();
  return { hubs, hubId, store, factory, service, boardId: hubs.requireHub(hubId).boards[0]!.id };
}

async function connect(context: Awaited<ReturnType<typeof fixture>>, intervalMinutes = 5): Promise<void> {
  await context.service.connect({ type: 'sharing.connect', hubId: context.hubId, repository: '/team/repo', intervalMinutes });
}

describe('Hub publishing service', () => {
  it('publishes the local Hub when the repository is empty', async () => {
    const context = await fixture();
    await connect(context, 7);
    const view = context.service.view(context.hubId)!;
    expect(view).toMatchObject({ status: 'published', provider: 'git', repository: '/team/repo', intervalMinutes: 7, drafts: 0, updates: 0, conflicts: 0 });
    expect(view.boards[0]).toMatchObject({ boardId: context.boardId, key: 'kanban', bound: true, state: 'in-sync' });
    expect(context.factory.storeFor(context.hubId).document!.boards[0]).toMatchObject({ key: 'kanban', name: 'Kanban', workflow: DEFAULT_WORKFLOW_YAML });
  });

  it('previews a repository that already has content and receives it on demand', async () => {
    const context = await fixture(documentOf('Delivery', flow(['backlog', 'plan']), 'delivery'));
    await connect(context);
    expect(context.service.view(context.hubId)).toMatchObject({ status: 'preview', preview: { publishedBoards: 1, localBoards: 1 } });
    expect(context.service.publishedHubs()).toEqual([]);
    expect(context.hubs.requireHub(context.hubId).boards).toHaveLength(1);
    await context.service.receive(context.hubId);
    expect(context.service.publishedHubs()).toHaveLength(1);
    const hub = context.hubs.requireHub(context.hubId);
    expect(hub.boards.map(board => board.name).sort()).toEqual(['Delivery', 'Kanban']);
    const view = context.service.view(context.hubId)!;
    expect(view.status).toBe('published');
    expect(view.boards.find(board => board.name === 'Delivery')).toMatchObject({ key: 'delivery', bound: true });
    expect(view.boards.find(board => board.name === 'Kanban')).toMatchObject({ state: 'draft', bound: false });
  });

  it('adopts a same-name local board on the first connection instead of duplicating it', async () => {
    const context = await fixture(documentOf('Kanban', flow(['backlog', 'done']), 'team-kanban'));
    await connect(context);
    await context.service.receive(context.hubId);
    const hub = context.hubs.requireHub(context.hubId);
    expect(hub.boards).toHaveLength(1);
    expect(hub.boards[0]!.workflowYaml).toBe(flow(['backlog', 'done']));
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ key: 'team-kanban', bound: true, state: 'in-sync' });
  });

  it('publishes the local Hub over existing team content only with confirmation', async () => {
    const context = await fixture(documentOf('Delivery', flow(['backlog']), 'delivery'));
    await connect(context);
    await expect(context.service.publishInitial(context.hubId, false)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await context.service.publishInitial(context.hubId, true);
    const published = context.factory.storeFor(context.hubId).document!;
    expect(published.boards.map(board => board.name)).toEqual(['Kanban']);
    expect(context.service.view(context.hubId)!.status).toBe('published');
  });

  it('marks a local workflow save as a draft and publishes it', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'done']));
    const draft = context.service.view(context.hubId)!;
    expect(draft).toMatchObject({ status: 'published', drafts: 1 });
    expect(draft.boards[0]).toMatchObject({ state: 'draft' });
    await context.service.publish(context.hubId);
    expect(context.factory.storeFor(context.hubId).document!.boards[0]!.workflow).toBe(flow(['backlog', 'done']));
    expect(context.service.view(context.hubId)!.drafts).toBe(0);
  });

  it('applies a team change to one board while keeping a local draft on another', async () => {
    const context = await fixture();
    await context.hubs.hub(context.hubId).addBoard('Extra');
    await connect(context);
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'plan']));
    const remote = context.factory.storeFor(context.hubId);
    remote.publish({ version: 1, boards: [
      { key: 'kanban', name: 'Kanban', workflow: DEFAULT_WORKFLOW_YAML },
      { key: 'extra', name: 'Extra', workflow: flow(['backlog', 'done']) },
    ] });
    await context.service.check(context.hubId);
    const before = context.service.view(context.hubId)!;
    expect(before).toMatchObject({ drafts: 1, updates: 1, conflicts: 0 });
    expect(before.boards.find(board => board.name === 'Kanban')).toMatchObject({ state: 'draft' });
    expect(before.boards.find(board => board.name === 'Extra')).toMatchObject({ state: 'updates-available' });
    await context.service.getUpdates(context.hubId);
    const hub = context.hubs.requireHub(context.hubId);
    expect(hub.boards.find(board => board.name === 'Kanban')!.workflowYaml).toBe(flow(['backlog', 'plan']));
    expect(hub.boards.find(board => board.name === 'Extra')!.workflowYaml).toBe(flow(['backlog', 'done']));
    expect(context.service.view(context.hubId)).toMatchObject({ drafts: 1, updates: 0 });
  });

  it('reports a same-board change on both sides as needing review', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'plan']));
    context.factory.storeFor(context.hubId).publish(documentOf('Kanban', flow(['backlog', 'done'])));
    await context.service.check(context.hubId);
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ state: 'needs-review' });
    expect(context.service.view(context.hubId)!.conflicts).toBe(1);
  });

  it('applies a team-only update and records the merged base', async () => {
    const context = await fixture();
    await connect(context);
    const remote = context.factory.storeFor(context.hubId);
    remote.publish(documentOf('Kanban', flow(['backlog', 'done'])));
    await context.service.check(context.hubId);
    expect(context.service.view(context.hubId)!.updates).toBe(1);
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards[0]!.workflowYaml).toBe(flow(['backlog', 'done']));
    expect(context.service.view(context.hubId)).toMatchObject({ status: 'published', updates: 0, conflicts: 0, drafts: 0 });
  });

  it('refuses to apply a workflow that would orphan a task column', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveProject({ name: 'P', projectPath: '/repo' });
    const project = context.hubs.requireHub(context.hubId).projects[0]!;
    await context.hubs.hub(context.hubId).createTask({ projectId: project.id, title: 'Task', description: '', boardId: context.boardId });
    context.factory.storeFor(context.hubId).publish(documentOf('Kanban', flow(['done'])));
    await context.service.check(context.hubId);
    const view = context.service.view(context.hubId)!;
    expect(view.blockers[0]).toMatchObject({ code: 'SHARING_ORPHAN_COLUMNS', columnId: 'backlog', tasks: 1 });
    await expect(context.service.getUpdates(context.hubId)).rejects.toMatchObject({ code: 'SHARING_REFUSED' });
    expect(context.hubs.requireHub(context.hubId).boards[0]!.workflowYaml).toBe(DEFAULT_WORKFLOW_YAML);
    await context.hubs.hub(context.hubId).transact(draft => {
      const task = draft.tasks.find(candidate => candidate.title === 'Task')!;
      placeTask(draft, task.id, 'done', null, Date.now());
    });
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards[0]!.workflowYaml).toBe(flow(['done']));
  });

  it('reports an invalid published document as unavailable', async () => {
    const context = await fixture();
    await connect(context);
    context.factory.storeFor(context.hubId).failRead = new KanbanError('SHARING_INVALID_DOCUMENT', 'The published configuration is invalid.');
    await expect(context.service.check(context.hubId)).rejects.toMatchObject({ code: 'SHARING_INVALID_DOCUMENT' });
    expect(context.service.view(context.hubId)).toMatchObject({ status: 'unavailable', error: { code: 'SHARING_INVALID_DOCUMENT' } });
  });

  it('reports an unreachable repository and keeps local work available', async () => {
    const context = await fixture();
    await connect(context);
    const store = context.factory.storeFor(context.hubId);
    store.failRead = new KanbanError('SHARING_UNREACHABLE', 'The team repository could not be reached.');
    await expect(context.service.check(context.hubId)).rejects.toMatchObject({ code: 'SHARING_UNREACHABLE' });
    const unavailable = context.service.view(context.hubId)!;
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.error).toMatchObject({ code: 'SHARING_UNREACHABLE' });
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'plan']));
    expect(context.service.view(context.hubId)!.drafts).toBe(1);
    store.failRead = undefined;
    await context.service.check(context.hubId);
    expect(context.service.view(context.hubId)).toMatchObject({ status: 'published', drafts: 1 });
  });

  it('resolves a conflict towards the team or towards the local draft', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'plan']));
    context.factory.storeFor(context.hubId).publish(documentOf('Kanban', flow(['backlog', 'done'])));
    await context.service.check(context.hubId);
    await context.service.resolve(context.hubId, context.boardId, 'team');
    expect(context.hubs.requireHub(context.hubId).boards[0]!.workflowYaml).toBe(flow(['backlog', 'done']));
    expect(context.service.view(context.hubId)!.conflicts).toBe(0);

    const second = await fixture();
    await connect(second);
    await second.hubs.hub(second.hubId).saveBoardWorkflow(second.boardId, flow(['backlog', 'plan']));
    second.factory.storeFor(second.hubId).publish(documentOf('Kanban', flow(['backlog', 'done'])));
    await second.service.check(second.hubId);
    await second.service.resolve(second.hubId, second.boardId, 'local');
    const view = second.service.view(second.hubId)!;
    expect(view.conflicts).toBe(0);
    expect(view.drafts).toBe(1);
    expect(second.hubs.requireHub(second.hubId).boards[0]!.workflowYaml).toBe(flow(['backlog', 'plan']));
  });

  it('blocks publishing while team updates are unapplied', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'plan']));
    context.factory.storeFor(context.hubId).publish(documentOf('Kanban', flow(['backlog', 'done'])));
    await context.service.check(context.hubId);
    await expect(context.service.publish(context.hubId)).rejects.toMatchObject({ code: 'SHARING_PUBLISH_BLOCKED' });
  });

  it('publishes nothing when the team published after the last check', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'plan']));
    const remote = context.factory.storeFor(context.hubId);
    const team = documentOf('Kanban', flow(['backlog', 'done']));
    remote.publish(team);
    await expect(context.service.publish(context.hubId)).rejects.toMatchObject({ code: 'SHARING_STALE_TOKEN' });
    expect(remote.document!.boards[0]!.workflow).toBe(flow(['backlog', 'done']));
    const view = context.service.view(context.hubId)!;
    expect(view.conflicts).toBe(1);
  });

  it('applies a team board reorder detected without content changes', async () => {
    const context = await fixture();
    const extra = await context.hubs.hub(context.hubId).addBoard('Extra');
    expect(extra.name).toBe('Extra');
    await connect(context);
    const hub = context.hubs.requireHub(context.hubId);
    const [first, second] = hub.boards;
    context.factory.storeFor(context.hubId).publish({ version: 1, boards: [
      { key: 'extra', name: 'Extra', workflow: second!.workflowYaml },
      { key: 'kanban', name: 'Kanban', workflow: first!.workflowYaml },
    ] });
    await context.service.check(context.hubId);
    const pending = context.service.view(context.hubId)!;
    expect(pending).toMatchObject({ updates: 1, orderChanged: true });
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards.map(board => board.name)).toEqual(['Extra', 'Kanban']);
    expect(context.service.view(context.hubId)).toMatchObject({ updates: 0, orderChanged: false });
  });

  it('applies an empty-board team removal through Get updates', async () => {
    const context = await fixture();
    await context.hubs.hub(context.hubId).addBoard('Extra');
    await connect(context);
    context.factory.storeFor(context.hubId).publish({ version: 1, boards: [{ key: 'kanban', name: 'Kanban', workflow: DEFAULT_WORKFLOW_YAML }] });
    await context.service.check(context.hubId);
    const pending = context.service.view(context.hubId)!;
    expect(pending.updates).toBe(1);
    expect(pending.removing).toEqual([{ boardId: context.hubs.requireHub(context.hubId).boards.find(board => board.name === 'Extra')!.id, name: 'Extra' }]);
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards.map(board => board.name)).toEqual(['Kanban']);
    expect(context.service.view(context.hubId)!.updates).toBe(0);
  });

  it('forgets an orphan anchor when the orphan is deleted and survives a later team board with the same key', async () => {
    const context = await fixture();
    await connect(context);
    // An orphan can be deleted when it holds only unpublished changes and no tasks.
    await context.hubs.hub(context.hubId).saveBoardWorkflow(context.boardId, flow(['backlog', 'done']));
    const remote = context.factory.storeFor(context.hubId);
    remote.publish({ version: 1, boards: [] });
    await context.service.check(context.hubId);
    await context.service.getUpdates(context.hubId);
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ state: 'orphan' });
    const app = new KanbanApp(context.hubs, new TestSessions(), new TestGit(), { sharing: context.service });
    await app.command({ type: 'board.delete', hubId: context.hubId, boardId: context.boardId, confirmed: true });
    expect(context.store.load(context.hubId)!.orphans).toEqual({});
    remote.publish(documentOf('Kanban', DEFAULT_WORKFLOW_YAML, 'kanban'));
    await context.service.check(context.hubId);
    expect(() => context.service.views()).not.toThrow();
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards).toHaveLength(1);
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ key: 'kanban', bound: true });
  });

  it('keeps a board removed only here out of later team updates and restores it', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).deleteBoard(context.boardId);
    await context.service.removeBoard(context.hubId, context.boardId, 'local', 'Kanban');
    const removedView = context.service.view(context.hubId)!;
    expect(removedView.removed).toEqual([{ boardId: context.boardId, key: 'kanban', name: 'Kanban' }]);
    await context.service.check(context.hubId);
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards).toHaveLength(0);
    await context.service.restore(context.hubId, context.boardId);
    expect(context.hubs.requireHub(context.hubId).boards).toHaveLength(1);
    expect(context.service.view(context.hubId)!.removed).toHaveLength(0);
  });

  it('publishes a team-wide board removal with the next publish', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).deleteBoard(context.boardId);
    await context.service.removeBoard(context.hubId, context.boardId, 'team', 'Kanban');
    expect(context.service.view(context.hubId)!.drafts).toBe(1);
    await context.service.publish(context.hubId);
    expect(context.factory.storeFor(context.hubId).document!.boards).toHaveLength(0);
    expect(context.service.view(context.hubId)!.drafts).toBe(0);
  });

  it('keeps a board with tasks as an orphan and republishes it under a new key', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveProject({ name: 'P', projectPath: '/repo' });
    const project = context.hubs.requireHub(context.hubId).projects[0]!;
    await context.hubs.hub(context.hubId).createTask({ projectId: project.id, title: 'Task', description: '', boardId: context.boardId });
    context.factory.storeFor(context.hubId).publish({ version: 1, boards: [] });
    await context.service.check(context.hubId);
    expect(context.service.view(context.hubId)).toMatchObject({ updates: 1 });
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ state: 'orphan', pending: true });
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards).toHaveLength(1);
    expect(context.service.view(context.hubId)).toMatchObject({ updates: 0 });
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ state: 'orphan', pending: false });
    await context.service.publishOrphan(context.hubId, context.boardId);
    const republished = context.factory.storeFor(context.hubId).document!.boards[0]!;
    expect(republished.key).not.toBe('kanban');
    expect(republished.name).toBe('Kanban');
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ bound: true });
  });

  it('restores the orphan when republishing fails', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveProject({ name: 'P', projectPath: '/repo' });
    const project = context.hubs.requireHub(context.hubId).projects[0]!;
    await context.hubs.hub(context.hubId).createTask({ projectId: project.id, title: 'Task', description: '', boardId: context.boardId });
    const remote = context.factory.storeFor(context.hubId);
    remote.publish({ version: 1, boards: [] });
    await context.service.check(context.hubId);
    await context.service.getUpdates(context.hubId);
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ state: 'orphan' });
    remote.failWrite = new KanbanError('SHARING_UNREACHABLE', 'The team repository could not be reached.');
    await expect(context.service.publishOrphan(context.hubId, context.boardId)).rejects.toMatchObject({ code: 'SHARING_UNREACHABLE' });
    expect(context.store.load(context.hubId)!.orphans[context.boardId]).toBeDefined();
    remote.failWrite = undefined;
    await context.service.publishOrphan(context.hubId, context.boardId);
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ bound: true });
  });

  it('reconnects an orphan when the team publishes a board with the same name', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.hub(context.hubId).saveProject({ name: 'P', projectPath: '/repo' });
    const project = context.hubs.requireHub(context.hubId).projects[0]!;
    await context.hubs.hub(context.hubId).createTask({ projectId: project.id, title: 'Task', description: '', boardId: context.boardId });
    const remote = context.factory.storeFor(context.hubId);
    remote.publish({ version: 1, boards: [] });
    await context.service.check(context.hubId);
    await context.service.getUpdates(context.hubId);
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ state: 'orphan' });
    remote.publish(documentOf('Kanban', DEFAULT_WORKFLOW_YAML, 'team-kanban'));
    await context.service.check(context.hubId);
    expect(context.service.view(context.hubId)!.updates).toBe(1);
    await context.service.getUpdates(context.hubId);
    expect(context.hubs.requireHub(context.hubId).boards).toHaveLength(1);
    expect(context.service.view(context.hubId)!.boards[0]).toMatchObject({ key: 'team-kanban', bound: true, state: 'in-sync', pending: false });
  });

  it('requires a removal scope for a published board and records the choice', async () => {
    const context = await fixture();
    await connect(context);
    const app = new KanbanApp(context.hubs, new TestSessions(), new TestGit(), { sharing: context.service });
    await expect(app.command({ type: 'board.delete', hubId: context.hubId, boardId: context.boardId, confirmed: true })).rejects.toMatchObject({ code: 'SHARING_SCOPE_REQUIRED' });
    await app.command({ type: 'board.delete', hubId: context.hubId, boardId: context.boardId, confirmed: true, sharing: 'local' });
    expect(context.store.load(context.hubId)!.removed.kanban).toMatchObject({ boardId: context.boardId, name: 'Kanban' });
    expect(context.service.view(context.hubId)!.removed).toHaveLength(1);
  });

  it('disconnects a Hub and removes the managed workspace', async () => {
    const context = await fixture();
    await connect(context);
    await context.service.disconnect(context.hubId);
    expect(context.store.load(context.hubId)).toBeUndefined();
    expect(context.factory.storeFor(context.hubId).destroyed).toBe(true);
    expect(context.service.view(context.hubId)).toBeUndefined();
  });

  it('validates the check interval', async () => {
    const context = await fixture();
    await connect(context);
    await context.service.setInterval(context.hubId, 0);
    expect(context.service.view(context.hubId)!.intervalMinutes).toBe(0);
    await expect(context.service.setInterval(context.hubId, 1441)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(context.service.setInterval(context.hubId, 0.5)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a publishing operation started inside another one', async () => {
    const context = await fixture();
    await connect(context);
    let inner: unknown;
    context.factory.storeFor(context.hubId).onRead = () => {
      try { void context.service.check(context.hubId); }
      catch (error) { inner = error; }
    };
    await context.service.check(context.hubId);
    expect(inner).toMatchObject({ code: 'SHARING_REENTRANT' });
  });

  it('exposes published state in the host snapshot', async () => {
    const context = await fixture();
    await connect(context);
    const other = await context.hubs.createHub('Other');
    const app = new KanbanApp(context.hubs, new TestSessions(), new TestGit(), { sharing: context.service });
    const snapshot = await app.snapshot();
    expect(snapshot.sharing[context.hubId]).toMatchObject({ status: 'published' });
    expect(snapshot.sharing[other.id]).toBeUndefined();
  });

  it('serializes a Hub deletion behind a check already in flight', async () => {
    const context = await fixture();
    await connect(context);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const store = context.factory.storeFor(context.hubId);
    store.onRead = () => gate;
    const checking = context.service.check(context.hubId);
    const removing = context.service.removeHub(context.hubId);
    release();
    await checking;
    await removing;
    expect(store.destroyed).toBe(true);
    expect(context.store.load(context.hubId)).toBeUndefined();
  });

  it('removes the binding when a published Hub is deleted', async () => {
    const context = await fixture();
    await connect(context);
    await context.hubs.createHub('Other');
    const app = new KanbanApp(context.hubs, new TestSessions(), new TestGit(), { sharing: context.service });
    await app.command({ type: 'hub.delete', hubId: context.hubId, confirmed: true });
    expect(context.store.load(context.hubId)).toBeUndefined();
    expect(context.factory.storeFor(context.hubId).destroyed).toBe(true);
  });
});
