import { describe, expect, it, vi } from 'vitest';
import type { KanbanSnapshot, Task } from '../../src/shared/types.js';
import { DrawerNavigationCoordinator, type DrawerNavigationPorts } from '../../src/client/drawer-navigation-coordinator.js';
import { createBoardPageState, taskPageState } from '../../src/client/page-state.js';
import type { DrawerSessionList } from '../../src/client/drawer-navigation.js';
import { conversationOf } from '../../src/client/drawer-view.js';

function task(overrides: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Task', description: '', projectId: 'p1', columnId: 'c1', position: 1, sessionIds: ['s1', 's2'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: 'now', updatedAt: 'now', ...overrides };
}

function snapshotOf(tasks: readonly Task[]): KanbanSnapshot {
  return { sequence: 1, stateRevision: 1, conversations: {}, sharing: {}, state: { hubs: [{ tasks }] } } as unknown as KanbanSnapshot;
}

/** The Session the host just selected: the only row retained as mainView. */
const main = { retainedBy: { mainView: 1 } };
const child = (parentId: string) => ({ origin: 'subagent' as const, parentId, retainedBy: { mainView: 1 } });

function harness(options: { tasks?: readonly Task[]; rows?: DrawerSessionList['byId']; drawer?: string | null; panel?: string | null; refresh?: () => Promise<void>; attach?: DrawerNavigationPorts['attachFork']; timeoutMs?: number; now?: () => number } = {}) {
  let panel: string | null = options.panel ?? 'kanban';
  const listeners = new Set<() => void>();
  const panelSelections: Array<string | null> = [];
  const panelPort = {
    activePanel: () => panel,
    selectPanel: (id: string) => { panelSelections.push(id); panel = id; for (const listener of [...listeners]) listener(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const navigate = (next: string | null) => { panelSelections.length = 0; panel = next; for (const listener of [...listeners]) listener(); };
  let rows: DrawerSessionList['byId'] = options.rows ?? {};
  const catalogListeners = new Set<() => void>();
  const list = () => ({ byId: rows });
  const refresh = vi.fn(options.refresh ?? (async () => {}));
  const tasks = options.tasks ?? [task()];
  const pageState = createBoardPageState();
  pageState.selectedTaskId = options.drawer === undefined ? 't1' : options.drawer;
  const attachFork = vi.fn(options.attach ?? (async (taskId: string, _parent: string, sessionId: string) => snapshotOf([task({ id: taskId, sessionIds: ['s1', 's2', sessionId] })])));
  const report = vi.fn();
  const coordinator = new DrawerNavigationCoordinator({
    panelId: 'kanban',
    panel: panelPort,
    sessions: {
      list,
      refresh,
      subagentAddress: sessionId => rows[sessionId]?.origin === 'subagent' && rows[sessionId]?.parentId !== undefined ? { parentSessionId: rows[sessionId]!.parentId!, sessionId, mode: 'continuable' } : undefined,
      subscribe: (listener: () => void) => { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; },
    },
    snapshot: () => snapshotOf(tasks),
    pageState,
    attachFork,
    report,
    ...(options.timeoutMs === undefined ? {} : { classificationTimeoutMs: options.timeoutMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  coordinator.start();
  return {
    coordinator, pageState, navigate, panelPort, refresh, attachFork, report, panelSelections,
    panel: () => panel,
    setRows: (next: DrawerSessionList['byId']) => { rows = next; for (const listener of [...catalogListeners]) listener(); },
    page: () => taskPageState(pageState, 't1'),
  };
}

describe('drawer navigation coordinator', () => {
  it('selects an owned conversation and restores the Kanban panel in the same update', () => {
    const f = harness({ rows: { s2: main } });
    f.navigate(null);
    expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 's2', selectionRequired: false });
    expect(f.panel()).toBe('kanban');
    expect(f.panelSelections).toEqual(['kanban']);
    expect(f.attachFork).not.toHaveBeenCalled();
    expect(f.coordinator.getSnapshot()).toBeGreaterThan(0);
  });

  it('peeks an owned descendant and does not change the host selection', () => {
    const f = harness({ rows: { s1: {}, child: child('s1') } });
    f.navigate(null);
    expect(f.page().view).toEqual({ kind: 'peek', conversationId: null, selectionRequired: false, target: { parentSessionId: 's1', sessionId: 'child', mode: 'continuable' } });
    expect(f.panelSelections).toEqual(['kanban']);
  });

  it('leaves a foreign target native and changes nothing', () => {
    const f = harness({ rows: { s1: {}, other: {}, child: child('other') } });
    f.navigate(null);
    expect(f.page().view).toEqual({ kind: 'conversation', sessionId: null, selectionRequired: false });
    expect(f.panelSelections).toEqual([]);
    expect(f.panel()).toBeNull();
  });

  it('leaves a closed conversation native', () => {
    const f = harness({ tasks: [task({ sessionIds: ['s1'], closedSessionIds: ['s1'] })], rows: { s1: main } });
    f.navigate(null);
    expect(f.panelSelections).toEqual([]);
    expect(conversationOf(f.page().view)).toBeNull();
  });

  it('fails closed for a cyclic lineage', () => {
    const f = harness({ rows: { a: child('b'), b: child('a') } });
    f.navigate(null);
    expect(f.panelSelections).toEqual([]);
  });

  it('does nothing without an open drawer or when another panel was active', () => {
    const noDrawer = harness({ rows: { s2: main }, drawer: null });
    noDrawer.navigate(null);
    expect(noDrawer.panelSelections).toEqual([]);
    const otherPanel = harness({ rows: { s2: main }, panel: 'settings' });
    otherPanel.navigate(null);
    expect(otherPanel.panelSelections).toEqual([]);
  });

  it('claims a fresh fork after one list refresh and selects the attached conversation', async () => {
    let resolveRefresh: (() => void) | undefined;
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: () => new Promise<void>(resolve => { resolveRefresh = resolve; }),
    });
    f.page().view = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    f.navigate(null);
    // The placeholder has no parent yet, so nothing is claimed before the refresh.
    expect(f.attachFork).not.toHaveBeenCalled();
    expect(f.panelSelections).toEqual([]);
    f.setRows({ s1: {}, fresh: { ...main, parentId: 's1' } });
    resolveRefresh?.();
    await vi.waitFor(() => expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 'fresh', selectionRequired: false }));
    expect(f.attachFork).toHaveBeenCalledWith('t1', 's1', 'fresh');
    expect(f.page().claim).toBeNull();
    expect(f.panelSelections).toEqual(['kanban']);
    expect(f.refresh).toHaveBeenCalledOnce();
  });

  it('shows the failure when the host refuses the claim', async () => {
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: async () => {},
      attach: async () => { throw { code: 'TASK_BUSY', message: 'The task is busy; the branch could not be attached yet.' }; },
    });
    f.setRows({ s1: {}, fresh: { ...main, parentId: 's1' } });
    f.navigate(null);
    await vi.waitFor(() => expect(f.page().claim?.error ?? '').toContain('busy'));
    expect(conversationOf(f.page().view)).toBeNull();
    expect(f.panelSelections).toEqual(['kanban']);
    expect(f.report).toHaveBeenCalled();
  });

  it('does not claim a Session it cannot prove against an open conversation', async () => {
    // The drawer presents no conversation, so there is nothing to prove the branch against.
    const f = harness({ rows: { blank: main }, refresh: async () => {} });
    f.navigate(null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.attachFork).not.toHaveBeenCalled();
    expect(f.panelSelections).toEqual([]);
    expect(f.refresh).toHaveBeenCalledOnce();
  });

  it('claims a branch the host proves against the open conversation', async () => {
    const f = harness({ rows: { s1: {}, fresh: main }, refresh: async () => {} });
    f.page().view = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    f.navigate(null);
    await vi.waitFor(() => expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 'fresh', selectionRequired: false }));
    expect(f.attachFork).toHaveBeenCalledWith('t1', 's1', 'fresh');
    expect(f.panelSelections).toEqual(['kanban']);
    expect(f.page().claim).toBeNull();
  });

  it('keeps the native navigation when the host refuses the branch', async () => {
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: async () => {},
      attach: async () => { throw { code: 'FORK_LINEAGE_MISMATCH', message: 'The branch does not inherit this conversation.' }; },
    });
    f.page().view = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    f.navigate(null);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.panelSelections).toEqual([]);
    expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: false });
    // The refusal is a normal outcome, not a failure to report: no pending claim, no report.
    expect(f.page().claim).toBeNull();
    expect(f.report).not.toHaveBeenCalled();
  });

  it('leaves an ordinary chat native after the host refuses to prove it as a branch', async () => {
    // An ordinary chat is listed without a parent, so the drawer asks the host once and the
    // host's refusal ends the claim without presenting a failure or re-selecting the panel.
    const f = harness({
      rows: { s1: {}, chat: main },
      refresh: async () => {},
      attach: async () => { throw { code: 'FORK_LINEAGE_MISMATCH', message: 'Only a branch of a conversation of this task can be attached.' }; },
    });
    f.page().view = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    f.navigate(null);
    await vi.waitFor(() => expect(f.attachFork).toHaveBeenCalledWith('t1', 's1', 'chat'));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.panelSelections).toEqual([]);
    expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: false });
    expect(f.page().claim).toBeNull();
    expect(f.report).not.toHaveBeenCalled();
  });

  it('drops a classification that the timeout expired', async () => {
    let clock = 0;
    let resolveRefresh: (() => void) | undefined;
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: () => new Promise<void>(resolve => { resolveRefresh = resolve; }),
      timeoutMs: 100,
      now: () => clock,
    });
    f.navigate(null);
    clock = 500;
    f.setRows({ s1: {}, fresh: { ...main, parentId: 's1' } });
    resolveRefresh?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.attachFork).not.toHaveBeenCalled();
    expect(f.panelSelections).toEqual([]);
  });

  it('supersedes a pending classification when the catalog moves the main Session', async () => {
    const pending: Array<() => void> = [];
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: () => new Promise<void>(resolve => { pending.push(resolve); }),
    });
    f.navigate(null);
    // The person selects another Session while the fork lineage is still loading.
    f.setRows({ s2: main });
    // The refresh then reveals the fork, but that classification is stale.
    f.setRows({ s1: {}, fresh: { ...main, parentId: 's1' }, s2: main });
    pending[0]?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.attachFork).not.toHaveBeenCalled();
    expect(f.panelSelections).toEqual([]);
    expect(conversationOf(f.page().view)).toBeNull();
  });

  it('resolves a target the catalog reports only after one refresh', async () => {
    const f = harness({ rows: {} });
    f.navigate(null);
    expect(f.panelSelections).toEqual([]);
    // The host retained the target before the catalog listed its row.
    f.setRows({ s2: main });
    await vi.waitFor(() => expect(f.panelSelections).toEqual(['kanban']));
    expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 's2', selectionRequired: false });
    expect(f.refresh).toHaveBeenCalledOnce();
  });

  it('keeps a pending classification while the catalog reports no selected Session', async () => {
    const pending: Array<() => void> = [];
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: () => new Promise<void>(resolve => { pending.push(resolve); }),
    });
    f.page().view = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    f.navigate(null);
    // A fresh branch is retained before any row describes it, so the catalog briefly
    // reports no mainView. That is not another navigation.
    f.setRows({ s1: {}, fresh: {} });
    f.setRows({ s1: {}, fresh: { ...main, parentId: 's1' } });
    pending[0]?.();
    await vi.waitFor(() => expect(f.attachFork).toHaveBeenCalledOnce());
    expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 'fresh', selectionRequired: false });
  });

  it('keeps the native navigation when the catalog refresh fails', async () => {
    const f = harness({ rows: { fresh: main }, refresh: async () => { throw new Error('offline'); } });
    f.navigate(null);
    await vi.waitFor(() => expect(f.report).toHaveBeenCalled());
    expect(f.panelSelections).toEqual([]);
    expect(f.attachFork).not.toHaveBeenCalled();
  });

  it('leaves the next panel exit to the host when the drawer initiates it', () => {
    const f = harness({ rows: { s2: main } });
    f.coordinator.suppressNextNavigation('s2');
    f.navigate(null);
    expect(f.panelSelections).toEqual([]);
    expect(conversationOf(f.page().view)).toBeNull();
    // The suppression covers one navigation only.
    f.navigate('kanban');
    f.navigate(null);
    expect(f.panelSelections).toEqual(['kanban']);
  });

  it('reports a proven branch the host could not attach', async () => {
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: async () => {},
      attach: async () => { throw { code: 'TASK_BUSY', message: 'The task stayed busy while the branch was attached. Try again.' }; },
    });
    f.page().view = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    f.navigate(null);
    await vi.waitFor(() => expect(f.page().claim?.error ?? '').toContain('busy'));
    expect(f.page().claim?.sessionId).toBe('fresh');
    expect(f.panelSelections).toEqual(['kanban']);
  });

  it('does not claim a branch taken while peeking a descendant', async () => {
    const f = harness({ rows: { s1: {}, child: { origin: 'subagent', parentId: 's1' }, fresh: main }, refresh: async () => {} });
    f.page().view = { kind: 'peek', conversationId: 's1', selectionRequired: false, target: { parentSessionId: 's1', sessionId: 'child', mode: 'continuable' } };
    f.navigate(null);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.attachFork).not.toHaveBeenCalled();
    expect(f.panelSelections).toEqual([]);
  });

  it('keeps a tab the person picked while the host attached the branch', async () => {
    let resolveAttach: ((snapshot: KanbanSnapshot) => void) | undefined;
    const f = harness({
      rows: { s1: {}, fresh: main },
      refresh: async () => {},
      attach: () => new Promise(resolve => { resolveAttach = resolve; }),
    });
    f.page().view = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    f.navigate(null);
    await vi.waitFor(() => expect(f.attachFork).toHaveBeenCalled());
    f.page().view = { kind: 'conversation', sessionId: 's2', selectionRequired: false };
    resolveAttach?.(snapshotOf([task({ id: 't1', sessionIds: ['s1', 's2', 'fresh'] })]));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.page().view).toEqual({ kind: 'conversation', sessionId: 's2', selectionRequired: false });
    expect(f.page().claim).toBeNull();
  });

  it('exposes a change count to subscribed surfaces', () => {
    const f = harness({ rows: { s2: main } });
    const listener = vi.fn();
    const dispose = f.coordinator.subscribe(listener);
    f.navigate(null);
    expect(listener).toHaveBeenCalled();
    const version = f.coordinator.getSnapshot();
    dispose();
    f.navigate(null);
    expect(f.coordinator.getSnapshot()).toBeGreaterThan(version);
  });
});
