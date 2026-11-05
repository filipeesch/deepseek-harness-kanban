import { describe, expect, it } from 'vitest';
import { executionPreparationPlan } from '../../src/client/execution-preparation/gate.js';
import type { Project, Task } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const folderProject: Project = { id: 'f', name: 'Folder', projectPath: '/repo/apps/web' };
const ready: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'ready' };
const preparing: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'preparing' };
const failed: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'error' };
function task(overrides: Partial<Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>> = {}): Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'> {
  return { sessionIds: [], worktree: null, ...overrides };
}

describe('executionPreparationPlan', () => {
  it('asks for the worktree and offers the model for a first Git execution', () => {
    expect(executionPreparationPlan(task(), gitProject, true)).toEqual({ worktree: 'ask', model: true });
  });
  it('still asks for the worktree when the native selector is absent', () => {
    expect(executionPreparationPlan(task(), gitProject, false)).toEqual({ worktree: 'ask', model: false });
  });
  it('blocks on a preparing or errored binding, with or without the selector', () => {
    expect(executionPreparationPlan(task({ worktree: preparing }), gitProject, true)).toEqual({ worktree: 'blocked', model: false });
    expect(executionPreparationPlan(task({ worktree: failed }), gitProject, false)).toEqual({ worktree: 'blocked', model: false });
  });
  it('offers only the model when the worktree question does not apply', () => {
    expect(executionPreparationPlan(task({ worktree: ready }), gitProject, true)).toEqual({ worktree: 'none', model: true });
    expect(executionPreparationPlan(task({ worktreeDismissed: true }), gitProject, true)).toEqual({ worktree: 'none', model: true });
    expect(executionPreparationPlan(task(), folderProject, true)).toEqual({ worktree: 'none', model: true });
  });
  it('returns null when there is nothing to prepare', () => {
    expect(executionPreparationPlan(task(), folderProject, false)).toBeNull();
    expect(executionPreparationPlan(task({ worktree: ready }), gitProject, false)).toBeNull();
  });
  it('always returns null for a task that already has a conversation', () => {
    expect(executionPreparationPlan(task({ sessionIds: ['session-1'], worktree: failed }), gitProject, true)).toBeNull();
    expect(executionPreparationPlan(task({ sessionIds: ['session-1'] }), gitProject, true)).toBeNull();
    expect(executionPreparationPlan(task({ sessionIds: ['session-1'] }), folderProject, true)).toBeNull();
  });
  it('does not block a plain checkout whose project is no longer Git-backed', () => {
    expect(executionPreparationPlan(task({ worktree: failed }), folderProject, true)).toEqual({ worktree: 'none', model: true });
    expect(executionPreparationPlan(task({ worktree: failed }), folderProject, false)).toBeNull();
  });
  it('asks on a missing worktree regardless of a recorded base choice only when undecided', () => {
    expect(executionPreparationPlan(task({ worktreeDismissed: true }), gitProject, false)).toBeNull();
    expect(executionPreparationPlan(task({ worktreeDismissed: false }), gitProject, false)).toEqual({ worktree: 'ask', model: false });
  });
});
