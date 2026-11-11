import { describe, expect, it } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { TaskBindingIndex } from '../../src/host/task-binding-index.js';
import { MemoryHubStorage } from './helpers.js';

async function fixture() {
  const hubs = await HubRepository.open(new MemoryHubStorage());
  const store = hubs.defaultHub();
  const project = await store.saveProject({ name: 'Repo', projectPath: '/memory/repo/apps/api', gitRootPath: '/memory/repo' });
  const task = await store.createTask({ projectId: project.id, title: 'Task', description: '' });
  await store.addSession(task.id, 'session-a');
  return { hubs, store, project, task };
}

describe('worktree binding projection', () => {
  it('projects a task binding, its reserved paths, and its lane without cloning the Hub', async () => {
    const f = await fixture();
    const bindings = f.hubs.worktreeBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      taskId: f.task.id,
      title: 'Task',
      projectId: f.project.id,
      lane: '/memory/repo',
      sessionIds: ['session-a'],
      worktreePath: null,
      operation: null,
    });
  });

  it('reuses the projection until the repository changes', async () => {
    const f = await fixture();
    const first = f.hubs.worktreeBindings();
    expect(f.hubs.worktreeBindings()).toBe(first);
    await f.store.setAutoMode(f.task.id, true);
    const second = f.hubs.worktreeBindings();
    expect(second).not.toBe(first);
  });

  it('reserves every path a task already uses, for collision-free name derivation', async () => {
    const f = await fixture();
    await f.store.transact(state => {
      const task = state.tasks.find(item => item.id === f.task.id)!;
      task.worktree = { path: '/memory/trees/bound', branch: 'bound', owned: true, status: 'ready' };
      task.unclaimedWorktrees = [{ path: '/memory/trees/unclaimed', branch: 'u', error: { code: 'X', message: 'x' } }];
      task.pendingTransition = { id: 'p', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'run', status: 'waiting', worktreeRequest: { mode: 'new', path: '/memory/trees/pending', branchName: 'p' } };
    });
    const index = new TaskBindingIndex(f.hubs);
    expect([...index.occupied()].sort()).toEqual(['/memory/trees/bound', '/memory/trees/pending', '/memory/trees/unclaimed']);
  });

  it('finds another task operating on the same checkout and the binding that covers it', async () => {
    const f = await fixture();
    const other = await f.store.createTask({ projectId: f.project.id, title: 'Other', description: '' });
    await f.store.transact(state => {
      const task = state.tasks.find(item => item.id === other.id)!;
      task.worktree = { path: '/memory/trees/shared', branch: 'shared', owned: true, status: 'ready' };
      task.operation = {
        id: 'op', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: '/memory/trees/shared' }, phase: 'git',
        targetPath: '/memory/trees/shared', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: new Date().toISOString(),
      };
    });
    const index = new TaskBindingIndex(f.hubs);
    const active = await index.activeOperations('/memory/trees/shared', f.task.id);
    expect(active.map(entry => entry.taskId)).toEqual([other.id]);
    const blockers = await index.blockingTasks(f.task.id, '/memory/trees/shared');
    expect(blockers.map(entry => entry.kind === 'task' ? entry.taskId : entry.sessionId)).toEqual([other.id]);
    // A settled operation is not an active one.
    await f.store.transact(state => { state.tasks.find(item => item.id === other.id)!.operation!.phase = 'failed'; });
    expect(await new TaskBindingIndex(f.hubs).activeOperations('/memory/trees/shared', f.task.id)).toEqual([]);
  });
});
