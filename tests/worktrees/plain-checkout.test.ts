import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorktreeCoordinator } from '../../src/host/worktrees.js';
import type { GitPort, GitTree } from '../../src/shared/ports.js';
import type { CreateWorktree, Project } from '../../src/shared/types.js';
import { KanbanError } from '../../src/shared/errors.js';
import { board, MemoryStore, Sessions } from './helpers.js';

const roots = new Set<string>();
afterEach(async () => {
  const parent = await realpath(tmpdir());
  for (const root of roots) {
    if (path.dirname(root) !== parent || !path.basename(root).startsWith('dsh-kanban-plain-') || await realpath(root) !== root) throw new Error('Unsafe test cleanup path: ' + root);
    await rm(root, { recursive: true, force: true });
    roots.delete(root);
  }
});

function gitTrap(): { port: GitPort; calls: string[] } {
  const calls: string[] = [];
  const order = (name: string) => { calls.push(name); throw new KanbanError('GIT_UNEXPECTED', 'Git must not be called for a plain checkout.'); };
  const port: GitPort = {
    async branches() { return order('branches'); },
    async inspect(): Promise<GitTree> { return order('inspect'); },
    async create(): Promise<GitTree> { return order('create'); },
    async remove(): Promise<void> { return order('remove'); },
    async assertPolicy(): Promise<void> { return order('assertPolicy'); },
    async projectDirectory(): Promise<string> { return order('projectDirectory'); },
  };
  return { port, calls };
}

async function setup() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-kanban-plain-')));
  roots.add(root);
  const projectPath = path.join(root, 'repo', 'apps', 'api');
  const checkout = path.join(root, 'trees', 'feature');
  const nested = path.join(checkout, 'packages', 'api');
  const other = path.join(root, 'trees', 'other');
  await mkdir(nested, { recursive: true });
  await mkdir(other, { recursive: true });
  const project: Project = { id: 'project', name: 'API', projectPath };
  const hub = board(project);
  hub.tasks[0]!.worktree = { path: checkout, branch: 'feature', owned: true, status: 'ready' };
  hub.tasks[0]!.effectiveCwd = nested;
  const store = new MemoryStore(hub);
  const sessions = new Sessions(nested);
  const git = gitTrap();
  const coordinator = new WorktreeCoordinator(store, sessions, git.port, { now: () => '2026-01-01T00:00:00.000Z' });
  return { root, projectPath, checkout, nested, other, hub, project, store, sessions, git, coordinator };
}

describe('plain checkout after Git association removal', () => {
  it('deletes the task, archives conversations, keeps the checkout on disk, and never calls Git', async () => {
    const f = await setup();
    await f.coordinator.request('task', { kind: 'delete', discardChanges: false, expectedWorktreePath: f.checkout });
    const state = f.store.snapshot();
    expect(state.tasks).toHaveLength(0);
    expect(state.notes).toHaveLength(0);
    expect(f.sessions.archiveCalls).toEqual(expect.arrayContaining(['a', 'b']));
    expect(f.git.calls).toEqual([]);
    expect((await stat(f.checkout)).isDirectory()).toBe(true);
    expect((await stat(f.nested)).isDirectory()).toBe(true);
  });

  it('leaves recorded unclaimed checkouts untouched', async () => {
    const f = await setup();
    await f.store.transact(draft => {
      draft.tasks[0]!.unclaimedWorktrees = [{ path: f.other, branch: 'other', error: { code: 'UNCLAIMED_WORKTREE', message: 'Diagnostic only.' } }];
    });
    await f.coordinator.request('task', { kind: 'delete', discardChanges: false, expectedWorktreePath: f.checkout });
    expect((await stat(f.other)).isDirectory()).toBe(true);
    expect(f.git.calls).toEqual([]);
  });

  it('rejects worktree creation before any Git call', async () => {
    const f = await setup();
    const request: CreateWorktree = { mode: 'new', path: path.join(f.root, 'trees', 'next'), branchName: 'next' };
    await expect(f.coordinator.request('task', { kind: 'create', ...request })).rejects.toMatchObject({ code: 'PROJECT_NOT_GIT' });
    expect(f.git.calls).toEqual([]);
  });

  it('rejects attachment before any Git call', async () => {
    const f = await setup();
    await expect(f.coordinator.request('task', { kind: 'attach', path: path.join(f.root, 'trees', 'external') })).rejects.toMatchObject({ code: 'PROJECT_NOT_GIT' });
    expect(f.git.calls).toEqual([]);
  });

  it('rejects removal before any Git call', async () => {
    const f = await setup();
    await expect(f.coordinator.request('task', { kind: 'remove', discardChanges: false, expectedWorktreePath: f.checkout })).rejects.toMatchObject({ code: 'PROJECT_NOT_GIT' });
    expect(f.git.calls).toEqual([]);
  });

  it('rejects returning to base before any Git call', async () => {
    const f = await setup();
    await expect(f.coordinator.request('task', { kind: 'return' })).rejects.toMatchObject({ code: 'PROJECT_NOT_GIT' });
    expect(f.git.calls).toEqual([]);
  });
});
