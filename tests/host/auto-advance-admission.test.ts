import { describe, expect, it } from 'vitest';
import { admitAutoAdvance, type AutoAdvanceAdmissionDeps } from '../../src/host/auto-advance-admission.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import { resolveAutoAdvance, type AutoAdvancePlan } from '../../src/domain/auto-advance.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import { NO_PENDING_USER_WORK, type Board, type HubState, type HubTask, type PendingUserWork, type Project } from '../../src/shared/types.js';

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
const project: Project = { id: 'project', name: 'Project', projectPath: '/repo' };
function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
    sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    autoMode: { enabled: true }, createdAt: now, updatedAt: now, ...overrides,
  };
}
function hub(value: HubTask): HubState {
  return { id: 'hub', name: 'Hub', revision: 1, projects: [project], boards: [board()], tasks: [value], notes: [], createdAt: now, updatedAt: now };
}
const plan = (): AutoAdvancePlan => resolveAutoAdvance(board().workflow, 'backlog');

function fixture(overrides: Partial<AutoAdvanceAdmissionDeps> = {}) {
  const state = { hub: hub(task()) };
  const pending: PendingUserWork[] = [NO_PENDING_USER_WORK];
  const created: string[] = [];
  const dispatched: number[] = [];
  const reported: unknown[] = [];
  const deps: AutoAdvanceAdmissionDeps = {
    locate: (): LocatedTask => ({ hubId: 'hub', hub: state.hub, board: board(), project, task: state.hub.tasks[0]! }),
    transact: async (_hubId, change) => { change(state.hub); },
    resolveSession: async () => { created.push('session-2'); return 'session-2'; },
    pending: async () => pending[pending.length - 1]!,
    dispatch: async () => { dispatched.push(1); },
    report: error => { reported.push(error); },
    ...overrides,
  };
  return { deps, state, pending, created, dispatched, reported };
}

describe('automatic advance admission', () => {
  it('persists one captured transition and dispatches it', async () => {
    const f = fixture();
    await admitAutoAdvance(f.deps, 'task', plan());
    const value = f.state.hub.tasks[0]!;
    expect(value.pendingTransition).toMatchObject({ fromColumnId: 'backlog', columnId: 'plan', mode: 'run', status: 'waiting', origin: 'auto', text: 'Plan it.', sessionId: 's1' });
    expect(f.dispatched).toHaveLength(1);
    expect(f.created).toHaveLength(0);
  });

  it('creates the target conversation when every tab is closed', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ closedSessionIds: ['s1'] });
    await admitAutoAdvance(f.deps, 'task', plan());
    expect(f.created).toEqual(['session-2']);
    expect(f.state.hub.tasks[0]!.pendingTransition).toMatchObject({ mode: 'run', sessionId: 'session-2' });
  });

  it('re-reads pending user work right before the durable decision', async () => {
    const f = fixture();
    f.pending.push(pendingUserWork(['decision-question']));
    await admitAutoAdvance(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
  });

  it('holds instead of failing when the pending read is unavailable', async () => {
    const f = fixture();
    f.deps.pending = async () => { throw new Error('inbox unavailable'); };
    await admitAutoAdvance(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
    expect(f.reported).toHaveLength(1);
  });

  it('does not admit when the task moved before the decision', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ columnId: 'plan' });
    await admitAutoAdvance(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
    expect(f.dispatched).toHaveLength(0);
  });

  it('does not admit when a capture could not be re-resolved, and fails loud for a changed destination', async () => {
    const f = fixture();
    const changed = { ...plan(), destination: board().workflow.columns.find(column => column.id === 'done') };
    await expect(admitAutoAdvance(f.deps, 'task', changed)).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('leaves the task unchanged when auto mode was disabled before the decision', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ autoMode: undefined });
    await admitAutoAdvance(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.pendingTransition).toBeUndefined();
  });

  it('clears a recorded pause in the same transaction that admits the advance', async () => {
    const f = fixture();
    f.state.hub.tasks[0] = task({ autoMode: { enabled: true, pause: { reason: 'turn-aborted', at: now } } });
    await admitAutoAdvance(f.deps, 'task', plan());
    expect(f.state.hub.tasks[0]!.autoMode).toEqual({ enabled: true });
  });
});
