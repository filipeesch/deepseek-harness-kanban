import { describe, expect, it } from 'vitest';
import { createsDefaultWorktree, needsWorktreeOutcome, requiresWorktreeDecision, unresolvedWorktreeBinding } from '../../src/shared/worktree-decision.js';
import { worktreePolicy } from '../../src/shared/worktree-policy.js';
import type { Project, Task, WorktreePolicy } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const folderProject: Project = { id: 'f', name: 'Folder', projectPath: '/repo/apps/web' };
function policy(value: WorktreePolicy): Project { return { ...gitProject, worktreePolicy: value }; }
const ready: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'ready' };
const preparing: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'preparing' };
const failed: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'error' };
function task(overrides: Partial<Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>> = {}): Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'> {
  return { sessionIds: [], worktree: null, ...overrides };
}

describe('worktreePolicy', () => {
  it('treats an absent policy as Ask', () => {
    expect(worktreePolicy(undefined)).toBe('ask');
    expect(worktreePolicy(gitProject)).toBe('ask');
    expect(worktreePolicy(policy('never'))).toBe('never');
  });
});

describe('needsWorktreeOutcome', () => {
  it('reports a Git task without a conversation, choice, or ready worktree', () => {
    expect(needsWorktreeOutcome(task(), gitProject)).toBe(true);
    expect(needsWorktreeOutcome(task({ worktree: preparing }), gitProject)).toBe(true);
  });
  it('is satisfied by a conversation, a recorded choice, a ready worktree, or a folder project', () => {
    expect(needsWorktreeOutcome(task({ sessionIds: ['session-1'] }), gitProject)).toBe(false);
    expect(needsWorktreeOutcome(task({ worktreeDismissed: true }), gitProject)).toBe(false);
    expect(needsWorktreeOutcome(task({ worktree: ready }), gitProject)).toBe(false);
    expect(needsWorktreeOutcome(task(), folderProject)).toBe(false);
    expect(needsWorktreeOutcome(task(), undefined)).toBe(false);
  });
});

describe('requiresWorktreeDecision', () => {
  it('requires a choice for a Git task without a worktree or conversation', () => {
    expect(requiresWorktreeDecision(task(), gitProject)).toBe(true);
    expect(requiresWorktreeDecision(task(), policy('ask'))).toBe(true);
  });
  it('treats preparing and failed worktrees as undecided', () => {
    expect(requiresWorktreeDecision(task({ worktree: preparing }), gitProject)).toBe(true);
    expect(requiresWorktreeDecision(task({ worktree: failed }), gitProject)).toBe(true);
  });
  it('does not require a choice for a ready worktree or a recorded base choice', () => {
    expect(requiresWorktreeDecision(task({ worktree: ready }), gitProject)).toBe(false);
    expect(requiresWorktreeDecision(task({ worktreeDismissed: true }), gitProject)).toBe(false);
  });
  it('does not require a choice for a folder project, an existing conversation, or a resolving policy', () => {
    expect(requiresWorktreeDecision(task(), folderProject)).toBe(false);
    expect(requiresWorktreeDecision(task({ sessionIds: ['session-1'] }), gitProject)).toBe(false);
    expect(requiresWorktreeDecision(task(), policy('always'))).toBe(false);
    expect(requiresWorktreeDecision(task(), policy('never'))).toBe(false);
  });
});

describe('createsDefaultWorktree', () => {
  it('starts on the default worktree under Ask and Always create', () => {
    expect(createsDefaultWorktree(task(), gitProject)).toBe(true);
    expect(createsDefaultWorktree(task(), policy('always'))).toBe(true);
  });
  it('never creates a worktree under Never', () => {
    expect(createsDefaultWorktree(task(), policy('never'))).toBe(false);
  });
  it('defers to the choice the task already recorded', () => {
    expect(createsDefaultWorktree(task({ worktreeDismissed: true }), policy('always'))).toBe(false);
    expect(createsDefaultWorktree(task({ worktree: ready }), policy('always'))).toBe(false);
  });
});

describe('unresolvedWorktreeBinding', () => {
  it('reports a Git-backed binding that is preparing or in error', () => {
    expect(unresolvedWorktreeBinding(task({ worktree: preparing }), gitProject)).toBe(true);
    expect(unresolvedWorktreeBinding(task({ worktree: failed }), gitProject)).toBe(true);
  });
  it('does not report a ready binding, an absent binding, or a folder project', () => {
    expect(unresolvedWorktreeBinding(task({ worktree: ready }), gitProject)).toBe(false);
    expect(unresolvedWorktreeBinding(task(), gitProject)).toBe(false);
    expect(unresolvedWorktreeBinding(task({ worktree: failed }), folderProject)).toBe(false);
    expect(unresolvedWorktreeBinding(task({ worktree: failed }), undefined)).toBe(false);
  });
  it('ignores conversations, because the block only applies to the first execution', () => {
    expect(unresolvedWorktreeBinding(task({ worktree: failed, sessionIds: ['session-1'] }), gitProject)).toBe(true);
  });
});
