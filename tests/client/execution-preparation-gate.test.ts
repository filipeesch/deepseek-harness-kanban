import { describe, expect, it } from 'vitest';
import { automaticPreparationOutcome, executionPreparationPlan } from '../../src/client/execution-preparation/gate.js';
import type { Project, Task } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', projectKey: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const folderProject: Project = { id: 'f', projectKey: 'f', name: 'Folder', projectPath: '/repo/apps/web' };
const ready: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'ready' };
const preparing: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'preparing' };
const failed: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'error' };
function task(overrides: Partial<Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>> = {}): Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'> {
  return { sessionIds: [], worktree: null, ...overrides };
}
function plan(
  overrides: Partial<Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>> = {},
  project: Project | undefined = gitProject,
) {
  return executionPreparationPlan(task(overrides), project);
}

describe('executionPreparationPlan', () => {
  it('asks for the worktree for a first Git execution', () => {
    expect(plan()).toEqual({ worktree: 'ask' });
  });
  it('blocks on a preparing or errored binding', () => {
    expect(plan({ worktree: preparing })).toEqual({ worktree: 'blocked' });
    expect(plan({ worktree: failed })).toEqual({ worktree: 'blocked' });
  });
  it('opens nothing when the worktree question does not apply', () => {
    expect(plan({ worktree: ready })).toBeNull();
    expect(plan({ worktreeDismissed: true })).toBeNull();
    expect(plan({}, folderProject)).toBeNull();
  });
  it('always returns null for a task that already has a conversation', () => {
    expect(plan({ sessionIds: ['session-1'], worktree: failed })).toBeNull();
    expect(plan({ sessionIds: ['session-1'] })).toBeNull();
    expect(plan({ sessionIds: ['session-1'] }, folderProject)).toBeNull();
  });
  it('does not block a plain checkout whose project is no longer Git-backed', () => {
    expect(plan({ worktree: failed }, folderProject)).toBeNull();
  });
  it('asks on a missing worktree only while the choice is undecided', () => {
    expect(plan({ worktreeDismissed: false })).toEqual({ worktree: 'ask' });
  });
});

describe('executionPreparationPlan under a project worktree policy', () => {
  const always: Project = { ...gitProject, worktreePolicy: 'always' };
  const never: Project = { ...gitProject, worktreePolicy: 'never' };

  it('creates the derived default without asking under Always create', () => {
    expect(plan({}, always)).toEqual({ worktree: 'create-default' });
  });
  it('presents nothing under Never, because no worktree decision remains', () => {
    expect(plan({}, never)).toBeNull();
  });
  it('still blocks on a binding that is not ready under either policy', () => {
    expect(plan({ worktree: preparing }, always)).toEqual({ worktree: 'blocked' });
    expect(plan({ worktree: failed }, never)).toEqual({ worktree: 'blocked' });
  });
});

describe('automaticPreparationOutcome', () => {
  it('creates the default worktree unless the policy forbids it', () => {
    expect(automaticPreparationOutcome(task(), gitProject)).toBe('create');
    expect(automaticPreparationOutcome(task(), { ...gitProject, worktreePolicy: 'always' })).toBe('create');
    expect(automaticPreparationOutcome(task(), { ...gitProject, worktreePolicy: 'never' })).toBe('none');
  });
  it('needs nothing when the task already has a worktree or a recorded choice', () => {
    expect(automaticPreparationOutcome(task({ worktree: ready }), gitProject)).toBe('none');
    expect(automaticPreparationOutcome(task({ worktreeDismissed: true }), gitProject)).toBe('none');
    expect(automaticPreparationOutcome(task(), folderProject)).toBe('none');
  });
});
