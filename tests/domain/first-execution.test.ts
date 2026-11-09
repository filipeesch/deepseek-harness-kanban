import { describe, expect, it } from 'vitest';
import { planFirstExecution } from '../../src/domain/first-execution.js';
import type { Project, Task, Workflow } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const folderProject: Project = { id: 'f', name: 'Folder', projectPath: '/repo/apps/web' };
const ready: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'ready' };
const preparing: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'preparing' };
const failed: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'error' };

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

describe('planFirstExecution interactive', () => {
  it('asks for the worktree and offers the model for a first Git execution', () => {
    expect(planFirstExecution({ task: task(), project: gitProject, modelSeatAvailable: true, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'ask', model: true, entry: null });
  });
  it('still asks for the worktree when the native selector is absent', () => {
    expect(planFirstExecution({ task: task(), project: gitProject, modelSeatAvailable: false, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'ask', model: false, entry: null });
  });
  it('blocks on a preparing or errored binding, with or without the selector', () => {
    expect(planFirstExecution({ task: task({ worktree: preparing }), project: gitProject, modelSeatAvailable: true, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'blocked', model: false, entry: null });
    expect(planFirstExecution({ task: task({ worktree: failed }), project: gitProject, modelSeatAvailable: false, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'blocked', model: false, entry: null });
  });
  it('offers only the model when the worktree question does not apply', () => {
    expect(planFirstExecution({ task: task({ worktree: ready }), project: gitProject, modelSeatAvailable: true, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'none', model: true, entry: null });
    expect(planFirstExecution({ task: task({ worktreeDismissed: true }), project: gitProject, modelSeatAvailable: true, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'none', model: true, entry: null });
    expect(planFirstExecution({ task: task(), project: folderProject, modelSeatAvailable: true, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'none', model: true, entry: null });
  });
  it('returns null when there is nothing to prepare', () => {
    expect(planFirstExecution({ task: task(), project: folderProject, modelSeatAvailable: false, mode: 'interactive' })).toBeNull();
    expect(planFirstExecution({ task: task({ worktree: ready }), project: gitProject, modelSeatAvailable: false, mode: 'interactive' })).toBeNull();
  });
  it('always returns null for a task that already has a conversation', () => {
    expect(planFirstExecution({ task: task({ sessionIds: ['session-1'], worktree: failed }), project: gitProject, modelSeatAvailable: true, mode: 'interactive' })).toBeNull();
    expect(planFirstExecution({ task: task({ sessionIds: ['session-1'] }), project: gitProject, modelSeatAvailable: true, mode: 'interactive' })).toBeNull();
  });
  it('does not block a plain checkout whose project is no longer Git-backed', () => {
    expect(planFirstExecution({ task: task({ worktree: failed }), project: folderProject, modelSeatAvailable: true, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'none', model: true, entry: null });
    expect(planFirstExecution({ task: task({ worktree: failed }), project: folderProject, modelSeatAvailable: false, mode: 'interactive' })).toBeNull();
  });
  it('asks on a missing worktree regardless of a recorded base choice only when undecided', () => {
    expect(planFirstExecution({ task: task({ worktreeDismissed: true }), project: gitProject, modelSeatAvailable: false, mode: 'interactive' })).toBeNull();
    expect(planFirstExecution({ task: task({ worktreeDismissed: false }), project: gitProject, modelSeatAvailable: false, mode: 'interactive' }))
      .toEqual({ start: false, worktree: 'ask', model: false, entry: null });
  });
});

describe('planFirstExecution automatic', () => {
  it('starts with the default worktree and the instructed entry', () => {
    expect(planFirstExecution({ task: task(), project: gitProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'create-default', model: false, entry });
  });
  it('starts a folder project without a worktree', () => {
    expect(planFirstExecution({ task: task(), project: folderProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'none', model: false, entry });
  });
  it('uses the base project after a recorded choice', () => {
    expect(planFirstExecution({ task: task({ worktreeDismissed: true }), project: gitProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'base', model: false, entry });
  });
  it('reports a blocked binding without hiding the requested start', () => {
    expect(planFirstExecution({ task: task({ worktree: preparing }), project: gitProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: true, worktree: 'blocked', model: false, entry });
  });
  it('does not start without the start request, an entry, or without a conversation slot', () => {
    expect(planFirstExecution({ task: task(), project: gitProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: false }))
      .toEqual({ start: false, worktree: 'none', model: false, entry });
    const uninstructed: Workflow = { ...workflow, columns: [{ id: 'backlog', name: 'Backlog' }, { id: 'next', name: 'Next' }] };
    expect(planFirstExecution({ task: task(), project: gitProject, workflow: uninstructed, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: false, worktree: 'none', model: false, entry: null });
    expect(planFirstExecution({ task: task({ sessionIds: ['session-1'] }), project: gitProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: false, worktree: 'none', model: false, entry });
  });
  it('does not derive an entry from a stale marker', () => {
    expect(planFirstExecution({ task: task({ instructionPending: { columnId: 'next', enteredAt: 9 } }), project: gitProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: false, worktree: 'none', model: false, entry: null });
    expect(planFirstExecution({ task: task({ instructionPending: undefined }), project: gitProject, workflow, modelSeatAvailable: true, mode: 'automatic', startRequested: true }))
      .toEqual({ start: false, worktree: 'none', model: false, entry: null });
  });
});
