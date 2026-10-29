import { describe, expect, it } from 'vitest';
import { saveProject } from '../../src/domain/hub-operations.js';
import type { HubState, HubTask } from '../../src/shared/types.js';
import { operationDeps, sampleHub } from './hub-helpers.js';

function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function folderHub(): HubState {
  const hub = sampleHub();
  hub.projects = [{ id: 'project', name: 'Project', projectPath: '/repo/app' }];
  return hub;
}

function failure(run: () => unknown): string | undefined {
  try { run(); return undefined; }
  catch (error) { return (error as { code?: string }).code; }
}

describe('project registration conversions', () => {
  it('adds a Git association to a folder project that still has tasks', () => {
    const hub = folderHub(); hub.tasks = [task()];
    const project = saveProject(hub, { id: 'project', name: 'Project', projectPath: '/repo/app', gitRootPath: '/repo', defaultBranch: 'main' }, operationDeps());
    expect(project.gitRootPath).toBe('/repo');
    expect(project.defaultBranch).toBe('main');
  });

  it('removes the Git association with tasks present and discards the default branch', () => {
    const hub = sampleHub(); hub.projects[0]!.defaultBranch = 'main'; hub.tasks = [task()];
    const project = saveProject(hub, { id: 'project', name: 'Project', projectPath: '/repo/app' }, operationDeps());
    expect(project.gitRootPath).toBeUndefined();
    expect(project.defaultBranch).toBeUndefined();
    expect('gitRootPath' in project).toBe(false);
  });

  it('blocks removing the Git association while a task context operation is unresolved', () => {
    const hub = sampleHub();
    hub.tasks = [task({ operation: { id: 'op', request: { kind: 'return' }, phase: 'git', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-01-01T00:00:00.000Z' } })];
    expect(failure(() => saveProject(hub, { id: 'project', name: 'Project', projectPath: '/repo/app' }, operationDeps()))).toBe('PROJECT_BUSY');
  });

  it('blocks removing the Git association while a worktree request is pending', () => {
    const hub = sampleHub();
    hub.tasks = [task({ pendingTransition: { id: 'pending', fromColumnId: 'backlog', columnId: 'review', mode: 'move', worktreeRequest: { mode: 'new', path: '/trees/x', branchName: 'x' }, status: 'waiting' } })];
    expect(failure(() => saveProject(hub, { id: 'project', name: 'Project', projectPath: '/repo/app' }, operationDeps()))).toBe('PROJECT_BUSY');
  });

  it('still rejects a project path change while tasks reference the project', () => {
    const hub = sampleHub(); hub.tasks = [task()];
    expect(failure(() => saveProject(hub, { id: 'project', name: 'Project', projectPath: '/repo/other', gitRootPath: '/repo' }, operationDeps()))).toBe('PROJECT_IN_USE');
  });

  it('still rejects a different Git root while tasks reference the project', () => {
    const hub = sampleHub(); hub.tasks = [task()];
    expect(failure(() => saveProject(hub, { id: 'project', name: 'Project', projectPath: '/repo/app', gitRootPath: '/other' }, operationDeps()))).toBe('PROJECT_IN_USE');
  });

  it('never stores a default branch without a Git root', () => {
    const hub = sampleHub();
    const project = saveProject(hub, { id: 'project', name: 'Project', projectPath: '/repo/app', defaultBranch: 'main' }, operationDeps());
    expect(project.defaultBranch).toBeUndefined();
  });

  it('creates a folder project without a Git root', () => {
    const hub = sampleHub();
    const project = saveProject(hub, { name: 'Notes', projectPath: '/plain/notes' }, operationDeps());
    expect(project.gitRootPath).toBeUndefined();
    expect(hub.projects.some(value => value.id === project.id)).toBe(true);
  });
});
