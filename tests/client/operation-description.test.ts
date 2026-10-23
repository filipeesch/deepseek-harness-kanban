import { describe, expect, it } from 'vitest';
import { describeOperation } from '../../src/client/operation-description.js';
import type { ContextOperation, OperationRequest } from '../../src/shared/types.js';
import { task } from './helpers.js';

const base = task('t1', 'Alpha task', 'p1', 'intake');
const target = '/trees/alpha';

function operation(request: OperationRequest, overrides: Partial<ContextOperation> = {}): ContextOperation {
  return {
    id: 'op', request, phase: 'failed', targetPath: target, previousDirectories: {},
    switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now',
    ...overrides,
  };
}

describe('describeOperation', () => {
  it('describes a failed deletion before any work completed', () => {
    const value = describeOperation(base, operation({ kind: 'delete', discardChanges: false, expectedWorktreePath: target }, {
      error: { code: 'SHARED_WORKTREE', message: 'Shared.', details: { failedPhase: 'preflight' } },
    }));
    expect(value.title).toBe('Task deletion needs attention');
    expect(value.detail).toContain('preflight');
    expect(value.retry).toBe(true);
    expect(value.return).toBe(true);
    expect(value.retryLabel).toBe('Retry deletion');
    expect(value.facts).toEqual(expect.arrayContaining([
      { label: 'Chats returned', value: '0/2' },
      { label: 'Conversations archived', value: '0/2' },
      { label: 'Worktree', value: target },
      { label: 'Checkout', value: 'Not completed' },
    ]));
  });

  it('does not offer Return after archiving has begun', () => {
    const value = describeOperation(base, operation({ kind: 'delete', discardChanges: false, expectedWorktreePath: target }, {
      phase: 'archiving', archivedSessionIds: ['s1'],
    }));
    expect(value.return).toBe(false);
    expect(value.retry).toBe(false);
  });

  it('uses kind-specific labels and avoids the old generic explanation', () => {
    const remove = describeOperation(base, operation({ kind: 'remove', discardChanges: false, expectedWorktreePath: target }));
    expect(remove.title).toBe('Worktree removal needs attention');
    expect(remove.retryLabel).toBe('Retry worktree removal');
    expect(remove.detail).not.toContain('Worktree operation');
    const attach = describeOperation(base, operation({ kind: 'attach', path: target }, { phase: 'failed' }));
    expect(attach.title).toBe('Worktree attachment needs attention');
    expect(attach.detail).not.toContain('Conversations switched');
  });

  it('describes waiting and in-progress operations', () => {
    const waiting = describeOperation(base, operation({ kind: 'delete', discardChanges: false, expectedWorktreePath: target }, { phase: 'waiting' }));
    expect(waiting.retry).toBe(true);
    expect(waiting.detail).toContain('Waiting for every conversation');
    const creating = describeOperation(base, operation({ kind: 'create', mode: 'new', path: target, branchName: 'feature' }, { phase: 'git', targetDirectory: target }));
    expect(creating.retry).toBe(false);
    expect(creating.detail).toBe('Creating the checkout.');
    expect(creating.facts).toEqual(expect.arrayContaining([{ label: 'Target', value: target }]));
    const earlyCreate = describeOperation(base, operation({ kind: 'create', mode: 'new', path: target, branchName: 'feature' }));
    expect(earlyCreate.facts).toContainEqual({ label: 'Target', value: target });
  });

  it('does not offer Return for a return operation', () => {
    const value = describeOperation(base, operation({ kind: 'return' }, { phase: 'failed' }));
    expect(value.title).toBe('Return to project needs attention');
    expect(value.return).toBe(false);
  });
});
