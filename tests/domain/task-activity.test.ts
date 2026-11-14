import { describe, expect, it } from 'vitest';
import { aggregateTaskActivity, UNAVAILABLE_TASK_ACTIVITY, type TaskActivityEntry } from '../../src/domain/task-activity.js';
import type { ConversationFacts } from '../../src/shared/types.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';

function facts(input: { running?: boolean; pending?: ('approval' | 'native-question' | 'decision-question')[]; queued?: number; background?: number; settled?: 'ok' | 'error' }): ConversationFacts {
  return {
    running: input.running === true,
    background: Array.from({ length: input.background ?? 0 }, (_value, index) => ({ kind: 'job' as const, label: 'job-' + index })),
    pending: pendingUserWork(input.pending ?? [], input.queued ?? 0),
    settledTurn: input.settled === undefined ? null : { seq: 1, outcome: input.settled },
  };
}

function entries(...values: Array<[string, ConversationFacts]>): TaskActivityEntry[] {
  return values.map(([sessionId, value]) => ({ sessionId, facts: value }));
}

describe('task activity aggregation', () => {
  it('reports an unavailable value when the host cannot be asked', () => {
    expect(aggregateTaskActivity(undefined)).toEqual(UNAVAILABLE_TASK_ACTIVITY);
    expect(aggregateTaskActivity(undefined).available).toBe(false);
  });

  it('reports an available, idle value for a task with no conversation', () => {
    expect(aggregateTaskActivity([])).toEqual({ available: true, running: false, pending: [], queuedPrompts: 0, backgroundCount: 0, settledTurns: [] });
  });

  it('is running when any conversation runs', () => {
    expect(aggregateTaskActivity(entries(['a', facts({})], ['b', facts({ running: true })])).running).toBe(true);
  });

  it('unions the pending kinds and sums the queued prompts', () => {
    const value = aggregateTaskActivity(entries(
      ['a', facts({ pending: ['approval'], queued: 1 })],
      ['b', facts({ pending: ['decision-question'] })],
    ));
    expect(value.pending).toEqual(['decision-question', 'approval', 'queued-prompt']);
    expect(value.queuedPrompts).toBe(1);
  });

  it('sums background work and reports each settled conversation outcome', () => {
    const value = aggregateTaskActivity(entries(
      ['a', facts({ background: 2, settled: 'ok' })],
      ['b', facts({ settled: 'error' })],
      ['c', facts({})],
    ));
    expect(value.backgroundCount).toBe(2);
    expect(value.settledTurns).toEqual([{ sessionId: 'a', outcome: 'ok' }, { sessionId: 'b', outcome: 'error' }]);
  });

  it('reports only the conversations it was given, so a closed one never counts', () => {
    const value = aggregateTaskActivity(entries(['open', facts({ running: true, settled: 'ok' })]));
    expect(value.settledTurns).toEqual([{ sessionId: 'open', outcome: 'ok' }]);
    expect(value.running).toBe(true);
  });
});
