import { describe, expect, it } from 'vitest';
import { needsRelocation, relocationBlockedReason, relocationImpact } from '../../src/client/projects/project-relocation-impact.js';
import type { Project, Task } from '../../src/shared/types.js';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
    sessionIds: ['session-1'], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

const project: Project = { id: 'project', projectKey: 'project', name: 'Web', projectPath: '/repo/app', gitRootPath: '/repo' };
const other = { ...project, id: 'other', name: 'Other', projectPath: '/repo/other' };
const moved = { name: 'Web', projectPath: '/moved/app', gitRootPath: '/moved' };

describe('relocation cannot carry a key edit', () => {
  it('blocks a path change combined with a key change', () => {
    const project = { id: 'p', name: 'P', projectKey: 'before', projectPath: '/repo/app' } as const;
    const tasks = [{ projectId: 'p' } as never];
    expect(relocationBlockedReason(project, { id: 'p', name: 'P', projectPath: '/repo/moved', projectKey: 'after' }, tasks)).toMatch(/key/);
    expect(relocationBlockedReason(project, { id: 'p', name: 'P', projectPath: '/repo/moved' }, tasks)).toBeNull();
    expect(relocationBlockedReason(project, { id: 'p', name: 'P', projectPath: '/repo/moved', projectKey: 'before' }, tasks)).toBeNull();
  });
});

describe('project relocation impact', () => {
  it('keeps a task-free project on the save path even when the hub has other tasks', () => {
    expect(needsRelocation(other, { ...other, projectPath: '/moved/other' }, [task()])).toBe(false);
    expect(relocationBlockedReason(other, { ...other, projectPath: '/moved/other' }, [task()])).toBeNull();
  });

  it('requires a relocation for a project with tasks and a changed location', () => {
    expect(needsRelocation(project, moved, [task()])).toBe(true);
  });

  it('treats adding or removing a Git association as a save, not a relocation', () => {
    expect(needsRelocation(project, { name: 'Web', projectPath: '/repo/app' }, [task()])).toBe(false);
    expect(relocationBlockedReason(project, { name: 'Web', projectPath: '/repo/app' }, [task()])).toBeNull();
  });

  it('blocks a combined Git-association and location change', () => {
    const input = { name: 'Web', projectPath: '/moved/app' };
    expect(relocationBlockedReason(project, input, [task()])).toMatch(/two steps|Git association/);
    expect(needsRelocation(project, input, [task()])).toBe(false);
  });

  it('counts only the edited project in the impact', () => {
    const impact = relocationImpact(project, moved, [task(), task({ id: 'other-task', projectId: 'other', worktree: { path: '/trees/x', branch: 'x', owned: true, status: 'ready' } })], () => false);
    expect(impact.tasks).toBe(1);
    expect(impact.worktrees).toBe(0);
  });
});
