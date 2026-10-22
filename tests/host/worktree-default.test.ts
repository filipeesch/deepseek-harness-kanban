import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
async function base(f: Awaited<ReturnType<typeof fixture>>) {
  const trees = path.join(f.root, 'trees');
  await mkdir(trees, { recursive: true });
  await f.app.command({ type: 'settings.save', settings: { worktreeBasePath: trees } });
  return trees;
}

describe('worktreeDefault', () => {
  it('derives an accented title with and without a configured base path', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Criação de tarefas', description: '' });
    await expect(f.app.worktreeDefault(task.id)).resolves.toEqual({ branchName: 'criacao-de-tarefas', path: '' });
    const trees = await base(f);
    await expect(f.app.worktreeDefault(task.id)).resolves.toEqual({ branchName: 'criacao-de-tarefas', path: path.join(trees, 'criacao-de-tarefas') });
  });

  it('increments the branch and destination together for a branch collision', async () => {
    const f = await setup();
    const trees = await base(f);
    f.git.branchNames.push('fix-login');
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await expect(f.app.worktreeDefault(task.id)).resolves.toEqual({ branchName: 'fix-login-2', path: path.join(trees, 'fix-login-2') });
  });

  it('increments when the destination already exists on disk', async () => {
    const f = await setup();
    const trees = await base(f);
    await mkdir(path.join(trees, 'fix-login'));
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await expect(f.app.worktreeDefault(task.id)).resolves.toEqual({ branchName: 'fix-login-2', path: path.join(trees, 'fix-login-2') });
  });

  it('treats a dangling symlink destination as occupied', async () => {
    const f = await setup();
    const trees = await base(f);
    await symlink(path.join(trees, 'missing-target'), path.join(trees, 'fix-login'));
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await expect(f.app.worktreeDefault(task.id)).resolves.toEqual({ branchName: 'fix-login-2', path: path.join(trees, 'fix-login-2') });
  });

  it('avoids a destination recorded by another task', async () => {
    const f = await setup();
    const trees = await base(f);
    const first = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await f.store.transact(state => {
      const task = f.store.requireTask(first.id, state);
      task.worktree = { path: path.join(trees, 'fix-login'), branch: 'fix-login', owned: true, status: 'ready' };
      task.effectiveCwd = path.join(trees, 'fix-login');
    });
    const second = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await expect(f.app.worktreeDefault(second.id)).resolves.toEqual({ branchName: 'fix-login-2', path: path.join(trees, 'fix-login-2') });
  });

  it('avoids a destination used by another project and a pending request', async () => {
    const f = await setup();
    const trees = await base(f);
    const otherRoot = path.join(f.root, 'other-repo');
    const otherPath = path.join(otherRoot, 'app');
    await mkdir(otherPath, { recursive: true });
    const other = await f.store.saveProject({ name: 'Other', projectPath: otherPath, gitRootPath: otherRoot });
    const otherTask = await f.app.createTask({ projectId: other.id, title: 'Fix login', description: '' });
    await f.store.transact(state => {
      const task = f.store.requireTask(otherTask.id, state);
      task.worktree = { path: path.join(trees, 'fix-login'), branch: 'fix-login', owned: true, status: 'ready' };
      task.effectiveCwd = path.join(trees, 'fix-login');
    });
    const first = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await expect(f.app.worktreeDefault(first.id)).resolves.toEqual({ branchName: 'fix-login-2', path: path.join(trees, 'fix-login-2') });

    const pending = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await f.store.transact(state => {
      const task = f.store.requireTask(pending.id, state);
      task.pendingTransition = {
        id: 'pending-tree', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'run', status: 'waiting',
        worktreeRequest: { mode: 'new', path: path.join(trees, 'fix-login-2'), branchName: 'fix-login-2', sourceBranch: 'main' },
      };
    });
    const skipped = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await expect(f.app.worktreeDefault(skipped.id)).resolves.toEqual({ branchName: 'fix-login-3', path: path.join(trees, 'fix-login-3') });
  });

  it('reports exhaustion after every numbered candidate is occupied', async () => {
    const f = await setup();
    const trees = await base(f);
    for (let index = 1; index <= 100; index++) await mkdir(path.join(trees, index === 1 ? 'fix-login' : 'fix-login-' + index));
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Fix login', description: '' });
    await expect(f.app.worktreeDefault(task.id)).rejects.toMatchObject({ code: 'WORKTREE_NAME_UNAVAILABLE' });
  });
});
