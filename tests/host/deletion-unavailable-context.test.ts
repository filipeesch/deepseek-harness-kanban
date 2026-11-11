import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fixture, taskWithConversation } from './helpers.js';
import { KanbanError } from '../../src/shared/errors.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0).reverse()) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
type F = Awaited<ReturnType<typeof setup>>;

async function worktreeTask(f: F, title: string) {
  const task = await f.app.createTask({ projectId: f.project.id, title, description: '' });
  const root = path.join(f.root, 'trees', title.replace(/\s+/g, '-'));
  await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: root, branchName: 'task/' + title.replace(/\s+/g, '-'), sourceBranch: 'main' });
  await f.app.createConversation(task.id);
  return { task: f.store.requireTask(task.id), root };
}

const unavailable = (f: F) => new KanbanError('PATH_UNAVAILABLE', 'The directory cannot be resolved.', { path: f.projectPath });

describe('task deletion with an unresolvable project context', () => {
  it('deletes a task without a worktree without resolving the base project directory', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'No checkout', description: '' });
    f.git.projectDirectoryFailure = unavailable(f);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(f.sessions.archived).toEqual(task.sessionIds);
    expect(f.git.projectDirectoryCalls).toBe(0);
    expect((await f.app.snapshot()).retainedCheckouts).toBeUndefined();
  });

  it('retains an unverifiable checkout, archives conversations, and projects the retained path', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Moved repo');
    f.git.projectDirectoryFailure = unavailable(f);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(f.sessions.archived).toEqual(task.sessionIds);
    expect(f.git.removed).toEqual([]);
    expect((await f.app.snapshot()).retainedCheckouts).toEqual([{ path: root, projectId: f.project.id, taskTitle: 'Moved repo', reason: 'unresolved' }]);
  });

  it('leaves no retained checkout for a normal worktree deletion', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Normal delete');
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(f.git.removed).toEqual([root]);
    expect((await f.app.snapshot()).retainedCheckouts).toBeUndefined();
  });

  it('keeps the task and the checkout when the directory return fails for another reason', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Return failure');
    f.sessions.setDirectory = async () => { throw new KanbanError('DIRECTORY_SWITCH_FAILED', 'Injected switch failure.'); };
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(task.id);
    expect(failed.worktree?.path).toBe(root);
    expect(failed.operation?.phase).toBe('failed');
    expect(failed.operation?.error?.code).toBe('DIRECTORY_SWITCH_FAILED');
    expect(f.git.removed).toEqual([]);
    expect(f.sessions.archived).toEqual([]);
    expect((await f.app.snapshot()).retainedCheckouts).toBeUndefined();
  });
});
