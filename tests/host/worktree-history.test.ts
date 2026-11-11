import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextOperation, OperationRequest, Task, Worktree } from '../../src/shared/types.js';
import { recordSettledOperation } from '../../src/host/worktree-history.js';
import { fixture } from './helpers.js';

const NOW = '2026-11-11T10:00:00.000Z';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

function operation(request: OperationRequest, targetPath?: string): ContextOperation {
  return {
    id: 'operation', request, phase: 'git', ...(targetPath === undefined ? {} : { targetPath }),
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: true, createdAt: NOW,
  };
}

function taskLike(worktree: Worktree | null): Task {
  return { worktree, history: [] } as unknown as Task;
}

function kinds(task: Task) { return (task.history ?? []).map(entry => (entry.kind === 'worktree' ? entry.action : entry.kind)); }

async function createTask(f: Awaited<ReturnType<typeof fixture>>, title: string) {
  return f.app.createTask({ projectId: f.project.id, title, description: '' });
}

describe('one settled operation, one recorded outcome', () => {
  it('records a created checkout with the branch it was created on', () => {
    const task = taskLike({ path: '/trees/one', branch: 'feat/one', owned: true, status: 'ready' });
    recordSettledOperation(task, operation({ kind: 'create', mode: 'new', path: '/trees/one', branchName: 'feat/one' }, '/trees/one'), NOW);
    expect(task.history).toEqual([{ kind: 'worktree', at: NOW, action: 'created', path: '/trees/one', branch: 'feat/one' }]);
  });

  it('records an attached checkout by its path', () => {
    const task = taskLike({ path: '/trees/two', branch: 'external', owned: false, status: 'ready' });
    recordSettledOperation(task, operation({ kind: 'attach', path: '/trees/two' }, '/trees/two'), NOW);
    expect(task.history).toEqual([{ kind: 'worktree', at: NOW, action: 'attached', path: '/trees/two' }]);
  });

  it('records a removed checkout from the operation target once the binding is gone', () => {
    const task = taskLike(null);
    recordSettledOperation(task, operation({ kind: 'remove', discardChanges: false }, '/trees/three'), NOW);
    expect(task.history).toEqual([{ kind: 'worktree', at: NOW, action: 'removed', path: '/trees/three' }]);
  });

  it('records a failure for any operation kind, naming the checkout it acted on', () => {
    const task = taskLike({ path: '/trees/four', branch: 'feat/four', owned: true, status: 'error' });
    recordSettledOperation(task, operation({ kind: 'create', mode: 'new', path: '/trees/four', branchName: 'feat/four' }, '/trees/four'), NOW, { code: 'PREFLIGHT_FAILED', message: 'The target exists.' });
    expect(task.history).toEqual([{
      kind: 'worktree', at: NOW, action: 'failed', path: '/trees/four',
      error: { code: 'PREFLIGHT_FAILED', message: 'The target exists.' },
    }]);
  });

  it('records nothing for a return to the base project or a completed deletion', () => {
    const returning = taskLike({ path: '/trees/five', branch: 'feat/five', owned: true, status: 'ready' });
    recordSettledOperation(returning, operation({ kind: 'return' }, '/trees/five'), NOW);
    const deleting = taskLike({ path: '/trees/six', branch: 'feat/six', owned: true, status: 'ready' });
    recordSettledOperation(deleting, operation({ kind: 'delete', discardChanges: false }, '/trees/six'), NOW);
    expect(returning.history).toEqual([]);
    expect(deleting.history).toEqual([]);
  });

  it('records nothing when creation settled without a checkout binding', () => {
    const task = taskLike(null);
    recordSettledOperation(task, operation({ kind: 'create', mode: 'new', path: '/trees/seven', branchName: 'feat/seven' }, '/trees/seven'), NOW);
    expect(task.history).toEqual([]);
  });
});

describe('worktree outcomes through the coordinator', () => {
  it('records one entry when a worktree is created, after the creation entry', async () => {
    const f = await setup();
    const task = await createTask(f, 'Created tree');
    const tree = path.join(f.root, 'trees', 'one');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'feat/one', sourceBranch: 'main' });
    const stored = f.store.requireTask(task.id);
    expect(kinds(stored)).toEqual(['created', 'created']);
    expect(stored.history?.[1]).toMatchObject({ kind: 'worktree', action: 'created', path: tree, branch: 'feat/one' });
  });

  it('records one entry when a worktree is removed', async () => {
    const f = await setup();
    const task = await createTask(f, 'Removed tree');
    const tree = path.join(f.root, 'trees', 'removed');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'feat/removed', sourceBranch: 'main' });
    await f.app.command({ type: 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: tree });
    await f.app.worktrees.settle();
    const stored = f.store.requireTask(task.id);
    expect(kinds(stored)).toEqual(['created', 'created', 'removed']);
    expect(stored.history?.[2]).toMatchObject({ kind: 'worktree', action: 'removed', path: tree });
  });

  it('records a failure once and no interim phase, and records nothing for a return', async () => {
    const f = await setup();
    const task = await createTask(f, 'Failed tree');
    const taken = path.join(f.root, 'trees', 'taken');
    await mkdir(taken, { recursive: true });
    await expect(f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: taken, branchName: 'feat/taken', sourceBranch: 'main' }))
      .rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    const failed = f.store.requireTask(task.id);
    expect(kinds(failed)).toEqual(['created', 'failed']);
    expect(failed.history?.[1]).toMatchObject({ kind: 'worktree', action: 'failed', path: taken, error: { code: 'WORKTREE_TARGET_EXISTS' } });

    const ready = await createTask(f, 'Returned tree');
    const tree = path.join(f.root, 'trees', 'returned');
    await f.app.command({ type: 'worktree.create', taskId: ready.id, mode: 'new', path: tree, branchName: 'feat/returned', sourceBranch: 'main' });
    const before = kinds(f.store.requireTask(ready.id));
    await f.app.command({ type: 'operation.return', taskId: ready.id });
    await f.app.worktrees.settle();
    expect(kinds(f.store.requireTask(ready.id))).toEqual(before);
  });
});
