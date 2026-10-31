import { describe, expect, it } from 'vitest';
import { requiresWorktreeDecision } from '../../src/shared/worktree-decision.js';
import type { Project, Task } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const folderProject: Project = { id: 'f', name: 'Folder', projectPath: '/repo/apps/web' };
const ready: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'ready' };
const preparing: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'preparing' };
const failed: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'error' };
function task(overrides: Partial<Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>> = {}): Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'> {
  return { sessionIds: [], worktree: null, ...overrides };
}

describe('requiresWorktreeDecision', () => {
  it('requires a choice for a Git task without a worktree or conversation', () => {
    expect(requiresWorktreeDecision(task(), gitProject)).toBe(true);
  });
  it('treats preparing and failed worktrees as undecided', () => {
    expect(requiresWorktreeDecision(task({ worktree: preparing }), gitProject)).toBe(true);
    expect(requiresWorktreeDecision(task({ worktree: failed }), gitProject)).toBe(true);
  });
  it('does not require a choice for a ready worktree or a recorded base choice', () => {
    expect(requiresWorktreeDecision(task({ worktree: ready }), gitProject)).toBe(false);
    expect(requiresWorktreeDecision(task({ worktreeDismissed: true }), gitProject)).toBe(false);
  });
  it('does not require a choice for a folder project or an existing conversation', () => {
    expect(requiresWorktreeDecision(task(), folderProject)).toBe(false);
    expect(requiresWorktreeDecision(task({ sessionIds: ['session-1'] }), gitProject)).toBe(false);
  });
});
