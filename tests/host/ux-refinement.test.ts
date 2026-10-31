import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { BoardStore } from '../../src/domain/store.js';
import { initialState } from '../../src/domain/schema.js';
import { fixture, taskWithConversation, MemoryStorage, TestWorkspaces } from './helpers.js';
import type { Task } from '../../src/shared/types.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
function v1State() {
  const state = initialState() as unknown as Record<string, unknown> & { tasks: Task[]; projects: unknown[] };
  state.schemaVersion = 1;
  state.projects = [{ id: 'project', name: 'Project', projectPath: '/repo', gitRootPath: '/repo' }];
  state.tasks = [{
    id: 'task', projectId: 'project', title: 'Legacy task', description: '', columnId: 'backlog', position: 0,
    sessionIds: ['session'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z', archivedAt: null,
  } as unknown as Task];
  return state;
}

describe('delete-only lifecycle and placement', () => {
  it('migrates a version-one board by dropping archive metadata', async () => {
    const storage = new MemoryStorage(); storage.value = v1State() as never;
    const store = await BoardStore.open(storage);
    expect(store.snapshot().schemaVersion).toBe(2);
    expect((store.snapshot().tasks[0] as unknown as Record<string, unknown>).archivedAt).toBeUndefined();
    expect((storage.value as unknown as { schemaVersion: number; tasks: Array<Record<string, unknown>> }).schemaVersion).toBe(2);
    expect((storage.value as unknown as { tasks: Array<Record<string, unknown>> }).tasks[0]!.archivedAt).toBeUndefined();
  });

  it('fails closed for a legacy task that was archived', async () => {
    const storage = new MemoryStorage(); const state = v1State() as unknown as { tasks: Array<Record<string, unknown>> }; state.tasks[0]!.archivedAt = '2026-10-21T12:00:00.000Z'; storage.value = state as never;
    await expect(BoardStore.open(storage)).rejects.toMatchObject({ code: 'LEGACY_ARCHIVED_TASK' });
  });

  it('rejects batch deletion before starting when a conversation is busy', async () => {
    const f = await setup(); const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Busy', description: '' });
    f.sessions.busy.add(task.sessionIds[0]!);
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null, requireIdle: true })).rejects.toMatchObject({ code: 'TASK_BUSY' });
    expect(f.store.requireTask(task.id).operation).toBeNull(); expect(f.sessions.archived).toEqual([]);
  });

  it('rejects batch deletion before starting when the worktree is dirty', async () => {
    const f = await setup(); const task = await f.app.createTask({ projectId: f.project.id, title: 'Dirty', description: '' });
    const tree = path.join(f.root, 'dirty-tree');
    await f.store.transact(state => { const value = f.store.requireTask(task.id, state); value.worktree = { path: tree, branch: 'dirty', owned: true, status: 'ready' }; value.effectiveCwd = path.join(tree, 'apps', 'web'); });
    f.git.trees.set(tree, { path: tree, branch: 'dirty', dirty: true, commonDirectory: path.join(f.gitRoot, '.git') });
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: tree, requireIdle: true })).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    expect(f.store.requireTask(task.id).operation).toBeNull(); expect(f.git.removed).toEqual([]);
  });

  it('reorders within a column using beforeTaskId and rejects an invalid anchor', async () => {
    const f = await setup();
    const a = await f.app.createTask({ projectId: f.project.id, title: 'A', description: '' });
    const b = await f.app.createTask({ projectId: f.project.id, title: 'B', description: '' });
    const c = await f.app.createTask({ projectId: f.project.id, title: 'C', description: '' });
    await f.app.command({ type: 'task.move', taskId: c.id, columnId: 'backlog', beforeTaskId: a.id });
    const order = f.store.snapshot().tasks.filter(task => task.columnId === 'backlog').sort((left, right) => left.position - right.position).map(task => task.title);
    expect(order).toEqual(['B', 'C', 'A']);
    await expect(f.app.command({ type: 'task.move', taskId: c.id, columnId: 'backlog', beforeTaskId: 'missing-task' })).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    expect(f.store.requireTask(c.id).position).toBe(1);
    expect(b.id).not.toBe(a.id);
  });
});

describe('native workspace binding', () => {
  it('shares the base workspace and binds each conversation to it', async () => {
    const f = await setup();
    const first = await taskWithConversation(f.app, { projectId: f.project.id, title: 'First', description: '' });
    const second = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Second', description: '' });
    const project = f.store.requireProject(f.project.id);
    expect(project.workspaceId).toBeTruthy();
    expect(f.sessions.workspaceIds.get(first.sessionIds[0]!)).toBe(project.workspaceId);
    expect(f.sessions.workspaceIds.get(second.sessionIds[0]!)).toBe(project.workspaceId);
    expect(f.workspaces.byPath.get(f.projectPath)?.id).toBe(project.workspaceId);
  });

  it('creates a separate owned worktree workspace and cleans it up on deletion', async () => {
    const f = await setup(); const task = await f.app.createTask({ projectId: f.project.id, title: 'Tree task', description: '' });
    const tree = path.join(f.root, 'feature-tree');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'task/feature', sourceBranch: 'main' });
    const conversation = await f.app.createConversation(task.id);
    const bound = f.store.requireTask(task.id);
    const worktreePath = path.join(tree, 'apps', 'web');
    expect(bound.effectiveCwd).toBe(worktreePath);
    expect(bound.worktreeWorkspaceId).toBeTruthy();
    expect(f.sessions.workspaceIds.get(conversation)).toBe(bound.worktreeWorkspaceId);
    expect(f.workspaces.get(bound.worktreeWorkspaceId!)?.path).toBe(worktreePath);
    const baseWorkspace = f.store.requireProject(f.project.id).workspaceId;
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: tree, requireIdle: true });
    expect(f.store.snapshot().tasks).toHaveLength(0);
    expect(f.workspaces.deleted).toContain(bound.worktreeWorkspaceId);
    expect(f.workspaces.deleted).not.toContain(baseWorkspace);
  });

  it('does not create a workspace or native session when a task is created', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Lazy task', description: '' });
    expect(task.sessionIds).toEqual([]);
    expect(f.sessions.dirs.size).toBe(0);
    expect(f.workspaces.byPath.size).toBe(0);
  });

  it('does not create a cwd-only session when the first workspace creation fails', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Workspace failure', description: '' });
    await f.app.command({ type: 'worktree.dismiss', taskId: task.id });
    const broken = new TestWorkspaces(); broken.ensure = async () => { throw new Error('workspace unavailable'); };
    const app = new (await import('../../src/host/app.js')).KanbanApp(f.hubs, f.sessions, f.git, {}, broken);
    await expect(app.createConversation(task.id)).rejects.toThrow('workspace unavailable');
    expect(f.sessions.dirs.size).toBe(0);
    expect(f.store.requireTask(task.id).sessionIds).toEqual([]);
    await app.close();
  });

  it('reconciles a workspace for an existing cwd-only task', async () => {
    const f = await setup();
    const legacy = await f.store.createTask({ projectId: f.project.id, title: 'Legacy task', description: '' });
    await f.store.addSession(legacy.id, 'legacy-session');
    f.sessions.dirs.set('legacy-session', f.projectPath);
    await f.store.transact(state => { const project = state.projects.find(value => value.id === f.project.id)!; delete project.workspaceId; delete project.workspaceOwned; });
    const { KanbanApp } = await import('../../src/host/app.js');
    const app = new KanbanApp(f.hubs, f.sessions, f.git, {}, f.workspaces);
    await app.initialize();
    const project = f.store.requireProject(f.project.id);
    expect(project.workspaceId).toBeTruthy();
    expect(f.workspaces.byPath.get(f.projectPath)?.id).toBe(project.workspaceId);
    await app.close();
  });
});
