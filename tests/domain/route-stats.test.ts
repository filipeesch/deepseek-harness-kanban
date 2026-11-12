import { describe, expect, it } from 'vitest';
import { routeStats, type RouteStatsCard, type RouteStatsOptions } from '../../src/domain/route-stats.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import type { TaskHistoryEntry } from '../../src/shared/task-history.js';

const FLOW = 'initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review, done]\n  - id: review\n    label: Review\n    allowed_transitions: [done]\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash\n      code: exit 0\n      directory: project\n      exits: {passed: done, failed: todo}\n  - id: done\n    label: Done\n';

const WINDOW = { since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z' };

function card(taskId: string, history: TaskHistoryEntry[], columnId = 'done', projectId = 'p'): RouteStatsCard {
  return { taskId, projectId, columnId, history };
}

function stats(cards: readonly RouteStatsCard[], options: RouteStatsOptions = WINDOW) {
  return routeStats({ workflow: parseWorkflow(FLOW), cards, options, now: '2026-01-31T00:00:00.000Z' });
}

describe('route statistics', () => {
  it('counts a transition and how it was produced', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
      { kind: 'stage', at: '2026-01-03T00:00:00.000Z', fromColumnId: 'review', columnId: 'done', origin: 'agent' },
    ])]);
    const todoToReview = value.transitions.find(transition => transition.from === 'todo' && transition.to === 'review');
    expect(todoToReview).toMatchObject({ count: 1, origins: { operator: 1, declared: 0, automatic: 0, script: 0, error: 0, unrecorded: 0 } });
    const reviewToDone = value.transitions.find(transition => transition.from === 'review' && transition.to === 'done');
    expect(reviewToDone?.origins.declared).toBe(1);
  });

  it('counts a named script exit and lists one that was never used', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'wait' },
      { kind: 'deterministic-execution', at: '2026-01-02T00:00:00.000Z', executionId: 'e1', columnId: 'wait', outcome: 'completed', exit: 'passed' },
      { kind: 'stage', at: '2026-01-02T00:00:01.000Z', fromColumnId: 'wait', columnId: 'done', origin: 'script:passed' },
    ])]);
    expect(value.exits).toEqual([{ stage: 'wait', exit: 'passed', count: 1 }]);
    expect(value.unused.exits).toEqual([{ stage: 'wait', exit: 'failed' }]);
    const transition = value.transitions.find(value => value.to === 'done');
    expect(transition?.exits).toEqual({ passed: 1 });
    expect(transition?.origins.script).toBe(1);
  });

  it('reports entries and the time spent in a stage', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-03T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
      { kind: 'stage', at: '2026-01-05T00:00:00.000Z', fromColumnId: 'review', columnId: 'done', origin: 'manual' },
    ])]);
    const todo = value.stages.find(stage => stage.stage === 'todo');
    expect(todo).toMatchObject({ entries: 0, mean: 2 * 24 * 60 * 60 * 1000, p90: 2 * 24 * 60 * 60 * 1000 });
    expect(value.stages.find(stage => stage.stage === 'review')?.entries).toBe(1);
  });

  it('reports a percentile over several stays', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'review' },
      { kind: 'stage', at: '2026-01-01T01:00:00.000Z', fromColumnId: 'review', columnId: 'done', origin: 'manual' },
      { kind: 'stage', at: '2026-01-01T03:00:00.000Z', fromColumnId: 'done', columnId: 'wait', origin: 'manual' },
    ]), card('t2', [
      { kind: 'created', at: '2026-01-02T00:00:00.000Z', columnId: 'review' },
      { kind: 'stage', at: '2026-01-02T03:00:00.000Z', fromColumnId: 'review', columnId: 'done', origin: 'manual' },
    ])]);
    const review = value.stages.find(stage => stage.stage === 'review')!;
    // The stays are one hour and three hours: the nearest-rank p90 is the largest.
    expect(review.mean).toBe(2 * 60 * 60 * 1000);
    expect(review.p90).toBe(3 * 60 * 60 * 1000);
  });

  it('reports the cards parked now and for how long', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-30T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
    ], 'review')]);
    expect(value.parked).toEqual([{ taskId: 't1', stage: 'review', since: '2026-01-30T00:00:00.000Z', duration: 24 * 60 * 60 * 1000 }]);
    expect(value.stages.find(stage => stage.stage === 'review')?.now).toBe(1);
  });

  it('counts the loops one card made', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
      { kind: 'stage', at: '2026-01-03T00:00:00.000Z', fromColumnId: 'review', columnId: 'todo', origin: 'agent' },
      { kind: 'stage', at: '2026-01-04T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
    ])]);
    // Each return to a stage the card had already left counts as one loop.
    expect(value.loops.cards).toEqual([{ taskId: 't1', count: 2 }]);
    expect(value.loops.max).toBe(2);
    expect(value.loops.mean).toBe(2);
    expect(value.loops.routes).toContainEqual({ from: 'review', to: 'todo', count: 1 });
  });

  it('reports every card, with the board mean over all of them', () => {
    const first = [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
    ] as TaskHistoryEntry[];
    const second = [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
      { kind: 'stage', at: '2026-01-03T00:00:00.000Z', fromColumnId: 'review', columnId: 'todo', origin: 'agent' },
      { kind: 'stage', at: '2026-01-04T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
    ] as TaskHistoryEntry[];
    const value = stats([card('t1', first), card('t2', second)]);
    expect(value.loops.cards).toEqual([{ taskId: 't1', count: 0 }, { taskId: 't2', count: 2 }]);
    expect(value.loops.mean).toBe(1);
    expect(value.loops.max).toBe(2);
  });

  it('does not count a return whose earlier visit is outside the window', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2025-12-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
      { kind: 'stage', at: '2026-01-03T00:00:00.000Z', fromColumnId: 'review', columnId: 'todo', origin: 'manual' },
    ])]);
    expect(value.loops.cards).toEqual([{ taskId: 't1', count: 0 }]);
  });

  it('rejects an invalid or reversed window', () => {
    expect(() => stats([], { since: '2026-02-01T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z' })).toThrow(/starts after it ends/);
    expect(() => stats([], { since: 'not a date', until: '2026-01-01T00:00:00.000Z' })).toThrow(/valid since and until/);
  });

  it('excludes uses outside the window', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2025-12-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2025-12-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
    ])], { since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z' });
    expect(value.transitions).toEqual([]);
  });

  it('filters by project', () => {
    const value = stats([
      card('t1', [{ kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' }, { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' }], 'done', 'a'),
      card('t2', [{ kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' }, { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' }], 'done', 'b'),
    ], { ...WINDOW, projectIds: ['a'] });
    expect(value.transitions[0]?.count).toBe(1);
  });

  it('reports unrecorded origins instead of guessing', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review' },
    ])]);
    expect(value.transitions[0]?.origins.unrecorded).toBe(1);
  });

  it('lists configured routes no card used', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
    ])]);
    expect(value.unused.routes).toContainEqual({ from: 'todo', to: 'done' });
    expect(value.unused.routes).toContainEqual({ from: 'review', to: 'done' });
  });

  it('carries no card text', () => {
    const value = stats([card('t1', [
      { kind: 'created', at: '2026-01-01T00:00:00.000Z', columnId: 'todo' },
      { kind: 'stage', at: '2026-01-02T00:00:00.000Z', fromColumnId: 'todo', columnId: 'review', origin: 'manual' },
    ])]);
    expect(JSON.stringify(value)).not.toContain('title');
    expect(JSON.stringify(value)).not.toContain('description');
  });
});