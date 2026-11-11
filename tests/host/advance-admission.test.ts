import { describe, expect, it } from 'vitest';
import { admitTurnAdvance, type AdvanceAdmissionDeps } from '../../src/host/advance-admission.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import { resolveAutoAdvance, type AutoAdvancePlan } from '../../src/domain/auto-advance.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import { NO_PENDING_USER_WORK, type Board, type HubState, type HubTask, type PendingUserWork, type Project } from '../../src/shared/types.js';
import { transitions } from '../support/transition-rules.js';

const now = '2026-01-01T00:00:00.000Z';

function board(): Board {
  return {
    id: 'board', name: 'Board', workflowYaml: '', createdAt: now, updatedAt: now,
    workflow: {
      name: 'Flow', initialColumnId: 'backlog',
      columns: [{ id: 'backlog', name: 'Backlog' }, { id: 'plan', name: 'Plan', onEnterPrompt: 'Plan it.' }, { id: 'done', name: 'Done' }],
      groups: [],
    },
  };
}
/** The same stages with an authored branch, so a recording can choose between them. */
function routedBoard(): Board {
  const value = board();
  value.workflow.columns[0] = { ...value.workflow.columns[0]!, allowedTransitions: transitions('done', 'plan') };
  return value;
}
const project: Project = { id: 'project', projectKey: 'project', name: 'Project', projectPath: '/repo' };
function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
    sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    autoMode: { enabled: true }, createdAt: now, updatedAt: now, ...overrides,
  };
}
function hub(value: HubTask, target: Board = board()): HubState {
  return { id: 'hub', name: 'Hub', revision: 1, projects: [project], boards: [target], tasks: [value], notes: [], createdAt: now, updatedAt: now };
}
const plan = (): AutoAdvancePlan => resolveAutoAdvance(board().workflow, 'backlog');
const routedPlan = (columnId: string): AutoAdvancePlan => {
  const target = routedBoard();
  return resolveAutoAdvance(target.workflow, 'backlog', { exact: target.workflow.columns.find(column => column.id === columnId)! });
};

function fixture(overrides: Partial<AdvanceAdmissionDeps> = {}, seed: { board?: Board; task?: HubTask } = {}) {
  const target = seed.board ?? board();
  const state = { hub: hub(seed.task ?? task(), target) };
  const pending: PendingUserWork[] = [NO_PENDING_USER_WORK];
  const created: string[] = [];
  const dispatched: number[] = [];
  const reported: unknown[] = [];
  const deps: AdvanceAdmissionDeps = {
    locate: (): LocatedTask => ({ hubId: 'hub', hub: state.hub, board: state.hub.boards[0]!, project, task: state.hub.tasks[0]! }),
    transact: async (_hubId, change) => { change(state.hub); },
    resolveSession: async () => { created.push('session-2'); return 'session-2'; },
    pending: async () => pending[pending.length - 1]!,
    dispatch: async () => { dispatched.push(1); },
    report: error => { reported.push(error); },
    ...overrides,
  };
  return { deps, state, pending, created, dispatched, reported };
}

/** The auto-mode origin every pre-existing case exercises. */
const admitAuto = (deps: AdvanceAdmissionDeps, taskId: string, value: AutoAdvancePlan) => admitTurnAdvance(deps, taskId, value, 'auto');
/** The declared-transition origin: the agent armed this turn on its own. */
const admitDeclared = (deps: AdvanceAdmissionDeps, taskId: string, value: AutoAdvancePlan) => admitTurnAdvance(deps, taskId, value, 'agent');
const declared = (columnId: string, reason = 'The work needs a plan.') => ({ fromColumnId: 'backlog', columnId, at: now, reason });

describe('turn-end advance admission', () => {
  it('persists one captured transition and dispatches it', async () => {
    const f = fixture();
    await admitAuto(f.deps, 'task', plan());
    const value = f.state.hub.tasks[0]!;
    expect(value.pendingTransition).toMatchObject({ fromColumnId: 'backlog', columnId: 'plan', mode: 'run', status: 'waiting', origin: 'auto', text: 'Plan it.', sessionId: 's1' });
    expect(f.dispatched).toHaveLength(1);
    expect(f.created).toHaveLength(0);
  });

  it('creates the target conversation when every tab is closed', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ closedSessionIds: ['s1'] });
    await admitAuto(f.deps, 'task', plan());
    expect(f.created).toEqual(['session-2']);
    expect(f.state.hub.tasks[0]!.pendingTransition).toMatchObject({ mode: 'run', sessionId: 'session-2' });
  });

  it('re-reads pending user work right before the durable decision', async () => {
    const f = fixture();
    f.pending.push(pendingUserWork(['decision-question']));
    await admitAuto(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
  });

  it('holds instead of failing when the pending read is unavailable', async () => {
    const f = fixture();
    f.deps.pending = async () => { throw new Error('inbox unavailable'); };
    await admitAuto(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
    expect(f.reported).toHaveLength(1);
  });

  it('does not admit when the task moved before the decision', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ columnId: 'plan' });
    await admitAuto(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
  });

  it('does not admit when a capture could not be re-resolved, and fails loud for a changed destination', async () => {
    const f = fixture();
    const changed = { ...plan(), destination: board().workflow.columns.find(column => column.id === 'done') };
    await expect(admitAuto(f.deps, 'task', changed)).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('leaves the task unchanged when auto mode was disabled before the decision', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ autoMode: undefined });
    await admitAuto(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('admits the recorded destination and stops there', async () => {
    const f = fixture({}, {
      board: routedBoard(),
      task: task({ recordedTransition: { fromColumnId: 'backlog', columnId: 'plan', at: now } }),
    });
    await admitAuto(f.deps, 'task', routedPlan('plan'));
    expect(f.state.hub.tasks[0]!.pendingTransition).toMatchObject({ fromColumnId: 'backlog', columnId: 'plan', mode: 'run', text: 'Plan it.' });
    expect(f.state.hub.tasks[0]!.pendingTransition?.origin).toBe('auto');
  });

  it('rejects a recording that changed to another target before the decision', async () => {
    const f = fixture({}, {
      board: routedBoard(),
      task: task({ recordedTransition: { fromColumnId: 'backlog', columnId: 'done', at: now } }),
    });
    await expect(admitAuto(f.deps, 'task', routedPlan('plan'))).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('rejects a recording that was removed between the evaluation and the admission', async () => {
    const f = fixture({}, { board: routedBoard(), task: task() });
    await expect(admitAuto(f.deps, 'task', routedPlan('plan'))).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('rejects a recording that stopped resolving with its own failure code', async () => {
    const f = fixture({}, {
      board: board(),
      task: task({ recordedTransition: { fromColumnId: 'backlog', columnId: 'gone', at: now } }),
    });
    await expect(admitAuto(f.deps, 'task', plan())).rejects.toMatchObject({ code: 'TRANSITION_STALE' });
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('does not admit a task that already carries the agent pause', async () => {
    const f = fixture({}, { task: task({ autoMode: { enabled: true, hold: { reason: 'Review the diff', at: now } } }) });
    await admitAuto(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
  });

  it('refuses to commit when the task was paused between the decision and the transaction', async () => {
    const f = fixture();
    f.deps.pending = async () => {
      f.state.hub.tasks[0] = task({ autoMode: { enabled: true, hold: { reason: 'Review the diff', at: now } } });
      return NO_PENDING_USER_WORK;
    };
    await expect(admitAuto(f.deps, 'task', plan())).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
  });

  it('admits a declared transition with auto mode disabled and carries its reason', async () => {
    const f = fixture({}, { board: routedBoard(), task: task({ autoMode: undefined, recordedTransition: declared('plan') }) });
    await admitDeclared(f.deps, 'task', routedPlan('plan'));
    expect(f.state.hub.tasks[0]!.pendingTransition).toMatchObject({
      fromColumnId: 'backlog', columnId: 'plan', mode: 'run', origin: 'agent', reason: 'The work needs a plan.',
    });
    expect(f.state.hub.tasks[0]!.autoMode).toBeUndefined();
    expect(f.dispatched).toHaveLength(1);
  });

  it('carries a declared reason on an auto-mode advance too', async () => {
    const f = fixture({}, { board: routedBoard(), task: task({ recordedTransition: declared('plan', 'Choose the plan stage.') }) });
    await admitAuto(f.deps, 'task', routedPlan('plan'));
    expect(f.state.hub.tasks[0]!.pendingTransition).toMatchObject({ origin: 'auto', reason: 'Choose the plan stage.' });
  });

  it('does not admit a declared origin without a declaration', async () => {
    const f = fixture({}, { board: routedBoard(), task: task({ autoMode: undefined }) });
    await admitDeclared(f.deps, 'task', routedPlan('plan'));
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('does not admit a declared origin for a recording stored without a reason', async () => {
    const f = fixture({}, { board: routedBoard(), task: task({ autoMode: undefined, recordedTransition: { fromColumnId: 'backlog', columnId: 'plan', at: now } }) });
    await admitDeclared(f.deps, 'task', routedPlan('plan'));
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('refuses to commit when the declaration was cleared before the transaction', async () => {
    const f = fixture({}, { board: routedBoard(), task: task({ autoMode: undefined, recordedTransition: declared('plan') }) });
    const pending = f.deps.pending;
    f.deps.pending = async value => {
      const result = await pending(value);
      f.state.hub.tasks[0] = task({ autoMode: undefined });
      return result;
    };
    await expect(admitDeclared(f.deps, 'task', routedPlan('plan'))).rejects.toMatchObject({ code: 'TRANSITION_STALE' });
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('clears a recorded pause in the same transaction that admits the advance', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ autoMode: { enabled: true, pause: { reason: 'turn-aborted', at: now } } });
    await admitAuto(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.autoMode).toEqual({ enabled: true });
  });
});
