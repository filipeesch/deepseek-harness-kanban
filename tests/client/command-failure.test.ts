import { describe, expect, it } from 'vitest';
import { adviseCommandFailure } from '../../src/client/command-failure.js';

describe('destructive failure advice', () => {
  it('keeps the recorded force consent when rebuilding a discard command', () => {
    const advice = adviseCommandFailure({
      command: { type: 'operation.retry', taskId: 't1' },
      problem: { code: 'DISCARD_REQUIRED', message: 'Local changes exist.' },
      task: { id: 't1', title: 'Task' } as never,
      priorOperation: {
        id: 'op', request: { kind: 'remove', discardChanges: false, expectedWorktreePath: '/tree', force: true }, phase: 'failed',
        previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now',
      },
      allowDiscard: true,
    });
    expect(advice.discard?.command).toEqual({ type: 'worktree.remove', taskId: 't1', confirmed: true, expectedWorktreePath: '/tree', force: true });
  });
});
