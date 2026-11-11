import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitAdapter } from '../../src/host/git.js';
import { WorktreeCoordinator } from '../../src/host/worktrees.js';
import { KanbanError } from '../../src/shared/errors.js';
import type { GitPort } from '../../src/shared/ports.js';
import { board, cleanup, fixture, LocalExecutor, MemoryStore, Sessions } from './helpers.js';

/** Every Git call forwarded to the real adapter, with one override. */
function wrap(adapter: GitPort, overrides: Partial<GitPort>): GitPort {
  return {
    resolve: adapter.resolve.bind(adapter), branches: adapter.branches.bind(adapter), inspect: adapter.inspect.bind(adapter),
    localChanges: adapter.localChanges.bind(adapter), assertRemovable: adapter.assertRemovable.bind(adapter),
    create: adapter.create.bind(adapter), remove: adapter.remove.bind(adapter), repair: adapter.repair.bind(adapter),
    assertPolicy: adapter.assertPolicy.bind(adapter), projectDirectory: adapter.projectDirectory.bind(adapter),
    ...overrides,
  };
}

afterEach(cleanup);

async function setup() {
  const f = await fixture();
  const store = new MemoryStore(board(f.project));
  const sessions = new Sessions(f.project.projectPath);
  const executor = new LocalExecutor();
  const adapter = new GitAdapter(executor);
  return { ...f, store, sessions, executor, adapter, coordinator: new WorktreeCoordinator(store, sessions, adapter) };
}

function count(f: { executor: LocalExecutor }, match: (args: string[]) => boolean): number {
  return f.executor.calls.filter(match).length;
}

describe('every removal refusal is decided before archiving can start', () => {
  it('refuses an unregistered checkout without archiving a single conversation', async () => {
    const f = await setup();
    const unregistered = path.join(f.root, 'not-a-worktree');
    await mkdir(unregistered);
    f.store.state.tasks[0]!.worktree = { path: unregistered, branch: 'ghost', owned: true, status: 'ready' };
    f.store.state.tasks[0]!.effectiveCwd = unregistered;
    f.sessions.dirs.set('a', unregistered); f.sessions.dirs.set('b', unregistered);

    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: true })).rejects.toMatchObject({ code: 'WORKTREE_NOT_REGISTERED' });
    expect(f.sessions.archiveCalls).toEqual([]);
    expect(f.store.snapshot().tasks).toHaveLength(1);
  });

  it('refuses a checkout whose binding changed during preparation without archiving', async () => {
    const f = await setup();
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    const replacement = path.join(f.root, 'trees', 'replacement');
    await mkdir(path.dirname(replacement), { recursive: true });
    await mkdir(replacement);
    let calls = 0;
    // The second sharing evaluation runs inside the removal preparation.
    const sharing = { assertExclusive: async () => { calls += 1; if (calls === 2) f.store.state.tasks[0]!.worktree = { path: replacement, branch: 'other', owned: true, status: 'ready' }; } };
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, f.adapter, { sharing: sharing as never });

    await expect(coordinator.request('task', { kind: 'delete', discardChanges: true })).rejects.toMatchObject({ code: 'OPERATION_TARGET_CHANGED' });
    expect(f.sessions.archiveCalls).toEqual([]);
    expect(f.store.snapshot().tasks[0]!.operation?.error?.details).toMatchObject({ failedPhase: 'removing' });
  });

  it('refuses a denied write policy without archiving a single conversation', async () => {
    const f = await setup();
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    f.executor.deny = (_paths, write) => write;
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: true })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' });
    expect(f.sessions.archiveCalls).toEqual([]);
    expect(f.store.snapshot().tasks).toHaveLength(1);
    expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('failed');
  });

  it('never publishes the archiving phase for a worktree-only removal', async () => {
    const f = await setup();
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    const phases: string[] = [];
    const transact = f.store.transact.bind(f.store);
    f.store.transact = async change => { phases.push(f.store.snapshot().tasks[0]?.operation?.phase ?? 'none'); await transact(change); };
    await f.coordinator.request('task', { kind: 'remove', discardChanges: false });
    expect(phases).toContain('removing');
    expect(phases).not.toContain('archiving');
  });
});

describe('one read per decision in the hot paths', () => {
  it('reads local changes once for a clean deletion instead of at every step', async () => {
    const f = await setup();
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    f.executor.calls.length = 0;
    await f.coordinator.request('task', { kind: 'delete', discardChanges: false });
    expect(count(f, args => args.includes('status'))).toBe(1);
    expect(f.store.snapshot().tasks).toEqual([]);
  });

  it('resolves the repository once for a creation instead of per Git call', async () => {
    const f = await setup();
    f.executor.calls.length = 0;
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    const atRoot = (flag: string) => count(f, args => args.includes('-C') && args[1] === f.project.gitRootPath && args.includes(flag));
    expect(atRoot('--show-toplevel')).toBe(1);
    expect(atRoot('--git-common-dir')).toBe(1);
    expect(count(f, args => args.includes('worktree') && args.includes('add'))).toBe(1);
    expect(count(f, args => args.includes('worktree') && args.includes('list'))).toBe(0);
  });

  it('reads conversation idleness per decision: the gate, then one read per later set', async () => {
    const f = await setup();
    let reads = 0;
    const isIdle = f.sessions.isIdle.bind(f.sessions);
    f.sessions.isIdle = async id => { reads += 1; return isIdle(id); };
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    // Two conversations: the drive gate (2), the fresh switch gate (2), and one read
    // before the second conversation moves (1).
    expect(reads).toBe(5);
  });

  it('stops before the first move when a conversation became busy during the creation', async () => {
    const f = await setup();
    const port = wrap(f.adapter, { create: async (...args) => { const tree = await f.adapter.create(...args); f.sessions.active.add('b'); return tree; } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    expect(f.sessions.setCalls).toEqual([]);
    expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('waiting');
    expect(f.store.snapshot().tasks[0]!.effectiveCwd).toBe(f.project.projectPath);
  });
});

describe('a refused deletion keeps its recovery record', () => {
  it('records the refusal as a failed operation, not a command rejection', async () => {
    const f = await setup();
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    await writeFile(path.join(f.tree, 'local.txt'), 'keep');
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: false })).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    const task = f.store.snapshot().tasks[0]!;
    expect(task.operation?.phase).toBe('failed');
    // The local-change refusal belongs to the preflight, which is where the old
    // implementation recorded it too.
    expect(task.operation?.error?.details).toMatchObject({ failedPhase: 'preflight' });
    expect(f.sessions.archiveCalls).toEqual([]);
    expect(f.store.snapshot().notes).toHaveLength(1);
    expect(task.worktree).not.toBeNull();
  });
});
