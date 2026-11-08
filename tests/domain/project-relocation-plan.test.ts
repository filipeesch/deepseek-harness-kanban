import { describe, expect, it } from 'vitest';
import { planProjectRelocation } from '../../src/domain/project-registration.js';

const from = { projectPath: '/repos/platform/apps/web', gitRootPath: '/repos/platform' };
const to = { projectPath: '/moved/platform/apps/web', gitRootPath: '/moved/platform' };

describe('project relocation plan', () => {
  it('moves a base task that sits on the previous project path', () => {
    const plan = planProjectRelocation(from, to, [{ id: 'base', effectiveCwd: '/repos/platform/apps/web', worktree: null }]);
    expect(plan.tasks).toEqual([{ taskId: 'base', from: '/repos/platform/apps/web', to: '/moved/platform/apps/web' }]);
    expect(plan.worktrees).toEqual([]);
  });

  it('keeps a worktree checkout and resolves the equivalent project subdirectory', () => {
    const plan = planProjectRelocation(from, to, [{ id: 'tree', effectiveCwd: '/trees/task/apps/web', worktree: { path: '/trees/task' } }]);
    expect(plan.tasks).toEqual([]);
    expect(plan.worktrees).toEqual([{ taskId: 'tree', worktreePath: '/trees/task', target: '/trees/task/apps/web' }]);
  });

  it('uses the worktree root when the project path equals its Git root', () => {
    const plan = planProjectRelocation(
      { projectPath: '/repos/platform', gitRootPath: '/repos/platform' },
      { projectPath: '/moved/platform', gitRootPath: '/moved/platform' },
      [{ id: 'root', effectiveCwd: '/trees/root', worktree: { path: '/trees/root' } }],
    );
    expect(plan.worktrees[0]!.target).toBe('/trees/root');
  });

  it('leaves a task whose directory matches neither source untouched', () => {
    const plan = planProjectRelocation(from, to, [{ id: 'other', effectiveCwd: '/elsewhere', worktree: null }]);
    expect(plan.tasks).toEqual([]);
    expect(plan.worktrees).toEqual([]);
  });

  it('leaves a retained plain checkout untouched when the target has no Git root', () => {
    const plan = planProjectRelocation(from, { projectPath: '/plain/notes' }, [{ id: 'tree', effectiveCwd: '/trees/task', worktree: { path: '/trees/task' } }]);
    expect(plan.tasks).toEqual([]);
    expect(plan.worktrees).toEqual([]);
  });
});
