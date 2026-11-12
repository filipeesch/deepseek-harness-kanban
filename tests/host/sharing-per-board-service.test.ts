import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultHubState } from '../../src/domain/hub-schema.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import * as operations from '../../src/domain/hub-operations.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import type { HubSharingStore } from '../../src/host/sharing/state.js';
import type { ProviderDescription, ProviderState, SharingBinding, SharingProviderId } from '../../src/host/sharing/provider.js';
import type { SharedLayoutStore } from '../../src/host/sharing/ports.js';
import { type BoardLog } from '../../src/domain/journal/log.js';
import { MemoryLayoutStore } from '../support/memory-layout-store.js';
import { genesisLog } from '../support/board-log-fixture.js';
import { KanbanError } from '../../src/shared/errors.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-02T00:00:00.000Z';
const NL = String.fromCharCode(10);
const FLOW = ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', '  - id: plan', '    key: s2', '    label: Plan', ''].join(NL);
const SECOND = ['name: Second', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', ''].join(NL);

/** A published board log, with the identity events a publisher always writes. */
function publishedLog(text: string, name: string, rank: string): BoardLog {
  return genesisLog(text, [
    { kind: 'board.renamed', name },
    { kind: 'board.scope-changed', projectKeys: null },
    { kind: 'board.rank-changed', rank },
  ]);
}

function description(binding: SharingBinding): ProviderDescription {
  return { id: binding.provider, label: 'Local folder', address: binding.settings.path ?? '', defaultIntervalMinutes: 5, requiresAuthorization: false, supportsFiles: true };
}

function memorySharing(): HubSharingStore {
  const records = new Map<string, never>();
  return {
    load: id => { const value = records.get(id); return value === undefined ? undefined : structuredClone(value); },
    list: () => [...records.values()].map(value => structuredClone(value)),
    save: async value => { records.set(value.hubId, structuredClone(value) as never); },
    delete: async id => { records.delete(id); },
    close: async () => {},
  };
}

interface Fixture {
  hubs: HubRepository;
  service: HubSharingService;
  layout: MemoryLayoutStore;
  store: HubSharingStore;
  close: () => Promise<void>;
}

async function fixture(seed?: { version?: number | null; logs?: Record<string, BoardLog | string> }): Promise<Fixture> {
  const storage = new MemoryHubStorage();
  const seeded = defaultHubState('hub', 'Hub', 'board', 'Board', NOW);
  seeded.projects = [{ id: 'project', projectKey: 'project', name: 'Project', projectPath: '/repo' }];
  storage.hubs.set('hub', seeded);
  const hubs = await HubRepository.open(storage, { id: () => 'generated', now: () => NOW });
  await hubs.hub('hub').transact(draft => { operations.saveBoardWorkflow(draft, 'board', FLOW, hubs.operationDeps()); return draft; }, hubs.requireHub('hub').revision);
  const layout = new MemoryLayoutStore(seed === undefined ? {} : { version: seed.version ?? 4, logs: seed.logs ?? {} });
  const store = memorySharing();
  const service = new HubSharingService({
    hubs,
    store,
    providers: {
      createLayoutStore: (): SharedLayoutStore => layout,
      describe: (binding: SharingBinding) => description(binding),
      normalize: (_provider: SharingProviderId, settings: Record<string, string>) => settings,
      prepare: async (_hubId: string, binding: SharingBinding) => binding,
      defaultInterval: () => 5,
    },
    now: () => NOW,
    id: (() => { let n = 0; return () => 'id-' + (++n); })(),
  });
  return { hubs, service, layout, store, close: async () => { await service.close(); await hubs.close(); } };
}

function boardOf(f: Fixture, index = 0): string { return f.hubs.requireHub('hub').boards[index]!.id; }
function keyOf(f: Fixture, boardId: string): string | undefined { return f.layout.logOf === undefined ? undefined : f.service.view('hub')!.boards.find(board => board.boardId === boardId)?.key; }
function stateOf(f: Fixture, boardId: string) { return f.service.view('hub')!.boards.find(board => board.boardId === boardId)?.state; }

describe('per-board publishing service', () => {
  it('publishes the layout stamp and one log per board when the storage is empty', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    expect(f.layout.stampVersion).toBe(4);
    const key = keyOf(f, boardOf(f));
    expect(key).toBeDefined();
    expect(f.layout.logOf(key!)).toBeDefined();
    expect(f.service.view('hub')!.boards[0]).toMatchObject({ state: 'in-sync', bound: true });
    await f.close();
  });

  it('creates a board the team publishes, from its log', async () => {
    const f = await fixture({ logs: { team: publishedLog(FLOW, 'Team board', 'i') } });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    expect(f.service.view('hub')?.status).toBe('preview');
    await f.service.receive('hub');
    await f.service.getUpdates('hub');
    const created = f.hubs.requireHub('hub').boards.find(board => board.name === 'Team board');
    expect(created).toBeDefined();
    expect(f.service.view('hub')?.boards.find(board => board.name === 'Team board')).toMatchObject({ state: 'in-sync', bound: true });
    await f.close();
  });

  it('applies a team stage rename and migrates the local tasks in the same update', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => {
      draft.tasks.push({
        id: 'task', boardId, projectId: 'project', title: 'T', description: '',
        columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
        history: [{ kind: 'created', at: NOW, columnId: 'backlog' }], createdAt: NOW, updatedAt: NOW,
      } as never);
      return draft;
    }, hub.revision);
    const key = keyOf(f, boardId)!;
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.service.getUpdates('hub');
    expect(f.hubs.requireHub('hub').tasks.find(candidate => candidate.id === 'task')!.columnId).toBe('inbox');
    expect(f.hubs.requireHub('hub').boards[0]!.workflowYaml).toContain('id: inbox');
    await f.close();
  });

  it('refuses to publish a board that has unapplied team events', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.service.check('hub', true);
    await expect(f.service.publishBoard('hub', boardId)).rejects.toThrow(expect.objectContaining({ code: 'SHARING_PUBLISH_BLOCKED' }));
    await f.close();
  });

  it('publishes a renamed board as its own event, clearing the draft', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => { draft.boards[0]!.name = 'Renamed'; return draft; }, hub.revision);
    const key = keyOf(f, boardId)!;
    expect(stateOf(f, boardId)).toBe('draft');
    const before = (await f.layout.readLog(key))!.log.length;
    await f.service.publishBoard('hub', boardId);
    expect(stateOf(f, boardId)).toBe('in-sync');
    const after = (await f.layout.readLog(key))!.log;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ kind: 'board.renamed', name: 'Renamed' });
    await f.close();
  });

  it('publishes one board position change without rewriting another board', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => { draft.boards.push({ ...draft.boards[0]!, id: 'second', name: 'Second' }); return draft; }, hub.revision);
    await f.service.publishAll('hub');
    const first = boardOf(f);
    const second = boardOf(f, 1);
    const firstKey = keyOf(f, first)!;
    const secondKey = keyOf(f, second)!;
    const secondLength = (await f.layout.readLog(secondKey))!.log.length;
    await f.hubs.hub('hub').transact(draft => { draft.boards.reverse(); return draft; }, f.hubs.requireHub('hub').revision);
    await f.service.publishBoard('hub', second);
    expect((await f.layout.readLog(firstKey))!.log.length).toBe(4);
    expect((await f.layout.readLog(secondKey))!.log.length).toBe(secondLength + 1);
    await f.close();
  });

  it('publishes every pending board with one action', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => { draft.boards.push({ ...draft.boards[0]!, id: 'second', name: 'Second' }); return draft; }, hub.revision);
    await f.service.publishAll('hub');
    await f.hubs.hub('hub').transact(draft => { draft.boards[0]!.name = 'First renamed'; draft.boards[1]!.name = 'Second renamed'; return draft; }, f.hubs.requireHub('hub').revision);
    expect(f.service.view('hub')!.drafts).toBe(2);
    await f.service.publishAll('hub');
    expect(f.service.view('hub')!.drafts).toBe(0);
    await f.close();
  });

  it('treats a bound board whose log is absent as a draft and republishes it', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    // Simulate a storage that lost the log.
    (f.layout as unknown as { logs: Map<string, BoardLog> }).logs.delete(key);
    await f.service.check('hub', true);
    expect(stateOf(f, boardId)).toBe('draft');
    await f.service.publishBoard('hub', boardId);
    expect(f.layout.logOf(key)).toBeDefined();
    expect(stateOf(f, boardId)).toBe('in-sync');
    await f.close();
  });

  it('applies another board even when one needs a choice', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const first = boardOf(f);
    await f.hubs.hub('hub').transact(draft => { draft.boards.push({ ...draft.boards[0]!, id: 'second', name: 'Second' }); return draft; }, f.hubs.requireHub('hub').revision);
    await f.service.publishAll('hub');
    const views = f.service.view('hub')!;
    const firstKey = views.boards.find(board => board.boardId === first)!.key!;
    const secondKey = views.boards.find(board => board.name === 'Second')!.key!;
    const snapshot = await f.layout.readLog(firstKey);
    await f.layout.appendChanges(firstKey, [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.hubs.hub('hub').saveBoardWorkflow(first, FLOW.replace('initial_column: backlog', 'initial_column: todo').replace('  - id: backlog', '  - id: todo'));
    const secondSnapshot = await f.layout.readLog(secondKey);
    await f.layout.appendChanges(secondKey, [{ kind: 'workflow.field-changed', field: 'name', value: 'Second renamed' }], { expectedHead: secondSnapshot!.head, message: 'm', at: NOW });
    await expect(f.service.getUpdates('hub')).rejects.toThrow();
    expect(f.hubs.requireHub('hub').boards.find(board => board.name === 'Second')!.workflowYaml).toContain('name: Second renamed');
    expect(stateOf(f, first)).toBe('needs-review');
    await f.close();
  });

  it('keeps a removed board that holds work as an orphan and publishes it under a new key', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => {
      draft.tasks.push({ id: 'task', boardId, projectId: 'project', title: 'T', description: '', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: NOW, updatedAt: NOW } as never);
      return draft;
    }, hub.revision);
    const key = keyOf(f, boardId)!;
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'board.removed' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.service.getUpdates('hub');
    expect(stateOf(f, boardId)).toBe('orphan');
    expect(f.hubs.requireHub('hub').tasks).toHaveLength(1);
    await f.service.publishOrphan('hub', boardId);
    expect(stateOf(f, boardId)).not.toBe('orphan');
    await f.close();
  });

  it('removes a team-removed board that holds no work', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'board.removed' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.service.getUpdates('hub');
    expect(f.hubs.requireHub('hub').boards).toHaveLength(0);
    await f.close();
  });

  it('appends a removal event when the user removes a board for the team', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    const before = (await f.layout.readLog(key))!.log.length;
    await f.service.removeBoard('hub', boardId, 'team', 'Board');
    const log = (await f.layout.readLog(key))!.log;
    expect(log).toHaveLength(before + 1);
    expect(log[log.length - 1]!.kind).toBe('board.removed');
    await f.close();
  });

  it('restores a board removed only from this installation', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    await f.service.removeBoard('hub', boardId, 'local', 'Board');
    expect(f.service.view('hub')?.removed.map(board => board.boardId)).toEqual([boardId]);
    await f.service.restore('hub', boardId);
    expect(f.service.view('hub')?.boards.find(board => board.boardId === boardId)?.bound).toBe(true);
    await f.close();
  });


  it('resolves a divergent rename with the team version and with the local version', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    // The team renames the first stage while this installation renames it differently.
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.hubs.hub('hub').transact(draft => { operations.saveBoardWorkflow(draft, boardId, FLOW.replace('initial_column: backlog', 'initial_column: intake').replace('  - id: backlog', '  - id: intake'), f.hubs.operationDeps()); return draft; }, f.hubs.requireHub('hub').revision);
    await f.service.check('hub', true);
    expect(stateOf(f, boardId)).toBe('needs-review');
    await f.service.resolve('hub', boardId, 'team');
    expect(stateOf(f, boardId)).not.toBe('needs-review');
    expect(f.hubs.requireHub('hub').boards[0]!.workflowYaml).toContain('id: inbox');
    await f.close();
  });

  it('keeps the local version after a review and leaves it a draft', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.hubs.hub('hub').transact(draft => { operations.saveBoardWorkflow(draft, boardId, FLOW.replace('initial_column: backlog', 'initial_column: intake').replace('  - id: backlog', '  - id: intake'), f.hubs.operationDeps()); return draft; }, f.hubs.requireHub('hub').revision);
    await f.service.check('hub', true);
    await f.service.resolve('hub', boardId, 'local');
    expect(f.hubs.requireHub('hub').boards[0]!.workflowYaml).toContain('id: intake');
    expect(stateOf(f, boardId)).toBe('draft');
    await f.close();
  });

  it('replaces the published boards on first connection, tombstones the dropped ones, and keeps local work', async () => {
    const f = await fixture({ logs: { team: publishedLog(SECOND, 'Team board', 'i') } });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    expect(f.service.view('hub')?.status).toBe('preview');
    await f.service.publishInitial('hub', true);
    const teamLog = f.layout.logOf('team')!;
    expect(teamLog[teamLog.length - 1]!.kind).toBe('board.removed');
    const key = keyOf(f, boardOf(f))!;
    expect(f.layout.logOf(key)).toBeDefined();
    expect(f.hubs.requireHub('hub').boards).toHaveLength(1);
    expect(f.service.view('hub')?.status).toBe('published');
    await f.close();
  });


  it('keeps a board with nothing applied and a valid stored record', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    expect(f.service.view('hub')?.boards[0]?.state).not.toBe('update-required');
    expect(f.service.publishedHubs()).toHaveLength(1);
    await f.close();
  });

  it('rejects publishing a bound board whose published events were never applied', async () => {
    const f = await fixture({ logs: { board: publishedLog(FLOW, 'Board', 'i') } });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const record = f.store.load('hub')!;
    record.bindings[boardId] = 'board';
    record.boards.board = { seq: -1, head: null, probe: null, present: false, workflow: null, name: null, projectKeys: null, rank: null, updates: 0, removal: false, incoming: null, conflict: null, problem: null };
    await f.store.save(record);
    await expect(f.service.publishBoard('hub', boardId)).rejects.toThrow(expect.objectContaining({ code: 'SHARING_PUBLISH_BLOCKED' }));
    await f.close();
  });

  it('adopts the team content on receive when the names match', async () => {
    const f = await fixture({ logs: { board: publishedLog(SECOND, 'Board', 'i') } });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    await f.service.receive('hub');
    expect(f.hubs.requireHub('hub').boards[0]!.workflowYaml).toContain('name: Second');
    expect(f.service.view('hub')!.boards[0]).toMatchObject({ state: 'in-sync', bound: true });
    await f.close();
  });

  it('replaces a published layout that uses the same board names', async () => {
    const f = await fixture({ logs: { board: publishedLog(SECOND, 'Board', 'i') } });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    await f.service.publishInitial('hub', true);
    const views = f.service.view('hub')!;
    expect(views.boards).toHaveLength(1);
    expect(views.boards[0]!.state).toBe('in-sync');
    expect(f.layout.logOf('board')!.some(event => event.kind === 'board.removed')).toBe(true);
    await f.close();
  });

  it('reconnects an orphan when the team publishes its key again', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => {
      draft.tasks.push({ id: 'task', boardId, projectId: 'project', title: 'T', description: '', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: NOW, updatedAt: NOW } as never);
      return draft;
    }, hub.revision);
    const removed = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'board.removed' }], { expectedHead: removed!.head, message: 'm', at: NOW });
    await f.service.getUpdates('hub');
    expect(stateOf(f, boardId)).toBe('orphan');
    // The team publishes the same key again.
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'workflow.replaced', text: SECOND }, { kind: 'board.renamed', name: 'Renamed board' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.service.check('hub', true);
    expect(f.service.view('hub')!.boards[0]).toMatchObject({ boardId, key, name: 'Board' });
    expect(f.hubs.requireHub('hub').boards).toHaveLength(1);
    await f.close();
  });

  it('reconnects an orphan when a new key publishes the same name', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = keyOf(f, boardId)!;
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => {
      draft.tasks.push({ id: 'task', boardId, projectId: 'project', title: 'T', description: '', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: NOW, updatedAt: NOW } as never);
      return draft;
    }, hub.revision);
    const removed = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'board.removed' }], { expectedHead: removed!.head, message: 'm', at: NOW });
    await f.service.getUpdates('hub');
    expect(stateOf(f, boardId)).toBe('orphan');
    // The team republishes the board under a fresh key with the same name.
    await f.layout.createLog('delivery', publishedLog(SECOND, 'Board', 'j'));
    await f.service.check('hub', true);
    expect(f.service.view('hub')!.boards[0]).toMatchObject({ boardId, key: 'delivery' });
    expect(f.hubs.requireHub('hub').boards).toHaveLength(1);
    await f.close();
  });

  it('refuses a team removal while the storage needs a review', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    f.layout.setReview({ code: 'SHARING_CONFLICT_COPY', message: 'A conflict copy is present.', files: ['kanban-hub (1).yaml'] });
    await f.service.check('hub', true);
    await expect(f.service.removeBoard('hub', boardId, 'team', 'Board')).rejects.toThrow(expect.objectContaining({ code: 'SHARING_CONFLICT_COPY' }));
    expect(f.layout.logOf('board')!.some(event => event.kind === 'board.removed')).toBe(false);
    await f.close();
  });

  it('restores a board that this installation deleted', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    await f.service.removeBoard('hub', boardId, 'local', 'Board');
    await f.hubs.hub('hub').transact(draft => { operations.deleteBoard(draft, boardId, f.hubs.operationDeps()); return draft; }, f.hubs.requireHub('hub').revision);
    expect(f.hubs.requireHub('hub').boards).toHaveLength(0);
    await f.service.restore('hub', boardId);
    expect(f.hubs.requireHub('hub').boards).toHaveLength(1);
    expect(f.service.view('hub')?.removed).toEqual([]);
    await f.close();
  });

  it('refuses every write while the storage requires a review', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    f.layout.setReview({ code: 'SHARING_CONFLICT_COPY', message: 'A conflict copy is present.', files: ['kanban-hub (1).yaml'] });
    await f.service.check('hub', true);
    expect(f.service.view('hub')!.blockers[0]!.code).toBe('SHARING_CONFLICT_COPY');
    await expect(f.service.publishBoard('hub', boardOf(f))).rejects.toThrow(expect.objectContaining({ code: 'SHARING_CONFLICT_COPY' }));
    await expect(f.service.getUpdates('hub')).rejects.toThrow(expect.objectContaining({ code: 'SHARING_CONFLICT_COPY' }));
    await f.close();
  });

  it('offers the connection choice for a storage that holds logs without a stamp', async () => {
    const f = await fixture({ version: null, logs: { board: publishedLog(SECOND, 'Board', 'i') } });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const view = f.service.view('hub')!;
    expect(view.status).toBe('preview');
    expect(view.previewBoards?.map(board => board.name)).toEqual(['Board']);
    await f.close();
  });

  it('upgrades an older layout by publishing the current one beside it', async () => {
    const f = await fixture({ version: 3, logs: {} });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    expect(f.layout.stampVersion).toBe(4);
    expect(f.service.view('hub')!.status).toBe('published');
    expect(f.service.view('hub')!.notice?.code).toBe('SHARING_LAYOUT_OUTDATED');
    await f.close();
  });

  it('refuses to publish over a layout from a newer plugin', async () => {
    const f = await fixture({ version: 9 });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    expect(f.service.view('hub')).toMatchObject({ status: 'needs-review' });
    await expect(f.service.publishAll('hub')).rejects.toBeInstanceOf(KanbanError);
    await f.close();
  });
});
