import { describe, expect, it } from 'vitest';
import { PendingTransitionIndex } from '../../src/host/pending-transition-index.js';
import type { TaskSummary } from '../../src/host/hub-repository.js';

function summary(taskId: string, overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    hubId: 'hub', boardId: 'board', projectId: 'project', taskId,
    sessionIds: [], closedSessionIds: [], autoModeEnabled: false, instructionPending: null,
    hasOperation: false, hasPendingTransition: false,
    worktreePath: null, unclaimedWorktreePaths: [], operationAttemptPath: null, pendingWorktreePath: null,
    ...overrides,
  };
}

describe('pending transition index', () => {
  it('is empty when no task holds a pending transition', () => {
    const index = new PendingTransitionIndex();
    expect(index.refresh([summary('t1'), summary('t2')])).toEqual([]);
    expect(index.empty).toBe(true);
  });

  it('lists only the tasks that hold a pending transition', () => {
    const index = new PendingTransitionIndex();
    expect(index.refresh([summary('t1'), summary('t2', { hasPendingTransition: true })])).toEqual(['t2']);
    expect(index.empty).toBe(false);
    expect(index.list()).toEqual(['t2']);
  });

  it('clears the list when the last transition resolves', () => {
    const index = new PendingTransitionIndex();
    index.refresh([summary('t1', { hasPendingTransition: true })]);
    index.refresh([summary('t1')]);
    expect(index.empty).toBe(true);
  });
});
