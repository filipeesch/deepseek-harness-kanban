import { describe, expect, it, vi } from 'vitest';
import { WorkspaceCoordinator, type WorkspaceBindingStore, type WorkspaceTaskRef } from '../../src/host/workspace-coordinator.js';
import type { HubTask, RegisteredProject } from '../../src/shared/types.js';
import { TestSessions, TestWorkspaces } from './helpers.js';

const projectPath = '/repo/apps/web';
const worktreePath = '/repo/.worktrees/task-1/apps/web';

function project(overrides: Partial<RegisteredProject> = {}): RegisteredProject {
  return { id: 'project-1', projectKey: 'project-1', name: 'Web', projectPath, gitRootPath: '/repo', ...overrides };
}

function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task-1', projectId: 'project-1', title: 'Task', description: '', columnId: 'backlog', position: 0, boardId: 'board-1',
    sessionIds: [], closedSessionIds: [], effectiveCwd: projectPath, worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function worktreeTask(overrides: Partial<HubTask> = {}): HubTask {
  return task({
    effectiveCwd: worktreePath,
    worktree: { path: '/repo/.worktrees/task-1', branch: 'feature', owned: true, status: 'ready' },
    ...overrides,
  });
}

class TestBindingStore implements WorkspaceBindingStore {
  readonly refs: WorkspaceTaskRef[] = [];
  all(): WorkspaceTaskRef[] { return this.refs; }
  async setProjectWorkspace(_hubId: string, projectId: string, workspaceId: string, owned: boolean): Promise<void> {
    const ref = this.refs.find(value => value.project.id === projectId);
    if (!ref) throw new Error('Missing project ref.');
    ref.project.workspaceId = workspaceId;
    ref.project.workspaceOwned = owned;
  }
  async setTaskWorktreeWorkspace(_hubId: string, taskId: string, workspaceId: string, owned: boolean): Promise<void> {
    const ref = this.refs.find(value => value.task.id === taskId);
    if (!ref) throw new Error('Missing task ref.');
    ref.task.worktreeWorkspaceId = workspaceId;
    ref.task.worktreeWorkspaceOwned = owned;
  }
}

function setup(options: { supportsHidden?: boolean; report?: (error: unknown) => void } = {}) {
  const workspaces = new TestWorkspaces();
  if (options.supportsHidden === false) workspaces.supportsHidden = false;
  const sessions = new TestSessions();
  const store = new TestBindingStore();
  const coordinator = new WorkspaceCoordinator({
    workspaces,
    sessions,
    store,
    ...(options.report ? { report: options.report } : {}),
  });
  return { workspaces, sessions, store, coordinator };
}

describe('WorkspaceCoordinator visibility', () => {
  it('creates a hidden worktree workspace and records its binding', async () => {
    const f = setup();
    const p = project();
    const t = worktreeTask();
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });

    const id = await f.coordinator.ensureTaskWorkspace('hub-1', t, p);

    expect(id).toBeTruthy();
    expect(f.workspaces.byId.get(id!)?.hidden).toBe(true);
    expect(t.worktreeWorkspaceId).toBe(id);
    expect(t.worktreeWorkspaceOwned).toBe(true);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('hides an adopted visible worktree workspace once and never re-hides it', async () => {
    const f = setup();
    const p = project();
    const t = worktreeTask({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', worktreePath);
    const adopted = await f.workspaces.ensure(worktreePath, { title: 'Web · feature' });
    expect(adopted.workspace.hidden).toBe(false);

    const id = await f.coordinator.ensureTaskWorkspace('hub-1', t, p);

    expect(id).toBe(adopted.workspace.id);
    expect(f.workspaces.get(id!)?.hidden).toBe(true);
    expect(t.worktreeWorkspaceOwned).toBe(false);
    expect(f.workspaces.setHiddenCalls).toEqual([{ id: adopted.workspace.id, hidden: true }]);

    f.workspaces.get(id!)!.hidden = false;
    f.workspaces.setHiddenCalls.length = 0;
    await f.coordinator.reconcile();

    expect(f.workspaces.get(id!)?.hidden).toBe(false);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('keeps the shared project workspace visible and reveals one that is hidden', async () => {
    const f = setup();
    const p = project();
    const created = await f.workspaces.ensure(projectPath, { title: 'Web' });
    p.workspaceId = created.workspace.id;
    p.workspaceOwned = created.owned;

    await f.coordinator.ensureProject('hub-1', p);
    expect(f.workspaces.setHiddenCalls).toEqual([]);

    created.workspace.hidden = true;
    await f.coordinator.ensureProject('hub-1', p);

    expect(f.workspaces.setHiddenCalls).toEqual([{ id: created.workspace.id, hidden: false }]);
    expect(created.workspace.hidden).toBe(false);
  });

  it('does not hide an existing session-directory workspace during reconcile', async () => {
    const f = setup();
    const p = project();
    const t = task({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', worktreePath);
    const existing = await f.workspaces.ensure(worktreePath, { title: 'Web · feature' });

    await f.coordinator.reconcile();

    expect(existing.workspace.hidden).toBe(false);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('creates a hidden workspace for a session directory', async () => {
    const f = setup();
    const p = project();
    const t = task({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', worktreePath);

    await f.coordinator.reconcile();

    expect(f.workspaces.byPath.get(worktreePath)?.hidden).toBe(true);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('does not change a bound worktree workspace during reconcile', async () => {
    const f = setup();
    const p = project();
    const t = worktreeTask({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', worktreePath);
    const bound = await f.workspaces.ensure(worktreePath, { title: 'Web · feature' });
    t.worktreeWorkspaceId = bound.workspace.id;
    t.worktreeWorkspaceOwned = true;

    await f.coordinator.reconcile();

    expect(bound.workspace.hidden).toBe(false);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('provisions a hidden worktree workspace during reconcile', async () => {
    const f = setup();
    const p = project();
    const t = worktreeTask({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', worktreePath);

    await f.coordinator.reconcile();

    expect(t.worktreeWorkspaceId).toBeTruthy();
    expect(f.workspaces.get(t.worktreeWorkspaceId!)?.hidden).toBe(true);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('reveals a hidden shared project workspace during reconcile', async () => {
    const f = setup();
    const p = project();
    const t = task({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', projectPath);
    const projectWorkspace = await f.workspaces.ensure(projectPath, { title: 'Web' });
    projectWorkspace.workspace.hidden = true;
    p.workspaceId = projectWorkspace.workspace.id;
    p.workspaceOwned = projectWorkspace.owned;

    await f.coordinator.reconcile();

    expect(projectWorkspace.workspace.hidden).toBe(false);
    expect(f.workspaces.setHiddenCalls).toContainEqual({ id: projectWorkspace.workspace.id, hidden: false });
  });

  it('does not change an unmanaged workspace during reconcile', async () => {
    const f = setup();
    const p = project();
    const t = task({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', projectPath);
    const unmanaged = await f.workspaces.ensure('/repo/other', { title: 'Other' });

    await f.coordinator.reconcile();

    expect(unmanaged.workspace.hidden).toBe(false);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('keeps workspaces visible when the host cannot hide them', async () => {
    const f = setup({ supportsHidden: false });
    const p = project();
    const t = worktreeTask();
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });

    const id = await f.coordinator.ensureTaskWorkspace('hub-1', t, p);

    expect(f.workspaces.get(id!)?.hidden).toBe(false);
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });

  it('reports a failed hide, still records the binding, and does not retry it', async () => {
    const report = vi.fn();
    const f = setup({ report });
    const p = project();
    const t = worktreeTask({ sessionIds: ['session-1'] });
    f.store.refs.push({ hubId: 'hub-1', task: t, project: p });
    f.sessions.dirs.set('session-1', worktreePath);
    const adopted = await f.workspaces.ensure(worktreePath, { title: 'Web · feature' });
    f.workspaces.setHiddenFailure = new Error('visibility write failed');

    const id = await f.coordinator.ensureTaskWorkspace('hub-1', t, p);

    expect(id).toBe(adopted.workspace.id);
    expect(report).toHaveBeenCalledTimes(1);
    expect(f.workspaces.get(id!)?.hidden).toBe(false);
    expect(t.worktreeWorkspaceId).toBe(id);
    expect(t.worktreeWorkspaceOwned).toBe(false);

    f.workspaces.setHiddenCalls.length = 0;
    await f.coordinator.reconcile();
    expect(f.workspaces.setHiddenCalls).toEqual([]);
  });
});
