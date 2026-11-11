import { describe, expect, it } from 'vitest';
import { executionPreparationPlan, type PreparationModel } from '../../src/client/execution-preparation/gate.js';
import type { ModelCatalog, ModelSelection, Project, Task } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', projectKey: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const folderProject: Project = { id: 'f', projectKey: 'f', name: 'Folder', projectPath: '/repo/apps/web' };
const ready: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'ready' };
const preparing: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'preparing' };
const failed: Task['worktree'] = { path: '/trees/web', branch: 'feature', owned: true, status: 'error' };
function task(overrides: Partial<Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>> = {}): Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'> {
  return { sessionIds: [], worktree: null, ...overrides };
}
const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason' }] }],
  failures: [],
};
/** A board that leaves the model to the deployment default, with the catalog read anyway. */
const noModel: PreparationModel = { boardModel: undefined, catalog };
/** The catalog could not be read at all. */
const unreadable: PreparationModel = { boardModel: { provider: 'deepseek', model: 'chat' }, catalog: null };
function plan(
  overrides: Partial<Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>> = {},
  project: Project | undefined = gitProject,
  seat = true,
  model: PreparationModel = noModel,
) {
  return executionPreparationPlan(task(overrides), project, seat, model);
}

describe('executionPreparationPlan', () => {
  it('asks for the worktree and offers the model for a first Git execution', () => {
    expect(plan({}, gitProject, true)).toEqual({ worktree: 'ask', model: true });
  });
  it('still asks for the worktree when the native selector is absent', () => {
    expect(plan({}, gitProject, false)).toEqual({ worktree: 'ask', model: false });
  });
  it('blocks on a preparing or errored binding, with or without the selector', () => {
    expect(plan({ worktree: preparing }, gitProject, true)).toEqual({ worktree: 'blocked', model: false });
    expect(plan({ worktree: failed }, gitProject, false)).toEqual({ worktree: 'blocked', model: false });
  });
  it('offers only the model when the worktree question does not apply', () => {
    expect(plan({ worktree: ready }, gitProject, true)).toEqual({ worktree: 'none', model: true });
    expect(plan({ worktreeDismissed: true }, gitProject, true)).toEqual({ worktree: 'none', model: true });
    expect(plan({}, folderProject, true)).toEqual({ worktree: 'none', model: true });
  });
  it('returns null when there is nothing to prepare', () => {
    expect(plan({}, folderProject, false)).toBeNull();
    expect(plan({ worktree: ready }, gitProject, false)).toBeNull();
  });
  it('always returns null for a task that already has a conversation', () => {
    expect(plan({ sessionIds: ['session-1'], worktree: failed }, gitProject, true)).toBeNull();
    expect(plan({ sessionIds: ['session-1'] }, gitProject, true)).toBeNull();
    expect(plan({ sessionIds: ['session-1'] }, folderProject, true)).toBeNull();
  });
  it('does not block a plain checkout whose project is no longer Git-backed', () => {
    expect(plan({ worktree: failed }, folderProject, true)).toEqual({ worktree: 'none', model: true });
    expect(plan({ worktree: failed }, folderProject, false)).toBeNull();
  });
  it('asks on a missing worktree regardless of a recorded base choice only when undecided', () => {
    expect(plan({ worktreeDismissed: true }, gitProject, false)).toBeNull();
    expect(plan({ worktreeDismissed: false }, gitProject, false)).toEqual({ worktree: 'ask', model: false });
  });

  describe('with a model the board names', () => {
    const boardModel: ModelSelection = { provider: 'deepseek', model: 'reason' };
    it('drops the model step when the catalog offers the route the board named', () => {
      expect(plan({}, gitProject, true, { boardModel, catalog })).toEqual({ worktree: 'ask', model: false });
      expect(plan({}, gitProject, true, { boardModel: { ...boardModel, reasoningEffort: 'high' }, catalog })).toEqual({ worktree: 'ask', model: false });
    });
    it('opens nothing at all when the model was the only step left', () => {
      expect(plan({ worktree: ready }, gitProject, true, { boardModel, catalog })).toBeNull();
      expect(plan({}, folderProject, true, { boardModel, catalog })).toBeNull();
    });
    it('keeps the model step for a route the catalog does not offer', () => {
      expect(plan({}, gitProject, true, { boardModel: { provider: 'anthropic', model: 'claude' }, catalog })).toEqual({ worktree: 'ask', model: true });
    });
    it('keeps the model step when the catalog could not be read', () => {
      expect(plan({}, gitProject, true, unreadable)).toEqual({ worktree: 'ask', model: true });
    });
    it('keeps asking about the worktree even when the model is settled', () => {
      expect(plan({ worktree: preparing }, gitProject, true, { boardModel, catalog })).toEqual({ worktree: 'blocked', model: false });
      expect(plan({}, gitProject, false, { boardModel, catalog })).toEqual({ worktree: 'ask', model: false });
    });
  });
});
