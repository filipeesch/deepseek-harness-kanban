import { describe, expect, it } from 'vitest';
import { taskHistoryIssue, taskHistorySchema } from '../../src/domain/task-history/entry.js';
import { recordAutoModeChange, recordCreation, recordIntent, recordStageEntry, recordWorktreeOutcome } from '../../src/domain/task-history/record.js';
import { renameTaskStage } from '../../src/domain/stage-update.js';
import type { Task } from '../../src/shared/types.js';

const FIRST = '2026-11-11T09:00:00.000Z';
const SECOND = '2026-11-11T10:30:00.000Z';
const THIRD = '2026-11-11T11:00:00.000Z';

/** The slice of a task an append writes; the tests keep the rest of the task out of the way. */
function target(): Pick<Task, 'history'> { return {}; }

function recorded<T extends { history?: unknown }>(task: T): NonNullable<T['history']> {
  return task.history as NonNullable<T['history']>;
}

describe('task flow record', () => {
  it('appends each settled fact in order and never rewrites an earlier entry', () => {
    const task = target();
    recordCreation(task, 'backlog', FIRST);
    recordStageEntry(task, 'backlog', 'plan', SECOND);
    recordIntent(task, 'plan', 'done', THIRD);
    expect(recorded(task)).toEqual([
      { kind: 'created', at: FIRST, columnId: 'backlog' },
      { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan' },
      { kind: 'intent', at: THIRD, fromColumnId: 'plan', columnId: 'done' },
    ]);
    expect(taskHistoryIssue(recorded(task)[0]!)).toBeNull();
  });

  it('records no stage entry when the stage does not change', () => {
    const task = target();
    recordCreation(task, 'backlog', FIRST);
    recordStageEntry(task, 'backlog', 'backlog', SECOND);
    expect(recorded(task)).toHaveLength(1);
  });

  it('records how a stage entry happened, and none when no origin is known', () => {
    const task = target();
    recordStageEntry(task, 'backlog', 'plan', FIRST, 'manual');
    recordStageEntry(task, 'plan', 'backlog', SECOND, 'agent');
    recordStageEntry(task, 'backlog', 'plan', THIRD, 'auto');
    recordStageEntry(task, 'plan', 'backlog', THIRD, 'script:passed');
    recordStageEntry(task, 'backlog', 'plan', THIRD, 'error:error');
    recordStageEntry(task, 'plan', 'backlog', THIRD);
    expect(recorded(task)).toEqual([
      { kind: 'stage', at: FIRST, fromColumnId: 'backlog', columnId: 'plan', origin: 'manual' },
      { kind: 'stage', at: SECOND, fromColumnId: 'plan', columnId: 'backlog', origin: 'agent' },
      { kind: 'stage', at: THIRD, fromColumnId: 'backlog', columnId: 'plan', origin: 'auto' },
      { kind: 'stage', at: THIRD, fromColumnId: 'plan', columnId: 'backlog', origin: 'script:passed' },
      { kind: 'stage', at: THIRD, fromColumnId: 'backlog', columnId: 'plan', origin: 'error:error' },
      { kind: 'stage', at: THIRD, fromColumnId: 'plan', columnId: 'backlog' },
    ]);
    expect(taskHistorySchema.safeParse(recorded(task)).success).toBe(true);
  });

  it('decodes a stage entry stored before origins without adding one', () => {
    const stored = { kind: 'stage', at: FIRST, fromColumnId: 'backlog', columnId: 'plan' };
    const parsed = taskHistorySchema.safeParse([stored]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]).toEqual(stored);
  });

  it('records every auto mode change with the reason that produced it', () => {
    const task = target();
    recordAutoModeChange(task, { action: 'enabled' }, FIRST);
    recordAutoModeChange(task, { action: 'paused', reason: 'turn-error', message: 'Rate limited.' }, SECOND);
    recordAutoModeChange(task, { action: 'paused', reason: 'turn-error', message: 'Rate limited.' }, THIRD);
    recordAutoModeChange(task, { action: 'agent-paused', reason: 'Review the diff' }, THIRD);
    recordAutoModeChange(task, { action: 'resumed' }, THIRD);
    recordAutoModeChange(task, { action: 'disabled' }, THIRD);
    expect(recorded(task)).toEqual([
      { kind: 'auto-mode', at: FIRST, action: 'enabled' },
      { kind: 'auto-mode', at: SECOND, action: 'paused', reason: 'turn-error', message: 'Rate limited.' },
      { kind: 'auto-mode', at: THIRD, action: 'paused', reason: 'turn-error', message: 'Rate limited.' },
      { kind: 'auto-mode', at: THIRD, action: 'agent-paused', reason: 'Review the diff' },
      { kind: 'auto-mode', at: THIRD, action: 'resumed' },
      { kind: 'auto-mode', at: THIRD, action: 'disabled' },
    ]);
  });

  it('records a worktree outcome with its checkout and the failure that ended an operation', () => {
    const task = target();
    recordWorktreeOutcome(task, { action: 'created', path: '/trees/one', branch: 'feat/one' }, FIRST);
    recordWorktreeOutcome(task, { action: 'attached', path: '/trees/two' }, SECOND);
    recordWorktreeOutcome(task, { action: 'removed', path: '/trees/two' }, THIRD);
    recordWorktreeOutcome(task, { action: 'failed', path: '/trees/three', error: { code: 'PREFLIGHT_FAILED', message: 'Target exists.' } }, THIRD);
    expect(recorded(task)).toHaveLength(4);
    expect(recorded(task)[0]).toEqual({ kind: 'worktree', at: FIRST, action: 'created', path: '/trees/one', branch: 'feat/one' });
    expect(recorded(task)[3]).toMatchObject({ action: 'failed', path: '/trees/three', error: { code: 'PREFLIGHT_FAILED' } });
  });

  it('keeps a recorded entry readable when a rename reuses a removed identifier', () => {
    const task: Pick<Task, 'columnId' | 'history'> = {
      columnId: 'plan',
      history: [
        { kind: 'created', at: FIRST, columnId: 'retired' },
        { kind: 'stage', at: SECOND, fromColumnId: 'retired', columnId: 'plan' },
      ],
    };
    expect(renameTaskStage(task, 'plan', 'retired')).toBe(true);
    // The identifier is reused, so the historical move names it on both sides.
    expect(task.columnId).toBe('retired');
    expect(task.history?.[1]).toEqual({ kind: 'stage', at: SECOND, fromColumnId: 'retired', columnId: 'retired' });
    expect(taskHistorySchema.safeParse(task.history).success).toBe(true);
  });

  it('carries a renamed stage into every recorded reference, keeping its kind and moment', () => {
    const task: Pick<Task, 'columnId' | 'history'> = {
      columnId: 'backlog',
      history: [
        { kind: 'created', at: FIRST, columnId: 'backlog' },
        { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan' },
        { kind: 'intent', at: THIRD, fromColumnId: 'plan', columnId: 'backlog' },
        { kind: 'worktree', at: THIRD, action: 'attached', path: '/trees/one' },
      ],
    };
    expect(renameTaskStage(task, 'backlog', 'inbox')).toBe(true);
    expect(task.columnId).toBe('inbox');
    expect(task.history).toEqual([
      { kind: 'created', at: FIRST, columnId: 'inbox' },
      { kind: 'stage', at: SECOND, fromColumnId: 'inbox', columnId: 'plan' },
      { kind: 'intent', at: THIRD, fromColumnId: 'plan', columnId: 'inbox' },
      { kind: 'worktree', at: THIRD, action: 'attached', path: '/trees/one' },
    ]);
  });
});

describe('task flow record validation', () => {
  const everyKind = [
    { kind: 'created', at: FIRST, columnId: 'backlog' },
    { kind: 'stage', at: FIRST, fromColumnId: 'backlog', columnId: 'plan' },
    { kind: 'intent', at: FIRST, fromColumnId: 'plan', columnId: 'done' },
    { kind: 'auto-mode', at: FIRST, action: 'enabled' },
    { kind: 'auto-mode', at: FIRST, action: 'paused', reason: 'turn-error' },
    { kind: 'worktree', at: FIRST, action: 'created', path: '/trees/one', branch: 'feat/one' },
    { kind: 'worktree', at: FIRST, action: 'failed', error: { code: 'PREFLIGHT_FAILED', message: 'No.' } },
  ];

  it('accepts a record of every kind', () => {
    expect(taskHistorySchema.safeParse(everyKind).success).toBe(true);
  });

  it('accepts an entry whose identifiers match after a rename reused them', () => {
    expect(taskHistorySchema.safeParse([{ kind: 'stage', at: FIRST, fromColumnId: 'plan', columnId: 'plan' }]).success).toBe(true);
    expect(taskHistorySchema.safeParse([{ kind: 'intent', at: FIRST, fromColumnId: 'plan', columnId: 'plan' }]).success).toBe(true);
  });

  it('accepts exactly the stage entry origins the record stores', () => {
    for (const origin of ['manual', 'agent', 'auto', 'script:passed', 'error:error', 'script:exit-1']) {
      expect(taskHistorySchema.safeParse([{ kind: 'stage', at: FIRST, fromColumnId: 'backlog', columnId: 'plan', origin }]).success).toBe(true);
    }
    for (const origin of ['operator', 'script:', 'script:a b', 'script:a:b', 'error', 'manual:x', 'AUTO', '']) {
      expect(taskHistorySchema.safeParse([{ kind: 'stage', at: FIRST, fromColumnId: 'backlog', columnId: 'plan', origin }]).success).toBe(false);
    }
  });

  it('rejects an unknown kind', () => {
    expect(taskHistorySchema.safeParse([{ kind: 'moved', at: FIRST, columnId: 'backlog' }]).success).toBe(false);
  });

  it('rejects an entry whose fields contradict its kind', () => {
    const rejected = [
      { kind: 'auto-mode', at: FIRST, action: 'paused' },
      { kind: 'auto-mode', at: FIRST, action: 'agent-paused' },
      { kind: 'auto-mode', at: FIRST, action: 'enabled', reason: 'turn-error' },
      { kind: 'worktree', at: FIRST, action: 'created', path: '/trees/one' },
      { kind: 'worktree', at: FIRST, action: 'attached' },
      { kind: 'worktree', at: FIRST, action: 'failed' },
    ];
    for (const entry of rejected) expect(taskHistorySchema.safeParse([entry]).success).toBe(false);
  });

  it('rejects a moment that is not an offset timestamp and a record that is not a list', () => {
    expect(taskHistorySchema.safeParse([{ kind: 'created', at: '2026-11-11', columnId: 'backlog' }]).success).toBe(false);
    expect(taskHistorySchema.safeParse({ kind: 'created', at: FIRST, columnId: 'backlog' }).success).toBe(false);
  });
});
