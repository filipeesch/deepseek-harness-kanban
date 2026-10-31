import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fixture, taskWithConversation } from './helpers.js';
import { KanbanApp } from '../../src/host/app.js';
import { HubRepository } from '../../src/host/hub-repository.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

async function worktreeTask(f: Awaited<ReturnType<typeof setup>>, title: string) {
  const task = await f.app.createTask({ projectId: f.project.id, title, description: '' });
  const root = path.join(f.root, 'trees', title.replace(/\s+/g, '-'));
  await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: root, branchName: 'task/' + title.replace(/\s+/g, '-'), sourceBranch: 'main' });
  return { task: f.store.requireTask(task.id), root };
}

async function bindSecondTask(f: Awaited<ReturnType<typeof setup>>, id: string, root: string): Promise<void> {
  const source = f.store.requireTask(f.store.snapshot().tasks[0]!.id);
  await f.store.transact(draft => { draft.tasks.push({
    ...structuredClone(source), id, title: 'Other binding', sessionIds: [], closedSessionIds: [],
    worktree: { path: root, branch: 'task/other', owned: true, status: 'ready' }, effectiveCwd: path.join(root, 'apps', 'web'),
  }); });
}

describe('background destructive commands', () => {
  it('returns after admission and completes the deletion from the queue', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Queued delete', description: '' });
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    const admitted = f.store.requireTask(task.id);
    expect(admitted.operation).not.toBeNull();
    expect(f.sessions.archived).toEqual([]);
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
  });

  it('keeps admission failures synchronous instead of queueing them', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Shared admission');
    await bindSecondTask(f, 'other-binding', root);
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root })).rejects.toMatchObject({ code: 'SHARED_WORKTREE' });
    const failed = f.store.requireTask(task.id);
    expect(failed.operation?.phase).toBe('failed');
    expect(f.git.removed).toEqual([]);
    expect(f.store.requireTask('other-binding').worktree?.status).toBe('ready');
  });

  it('force deletes a checkout shared with another task and marks that binding', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Force delete');
    await bindSecondTask(f, 'other-binding', root);
    await bindSecondTask(f, 'third-binding', root);
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root })).rejects.toMatchObject({ code: 'SHARED_WORKTREE' });
    const failed = f.store.requireTask(task.id).operation!;
    const blockers = failed.error?.details?.blockers as Array<{ kind: string; taskId?: string }>;
    expect(blockers).toHaveLength(2);
    expect(blockers).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'task', taskId: 'other-binding' }), expect.objectContaining({ kind: 'task', taskId: 'third-binding' })]));
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true });
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    const other = f.store.requireTask('other-binding');
    expect(other.worktree?.status).toBe('error');
    expect(other.worktree?.error).toMatchObject({ code: 'WORKTREE_REMOVED', details: { removedByTaskId: task.id } });
    expect(other.effectiveCwd).toBe(path.join(root, 'apps', 'web'));
    expect(f.store.requireTask('third-binding').worktree?.status).toBe('error');
    expect(f.git.removed).toEqual([root]);
  });

  it('refuses force while another task operates on the same checkout', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Force active');
    await bindSecondTask(f, 'active-binding', root);
    await f.store.transact(draft => {
      draft.tasks.find(value => value.id === 'active-binding')!.operation = {
        id: 'active-op', request: { kind: 'delete', discardChanges: false }, phase: 'waiting', targetPath: root,
        previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: new Date().toISOString(),
      };
    });
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true })).rejects.toMatchObject({ code: 'OPERATION_PENDING' });
    expect(f.git.removed).toEqual([]);
    expect((await f.store.requireTask('active-binding')).worktree?.status).toBe('ready');
    await f.store.transact(draft => { draft.tasks.find(value => value.id === 'active-binding')!.operation = null; });
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true });
    await f.app.worktrees.settle();
    expect(f.git.removed).toEqual([root]);
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
  });

  it('force still requires the separate discard consent', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Force dirty');
    await bindSecondTask(f, 'other-binding', root);
    f.git.trees.set(root, { path: root, branch: 'task/Force-dirty', dirty: true, commonDirectory: path.join(f.gitRoot, '.git') });
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true })).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    expect(f.git.removed).toEqual([]);
    expect(f.store.requireTask(task.id).operation?.phase).toBe('failed');
  });

  it('force removes a shared checkout while retaining the task and marking affected bindings', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Force remove');
    await bindSecondTask(f, 'other-binding', root);
    await expect(f.app.command({ type: 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: root })).rejects.toMatchObject({ code: 'SHARED_WORKTREE' });
    await f.app.command({ type: 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true });
    await f.app.worktrees.settle();
    const current = f.store.requireTask(task.id);
    expect(current.operation).toBeNull();
    expect(current.worktree).toBeNull();
    expect(current.effectiveCwd).toBe(f.project.projectPath);
    const other = f.store.requireTask('other-binding');
    expect(other.worktree?.status).toBe('error');
    expect(other.worktree?.error?.code).toBe('WORKTREE_REMOVED');
    expect(f.git.removed).toEqual([root]);
  });

  it('marks an affected binding that lives in another Hub', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Force cross hub');
    const created = await f.app.command({ type: 'hub.create', name: 'Second' });
    const hubId = f.hubs.list().find(hub => hub.name === 'Second')!.id;
    void created;
    await f.hubs.hub(hubId).addBoard('Other board');
    const project = await f.hubs.hub(hubId).saveProject({ name: 'Other project', projectPath: f.projectPath, gitRootPath: f.gitRoot });
    const other = await f.hubs.hub(hubId).createTask({ projectId: project.id, title: 'Cross hub binding', description: '' });
    await f.hubs.hub(hubId).transact(draft => {
      const value = draft.tasks.find(item => item.id === other.id)!;
      value.worktree = { path: root, branch: 'task/cross', owned: true, status: 'ready' };
      value.effectiveCwd = path.join(root, 'apps', 'web');
    });
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true });
    await f.app.worktrees.settle();
    const marked = f.hubs.requireTask(other.id).task;
    expect(marked.worktree?.status).toBe('error');
    expect(marked.worktree?.error?.details).toMatchObject({ removedByTaskId: task.id });
  });

  it('clears a binding whose checkout was removed externally', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Removed binding', description: '' });
    const missing = path.join(f.root, 'trees', 'already-gone');
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === task.id)!;
      value.worktree = { path: missing, branch: 'task/gone', owned: true, status: 'error', error: { code: 'WORKTREE_REMOVED', message: 'Removed externally.' } };
      value.effectiveCwd = path.join(missing, 'apps', 'web');
    });
    await f.app.command({ type: 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: missing });
    await f.app.worktrees.settle();
    const current = f.store.requireTask(task.id);
    expect(current.worktree).toBeNull();
    expect(current.operation).toBeNull();
    expect(current.effectiveCwd).toBe(f.project.projectPath);
  });

  it('persists queued operations and worktree errors across a reload', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Reload additions', description: '' });
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === task.id)!;
      value.worktree = { path: '/tree', branch: 'feature', owned: true, status: 'error', error: { code: 'WORKTREE_REMOVED', message: 'Removed externally.' } };
      value.operation = {
        id: 'queued-reload', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: '/tree' }, phase: 'queued',
        previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: new Date().toISOString(),
      };
    });
    const reopened = await HubRepository.open(f.storage);
    try {
      const loaded = reopened.requireTask(task.id).task;
      expect(loaded.operation?.phase).toBe('queued');
      expect(loaded.worktree?.status).toBe('error');
      expect(loaded.worktree?.error?.code).toBe('WORKTREE_REMOVED');
    } finally { await reopened.close(); }
  });

  it('keeps an in-progress deletion resumable when the app closes', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Close mid delete', description: '' });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const archive = f.sessions.archive.bind(f.sessions);
    f.sessions.archive = async (id: string) => { await gate; return archive(id); };
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    await expect.poll(() => f.store.requireTask(task.id).operation?.phase, { timeout: 5000 }).toBe('archiving');
    const closing = f.app.close();
    release();
    await closing;
    expect(f.store.snapshot().tasks).toHaveLength(1);
    expect(f.store.requireTask(task.id).operation?.phase).toBe('queued');
    f.sessions.archive = archive;
    const reopened = new KanbanApp(await HubRepository.open(f.storage), f.sessions, f.git, { probe: f.probe }, f.workspaces);
    await reopened.initialize();
    await reopened.worktrees.settle();
    expect(reopened.store.snapshot().tasks).toHaveLength(0);
    await reopened.close();
  });
});
