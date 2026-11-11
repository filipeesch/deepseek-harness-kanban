import { describe, expect, it } from 'vitest';
import { BoardSyncUnit, type BoardCursor, type BoardCursorStore } from '../../src/host/sharing/board-sync.js';
import { MemoryLayoutStore } from '../support/memory-layout-store.js';
import { CONTRACT_WORKFLOW, contractManifest } from '../support/layout-store-contract.js';
import type { LocalBoardView } from '../../src/domain/sharing/board-plan.js';
import { appendEvents, createBoardLog, encodeBoardLog } from '../../src/domain/journal/log.js';
import { stageRenames } from '../../src/domain/journal/migrate.js';

const AT = '2026-01-01T00:00:00.000Z';
const NL = String.fromCharCode(10);

class Cursors implements BoardCursorStore {
  readonly values = new Map<string, BoardCursor>();
  read(key: string): BoardCursor | undefined { return this.values.get(key); }
  write(key: string, cursor: BoardCursor): void { this.values.set(key, cursor); }
}

function board(workflow: string, overrides: Partial<LocalBoardView> = {}): LocalBoardView {
  return { boardId: 'board-' + 'delivery', name: 'Delivery', workflow, tasks: 0, taskColumns: [], ...overrides };
}

function storedLog(text: string): string {
  return JSON.stringify(encodeBoardLog(createBoardLog(text)));
}

function unit(options: {
  workflow: string;
  cursors: Cursors;
  store: MemoryLayoutStore;
  applied?: Array<{ boardId: string; text: string; renames: unknown }>;
  boards?: Record<string, LocalBoardView>;
}) {
  const boards = options.boards ?? { delivery: board(options.workflow) };
  return new BoardSyncUnit({
    layout: options.store,
    cursors: options.cursors,
    readLocal: key => boards[key],
    storeApplied: async (boardId, text, renames) => { options.applied?.push({ boardId, text, renames }); boards[Object.keys(boards).find(key => boards[key]!.boardId === boardId)!] = { ...boards[Object.keys(boards).find(key => boards[key]!.boardId === boardId)!]!, workflow: text }; },
    now: () => AT,
    allocate: () => 'allocated-1',
  });
}

describe('per-board synchronization unit', () => {
  it('applies only the board whose log advanced', async () => {
    const base = CONTRACT_WORKFLOW;
    const advanced = appendEvents(createBoardLog(base), [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], AT);
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: base } });
    // Seed two boards: only "delivery" gets an event.
    const other = (store as unknown as { logs: Map<string, string> });
    other.logs.set('ops', storedLog(base));
    const cursors = new Cursors();
    const applied: Array<{ boardId: string; text: string; renames: unknown }> = [];
    const boards = { delivery: board(base), ops: { ...board(base), boardId: 'board-ops', name: 'Ops' } };
    const sync = unit({ workflow: base, cursors, store, applied, boards });
    const read = await store.readLog('delivery');
    await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: AT });
    expect(advanced.events).toHaveLength(1);

    const first = await sync.apply('delivery', { key: 'delivery', name: 'Delivery' });
    expect(first).toMatchObject({ applied: true, events: 1 });
    expect(cursors.read('delivery')?.seq).toBe(1);
    expect(applied).toHaveLength(1);

    const second = await sync.apply('ops', { key: 'ops', name: 'Ops' });
    expect(second).toEqual({ applied: false, reason: 'nothing' });
    expect(cursors.read('ops')).toBeUndefined();
  });

  it('carries the renames of an applied batch', async () => {
    const log = appendEvents(createBoardLog(CONTRACT_WORKFLOW), [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], AT);
    expect(stageRenames(log.events)).toEqual([{ key: 's1', from: 'backlog', to: 'inbox' }]);
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } });
    const read = await store.readLog('delivery');
    await store.appendChanges('delivery', [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], { expectedHead: read!.head, message: 'm', at: AT });
    const applied: Array<{ boardId: string; text: string; renames: unknown }> = [];
    const sync = unit({ workflow: CONTRACT_WORKFLOW, cursors: new Cursors(), store, applied });
    const result = await sync.apply('delivery', { key: 'delivery', name: 'Delivery' });
    expect(result).toMatchObject({ applied: true, events: 1 });
    expect(applied[0]?.renames).toEqual([{ key: 's1', from: 'backlog', to: 'inbox' }]);
    expect(applied[0]?.text).toContain('id: inbox');
  });

  it('refuses an application that would orphan a task, without advancing the cursor', async () => {
    const twoStages = ['name: Delivery', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', '  - id: plan', '    key: s2', '    label: Plan', ''].join(NL);
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: twoStages } });
    const read = await store.readLog('delivery');
    await store.appendChanges('delivery', [{ kind: 'stage.removed', key: 's2' }], { expectedHead: read!.head, message: 'm', at: AT });
    const cursors = new Cursors();
    const boards = { delivery: board(twoStages, { tasks: 2, taskColumns: [{ columnId: 'plan', tasks: 2 }] }) };
    const sync = unit({ workflow: twoStages, cursors, store, boards });
    expect(await sync.apply('delivery', { key: 'delivery', name: 'Delivery' })).toEqual({ applied: false, reason: 'orphan', columnIds: ['plan'] });
    expect(cursors.read('delivery')).toBeUndefined();
  });

  it('reports an identity divergence instead of applying it', async () => {
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } });
    const read = await store.readLog('delivery');
    await store.appendChanges('delivery', [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], { expectedHead: read!.head, message: 'm', at: AT });
    const renamed = CONTRACT_WORKFLOW.replace('  - id: backlog', '  - id: todo');
    const sync = unit({ workflow: renamed, cursors: new Cursors(), store });
    expect(await sync.apply('delivery', { key: 'delivery', name: 'Delivery' })).toMatchObject({ applied: false, reason: 'conflict', conflict: 'identity' });
  });

  it('publishes derived events and records the head', async () => {
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } });
    const cursors = new Cursors();
    const read = await store.readLog('delivery');
    cursors.write('delivery', { seq: 0, head: read!.head, probe: read!.probe });
    const local = CONTRACT_WORKFLOW.replace('label: Backlog', 'label: Inbox');
    const sync = unit({ workflow: local, cursors, store });
    const result = await sync.publish('delivery');
    expect(result).toMatchObject({ published: true, events: 1 });
    if (result.published) expect(cursors.read('delivery')?.head).toBe(result.head);
    const after = await store.readLog('delivery');
    expect(after!.log.events).toHaveLength(1);
  });

  it('refuses to publish while team events are unapplied', async () => {
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } });
    const read = await store.readLog('delivery');
    await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: AT });
    const sync = unit({ workflow: CONTRACT_WORKFLOW.replace('label: Backlog', 'label: Inbox'), cursors: new Cursors(), store });
    expect(await sync.publish('delivery')).toEqual({ published: false, reason: 'updates-pending' });
  });

  it('publishes nothing when the board did not change', async () => {
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } });
    const cursors = new Cursors();
    const read = await store.readLog('delivery');
    cursors.write('delivery', { seq: 0, head: read!.head, probe: read!.probe });
    const sync = unit({ workflow: CONTRACT_WORKFLOW, cursors, store });
    expect(await sync.publish('delivery')).toEqual({ published: false, reason: 'nothing' });
  });

  it('reports a status for a board and nothing for a board it does not hold', async () => {
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } });
    const sync = unit({ workflow: CONTRACT_WORKFLOW, cursors: new Cursors(), store });
    const status = await sync.status({ key: 'delivery', name: 'Delivery' }, 'delivery');
    expect(status?.state).toBe('in-sync');
    expect(await sync.status({ key: 'missing', name: 'Missing' }, 'missing')).toBeNull();
  });

  it('records what a check observed without applying it', async () => {
    const store = new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } });
    const read = await store.readLog('delivery');
    await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: AT });
    const cursors = new Cursors();
    const sync = unit({ workflow: CONTRACT_WORKFLOW, cursors, store });
    expect(await sync.observe('delivery')).toMatchObject({ kind: 'applies', events: 1 });
    expect(cursors.read('delivery')?.seq).toBe(0);
    expect(cursors.read('delivery')?.probe).toBeDefined();
  });
});
