import { describe, expect, it } from 'vitest';
import { AutoAdvanceCoordinator, pauseReasonFor, turnEndKey, turnEndReason, type AutoAdvancePorts, type AutoAdvanceTaskView } from '../../src/host/auto-advance.js';
import type { AutoAdvancePlan } from '../../src/domain/auto-advance.js';
import type { AutoModePauseReason, Board, Column, ConversationFacts, HubTask } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';

const now = '2026-01-01T00:00:00.000Z';
const idle: ConversationFacts = { running: false, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null };

const column = (id: string, extra: Partial<Column> = {}): Column => ({ id, name: id.toUpperCase(), ...extra });
const board = (...columns: Column[]): Board => ({
  id: 'board', name: 'Board', workflowYaml: '',
  workflow: { name: 'Flow', initialColumnId: columns[0]!.id, columns, groups: [] },
  createdAt: now, updatedAt: now,
});
const task = (overrides: Partial<HubTask> = {}): HubTask => ({
  id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
  sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
  autoMode: { enabled: true }, createdAt: now, updatedAt: now, ...overrides,
});
const turnEnd = (seq = 1, kind = 'completed') => ({ type: 'turn/end', seq, data: { turn: 1, reason: { kind } } });

class ManualSchedule {
  private next = 1;
  private readonly pending = new Map<number, () => void>();
  schedule = (callback: () => void): unknown => { const id = this.next++; this.pending.set(id, callback); return id; };
  cancel = (handle: unknown): void => { this.pending.delete(handle as number); };
  get size(): number { return this.pending.size; }
  async flush(rounds = 1): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
      const callbacks = [...this.pending.values()];
      this.pending.clear();
      for (const callback of callbacks) callback();
      await Promise.resolve();
      for (let microtask = 0; microtask < 20; microtask += 1) await Promise.resolve();
    }
  }
}

function harness(overrides: Partial<AutoAdvancePorts> = {}) {
  const scheduler = new ManualSchedule();
  const admitted: Array<{ taskId: string; plan: AutoAdvancePlan }> = [];
  const pauses: Array<{ taskId: string; reason: AutoModePauseReason; message?: string }> = [];
  const tasks = new Map<string, AutoAdvanceTaskView>();
  const facts = new Map<string, ConversationFacts>();
  const reports: unknown[] = [];
  const ports: AutoAdvancePorts = {
    locateBySession: sessionId => [...tasks.values()].find(value => value.task.sessionIds.includes(sessionId)),
    locate: taskId => tasks.get(taskId),
    facts: async sessionId => facts.get(sessionId) ?? idle,
    admit: async (taskId, plan) => { admitted.push({ taskId, plan }); },
    pause: async (taskId, reason, message) => { pauses.push({ taskId, reason, ...(message === undefined ? {} : { message }) }); },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    report: error => { reports.push(error); },
    ...overrides,
  };
  const coordinator = new AutoAdvanceCoordinator(ports);
  const seed = (value: HubTask, workflow: Board) => {
    tasks.set(value.id, { task: value, board: workflow });
    for (const sessionId of value.sessionIds) facts.set(sessionId, idle);
  };
  return { coordinator, scheduler, admitted, pauses, reports, tasks, facts, seed, ports };
}

describe('turn end parsing', () => {
  it('reads only a turn boundary reason kind', () => {
    expect(turnEndReason(turnEnd(1, 'completed'))).toBe('completed');
    expect(turnEndReason({ type: 'turn/start', seq: 1, data: {} })).toBeUndefined();
    expect(turnEndReason({ type: 'turn/end', seq: 1, data: {} })).toBeUndefined();
    expect(turnEndReason(null)).toBeUndefined();
  });

  it('maps non-completed reasons to pause reasons', () => {
    expect(pauseReasonFor('error')).toBe('turn-error');
    expect(pauseReasonFor('blocked')).toBe('turn-blocked');
    expect(pauseReasonFor('aborted')).toBe('turn-aborted');
    expect(pauseReasonFor('max-tokens')).toBe('turn-max-tokens');
    expect(pauseReasonFor('completed')).toBeUndefined();
    expect(pauseReasonFor('interrupted')).toBeUndefined();
  });

  it('builds a stable event identity for deduplication', () => {
    expect(turnEndKey('s1', turnEnd(7))).toBe('s1:7');
    expect(turnEndKey('s1', { type: 'turn/start', seq: 7, data: {} })).toBeUndefined();
  });
});

describe('auto-advance coordinator', () => {
  it('admits one advance after a completed turn settles', async () => {
    const f = harness();
    f.seed(task(), board(column('backlog'), column('plan', { onEnterPrompt: 'Plan it.' }), column('done')));
    f.coordinator.observe('s1', turnEnd(1));
    expect(f.admitted).toHaveLength(0);
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(1);
    expect(f.admitted[0]!.plan.destination?.id).toBe('plan');
    expect(f.admitted[0]!.plan.instruction).toBe('Plan it.');
  });

  it('records a pause for every non-completed ending and never admits', async () => {
    for (const [kind, reason] of [['error', 'turn-error'], ['blocked', 'turn-blocked'], ['aborted', 'turn-aborted'], ['max-tokens', 'turn-max-tokens']] as const) {
      const f = harness();
      f.seed(task(), board(column('backlog'), column('plan')));
      f.coordinator.observe('s1', turnEnd(1, kind));
      await f.scheduler.flush();
      expect(f.admitted).toHaveLength(0);
      expect(f.pauses).toEqual([{ taskId: 'task', reason }]);
    }
  });

  it('ignores a task without auto mode and a closed conversation', async () => {
    const disabled = harness();
    disabled.seed(task({ autoMode: { enabled: false } }), board(column('backlog'), column('plan')));
    disabled.coordinator.observe('s1', turnEnd(1));
    await disabled.scheduler.flush();
    expect(disabled.admitted).toHaveLength(0);
    expect(disabled.pauses).toHaveLength(0);

    const closed = harness();
    closed.seed(task({ closedSessionIds: ['s1'] }), board(column('backlog'), column('plan')));
    closed.coordinator.observe('s1', turnEnd(1));
    await closed.scheduler.flush();
    expect(closed.admitted).toHaveLength(0);
  });

  it('ignores a duplicated turn end', async () => {
    const f = harness();
    f.seed(task(), board(column('backlog'), column('plan')));
    f.coordinator.observe('s1', turnEnd(4));
    f.coordinator.observe('s1', turnEnd(4));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(1);
  });

  it('waits for the whole task to become idle', async () => {
    const f = harness();
    f.seed(task({ sessionIds: ['s1', 's2'] }), board(column('backlog'), column('plan')));
    f.facts.set('s2', { ...idle, running: true });
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
    f.facts.set('s2', idle);
    f.coordinator.observe('s2', turnEnd(2));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(1);
  });

  it('waits while another conversation is awaiting a reply', async () => {
    const f = harness();
    f.seed(task({ sessionIds: ['s1', 's2'] }), board(column('backlog'), column('plan')));
    f.facts.set('s2', { ...idle, pending: pendingUserWork(['native-question']) });
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
    f.facts.set('s2', idle);
    f.coordinator.observe('s2', turnEnd(2));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(1);
  });

  it('retries while the ending conversation still reports activity, then skips', async () => {
    const f = harness();
    f.seed(task(), board(column('backlog'), column('plan')));
    f.facts.set('s1', { ...idle, running: true });
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush(4);
    expect(f.admitted).toHaveLength(0);
    expect(f.scheduler.size).toBe(0);
  });

  it('fails closed when a facts read fails', async () => {
    const f = harness({ facts: async () => { throw new Error('facts unavailable'); } });
    f.seed(task(), board(column('backlog'), column('plan')));
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
    expect(f.reports).toHaveLength(1);
  });

  it('skips a busy task without recording a pause', async () => {
    for (const busy of [
      { operation: { id: 'op' } as HubTask['operation'] },
      { pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'move' as const, status: 'waiting' as const } },
      { instructionPending: { columnId: 'backlog', enteredAt: 1 } },
    ]) {
      const f = harness();
      f.seed(task(busy), board(column('backlog', { onEnterPrompt: 'Backlog.' }), column('plan')));
      f.coordinator.observe('s1', turnEnd(1));
      await f.scheduler.flush();
      expect(f.admitted).toHaveLength(0);
      expect(f.pauses).toHaveLength(0);
    }
  });

  it('does nothing when no stage is ahead', async () => {
    const f = harness();
    f.seed(task({ columnId: 'done' }), board(column('backlog'), column('done')));
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
    expect(f.pauses).toHaveLength(0);
  });

  it('records an advance-failed pause when admission throws', async () => {
    const f = harness({ admit: async () => { throw new Error('No target conversation.'); } });
    f.seed(task(), board(column('backlog'), column('plan')));
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    expect(f.pauses).toEqual([{ taskId: 'task', reason: 'advance-failed', message: 'No target conversation.' }]);
    expect(f.reports).toHaveLength(1);
  });

  it('cancels its timer and ignores later events when disposed', async () => {
    const f = harness();
    f.seed(task(), board(column('backlog'), column('plan')));
    f.coordinator.observe('s1', turnEnd(1));
    expect(f.scheduler.size).toBe(1);
    f.coordinator.dispose();
    expect(f.scheduler.size).toBe(0);
    f.coordinator.observe('s1', turnEnd(2));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
  });

  it('forgets a queued turn when auto mode is disabled', async () => {
    const f = harness();
    f.seed(task(), board(column('backlog'), column('plan')));
    f.coordinator.observe('s1', turnEnd(1));
    f.coordinator.forget('task');
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
  });

  it('does not advance when auto mode is disabled and re-enabled while the settle is in flight', async () => {
    let release!: (value: ConversationFacts) => void;
    const pending = new Promise<ConversationFacts>(resolve => { release = resolve; });
    const f = harness({ facts: () => pending });
    f.seed(task(), board(column('backlog'), column('plan')));
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    f.coordinator.forget('task');
    release(idle);
    for (let microtask = 0; microtask < 20; microtask += 1) await Promise.resolve();
    expect(f.admitted).toHaveLength(0);
  });

  it('holds without a retry or a pause while the task is owed user input', async () => {
    const f = harness();
    f.seed(task(), board(column('backlog'), column('plan')));
    f.facts.set('s1', { ...idle, pending: pendingUserWork(['queued-prompt'], 1) });
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush(4);
    expect(f.admitted).toHaveLength(0);
    expect(f.pauses).toHaveLength(0);
    expect(f.scheduler.size).toBe(0);
  });

  it('holds for pending work in a closed conversation', async () => {
    const f = harness();
    f.seed(task({ sessionIds: ['s1', 's2'], closedSessionIds: ['s2'] }), board(column('backlog'), column('plan')));
    f.facts.set('s2', { ...idle, pending: pendingUserWork(['decision-question']) });
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
    expect(f.pauses).toHaveLength(0);
  });

  it('advances on the next completed turn after the pending work is consumed', async () => {
    const f = harness();
    f.seed(task(), board(column('backlog'), column('plan')));
    f.facts.set('s1', { ...idle, pending: pendingUserWork(['approval']) });
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(0);
    f.facts.set('s1', idle);
    f.coordinator.observe('s1', turnEnd(2));
    await f.scheduler.flush();
    expect(f.admitted).toHaveLength(1);
  });

  it('does not admit when disposed while the facts read is in flight', async () => {
    let release!: (value: ConversationFacts) => void;
    const pending = new Promise<ConversationFacts>(resolve => { release = resolve; });
    const f = harness({ facts: () => pending });
    f.seed(task(), board(column('backlog'), column('plan')));
    f.coordinator.observe('s1', turnEnd(1));
    await f.scheduler.flush();
    f.coordinator.dispose();
    release(idle);
    for (let microtask = 0; microtask < 20; microtask += 1) await Promise.resolve();
    expect(f.admitted).toHaveLength(0);
    expect(f.pauses).toHaveLength(0);
  });
});
