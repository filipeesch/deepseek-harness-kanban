import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { KanbanError } from '../../src/shared/errors.js';
import { fixture, taskWithConversation } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

/** Hold the repository lane at native archiving so a later admission is observably queued. */
async function occupyLane(f: Awaited<ReturnType<typeof setup>>) {
  const blocker = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Lane blocker', description: '' });
  const gate = deferred();
  const archive = f.sessions.archive.bind(f.sessions);
  f.sessions.archive = async (id: string) => { await gate.promise; return archive(id); };
  await f.app.command({ type: 'task.delete', taskId: blocker.id, confirmed: true, expectedWorktreePath: null });
  await expect.poll(() => f.store.requireTask(blocker.id).operation?.phase, { timeout: 5000 }).toBe('archiving');
  return { release: () => { f.sessions.archive = archive; gate.resolve(); } };
}

describe('background worktree creation', () => {
  it('returns after admission and completes the creation from the queue', async () => {
    const f = await setup();
    const lane = await occupyLane(f);
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Queued checkout', description: '' });
    const tree = path.join(f.root, 'trees', 'queued-checkout');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'task/queued', sourceBranch: 'main', background: true });
    expect(f.store.requireTask(task.id).operation?.phase).toBe('queued');
    expect(f.store.requireTask(task.id).worktree).toBeNull();
    lane.release();
    await f.app.worktrees.settle();
    const settled = f.store.requireTask(task.id);
    expect(settled.worktree).toMatchObject({ status: 'ready', branch: 'task/queued' });
    expect(settled.operation).toBeNull();
    expect(f.git.created).toBe(1);
  });

  it('does not hold the command lane while the creation waits for its turn', async () => {
    const f = await setup();
    const lane = await occupyLane(f);
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Unblocked card', description: '' });
    const tree = path.join(f.root, 'trees', 'unblocked');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'task/unblocked', sourceBranch: 'main', background: true });
    // Another card's edit is admitted while the checkout is still queued.
    await f.app.command({ type: 'task.edit', taskId: task.id, title: 'Edited while queued' });
    expect(f.store.requireTask(task.id).title).toBe('Edited while queued');
    expect(f.store.requireTask(task.id).operation?.phase).toBe('queued');
    lane.release();
    await f.app.worktrees.settle();
    expect(f.store.requireTask(task.id).worktree?.status).toBe('ready');
  });

  it('publishes every creation phase through the store journal', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Phased checkout', description: '' });
    const phases: string[] = [];
    const unsubscribe = f.store.subscribe(state => {
      const phase = state.tasks.find(value => value.id === task.id)?.operation?.phase;
      if (phase !== undefined && phases[phases.length - 1] !== phase) phases.push(phase);
    });
    const tree = path.join(f.root, 'trees', 'phased');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'task/phased', sourceBranch: 'main', background: true });
    await f.app.worktrees.settle();
    unsubscribe();
    expect(phases).toEqual(['waiting', 'queued', 'preflight', 'git', 'switching']);
    expect(f.store.requireTask(task.id).worktree?.status).toBe('ready');
  });

  it('rejects the settlement when the admitted creation fails', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Failed checkout', description: '' });
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    f.git.create = async () => { await gate; throw new KanbanError('GIT_FAILED', 'The checkout could not be created.'); };
    const tree = path.join(f.root, 'trees', 'failed');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'task/failed', sourceBranch: 'main', background: true });
    const waiting = f.app.worktrees.whenSettled(task.id);
    release();
    await expect(waiting).rejects.toMatchObject({ code: 'GIT_FAILED' });
    expect(f.store.requireTask(task.id).operation?.phase).toBe('failed');
  });

  it('settles the admitted creation for a caller that waits on it', async () => {
    const f = await setup();
    const lane = await occupyLane(f);
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Awaited checkout', description: '' });
    const tree = path.join(f.root, 'trees', 'awaited');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'task/awaited', sourceBranch: 'main', background: true });
    const waiting = f.app.worktrees.whenSettled(task.id);
    let settled = false; void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    lane.release();
    await waiting;
    expect(f.store.requireTask(task.id).worktree?.status).toBe('ready');
  });
});
