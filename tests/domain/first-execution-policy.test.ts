import { describe, expect, it } from 'vitest';
import { planFirstExecution, worktreeDecision } from '../../src/domain/first-execution.js';
import type { Project, Task, Workflow } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', projectKey: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const always: Project = { ...gitProject, worktreePolicy: 'always' };
const never: Project = { ...gitProject, worktreePolicy: 'never' };
const ready: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'ready' };
const preparing: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'preparing' };

type TaskInput = Parameters<typeof planFirstExecution>[0]['task'];
function task(overrides: Partial<Task> = {}): TaskInput {
  return { columnId: 'backlog', instructionPending: { columnId: 'backlog', enteredAt: 7 }, sessionIds: [], worktree: null, ...overrides };
}
const workflow: Workflow = {
  name: 'Flow', initialColumnId: 'backlog',
  columns: [{ id: 'backlog', name: 'Backlog', onEnterPrompt: 'Start here.' }, { id: 'next', name: 'Next' }],
  groups: [],
};
const entry = { columnId: 'backlog', enteredAt: 7, instruction: 'Start here.' };

describe('planFirstExecution under an Always create project', () => {
  it('creates the derived default without asking', () => {
    expect(planFirstExecution({ task: task(), project: always, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'create-default', entry: null });
  });
  it('defers to a choice the task already recorded', () => {
    expect(planFirstExecution({ task: task({ worktreeDismissed: true }), project: always, mode: 'interactive' })).toBeNull();
  });
  it('still blocks on a binding that is not ready', () => {
    expect(planFirstExecution({ task: task({ worktree: preparing }), project: always, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'blocked', entry: null });
  });
});

describe('planFirstExecution under a Never project', () => {
  it('presents no preparation, because no worktree decision remains', () => {
    expect(planFirstExecution({ task: task(), project: never, mode: 'interactive' })).toBeNull();
  });
  it('keeps a ready worktree usable', () => {
    expect(planFirstExecution({ task: task({ worktree: ready }), project: never, mode: 'interactive' })).toBeNull();
  });
  it('still blocks on a binding that is not ready', () => {
    expect(planFirstExecution({ task: task({ worktree: preparing }), project: never, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'blocked', entry: null });
  });
});

describe('planFirstExecution automatic under each policy', () => {
  it('creates the default worktree under Ask and Always create', () => {
    expect(planFirstExecution({ task: task(), project: gitProject, workflow, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'create-default', entry });
    expect(planFirstExecution({ task: task(), project: always, workflow, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'create-default', entry });
  });
  it('starts a Never project in the base project', () => {
    expect(planFirstExecution({ task: task(), project: never, workflow, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'none', entry });
  });
  it('keeps a recorded choice under every policy', () => {
    expect(planFirstExecution({ task: task({ worktreeDismissed: true }), project: always, workflow, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'base', entry });
  });
});

describe('worktreeDecision under each policy', () => {
  it('creates the default worktree unless the policy is Never', () => {
    expect(worktreeDecision(task(), gitProject)).toBe('create-default');
    expect(worktreeDecision(task(), always)).toBe('create-default');
    expect(worktreeDecision(task(), never)).toBe('none');
  });
  it('reports a recorded choice and a blocked binding', () => {
    expect(worktreeDecision(task({ worktreeDismissed: true }), never)).toBe('base');
    expect(worktreeDecision(task({ worktree: preparing }), always)).toBe('blocked');
  });
});
