import { describe, expect, it } from 'vitest';
import { canForceSharedRemoval, sharedWorktreeBlockers } from '../../src/shared/worktree-blockers.js';

describe('sharedWorktreeBlockers', () => {
  it('reads every recorded blocker', () => {
    const problem = { code: 'SHARED_WORKTREE', message: 'shared', details: { path: '/tree', blockers: [
      { kind: 'task', taskId: 't2', title: 'Other', path: '/tree' },
      { kind: 'session', sessionId: 's1', path: '/tree/sub' },
    ] } };
    expect(sharedWorktreeBlockers(problem)).toEqual([
      { kind: 'task', taskId: 't2', title: 'Other', path: '/tree' },
      { kind: 'session', sessionId: 's1', path: '/tree/sub' },
    ]);
    expect(canForceSharedRemoval(problem)).toBe(true);
  });

  it('falls back to the legacy single blocker detail', () => {
    expect(sharedWorktreeBlockers({ code: 'SHARED_WORKTREE', message: 'shared', details: { sessionId: 's9', path: '/tree' } })).toEqual([{ kind: 'session', sessionId: 's9', path: '/tree' }]);
    expect(sharedWorktreeBlockers({ code: 'SHARED_WORKTREE', message: 'shared', details: { taskId: 't9', taskTitle: 'Legacy' } })).toEqual([{ kind: 'task', taskId: 't9', title: 'Legacy', path: '' }]);
  });

  it('ignores other problems', () => {
    expect(sharedWorktreeBlockers({ code: 'DISCARD_REQUIRED', message: 'dirty' })).toEqual([]);
    expect(canForceSharedRemoval({ code: 'DISCARD_REQUIRED', message: 'dirty' })).toBe(false);
  });
});
