import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitAdapter } from '../../src/host/git.js';
import { WorktreeCoordinator } from '../../src/host/worktrees.js';
import { CheckoutStateProbe } from '../../src/host/worktree-checkout-state.js';
import { CreateAttempt, retryModeFor } from '../../src/host/worktree-create-attempt.js';
import type { GitPort, GitRepository } from '../../src/shared/ports.js';
import type { CheckoutObservation, ContextOperation } from '../../src/shared/types.js';
import { KanbanError } from '../../src/shared/errors.js';
import { board, cleanup, fixture, gitOk, LocalExecutor, MemoryStore, Sessions } from './helpers.js';

afterEach(cleanup);

/** Every Git call forwarded to the real adapter, with explicit overrides. */
function wrap(adapter: GitPort, overrides: Partial<GitPort>): GitPort {
  return {
    resolve: adapter.resolve.bind(adapter), branches: adapter.branches.bind(adapter), inspect: adapter.inspect.bind(adapter),
    sourceCommit: adapter.sourceCommit.bind(adapter), branchTip: adapter.branchTip.bind(adapter), clearRegistration: adapter.clearRegistration.bind(adapter),
    localChanges: adapter.localChanges.bind(adapter), assertRemovable: adapter.assertRemovable.bind(adapter),
    create: adapter.create.bind(adapter), remove: adapter.remove.bind(adapter), repair: adapter.repair.bind(adapter),
    assertPolicy: adapter.assertPolicy.bind(adapter), projectDirectory: adapter.projectDirectory.bind(adapter),
    ...overrides,
  };
}

async function setup() {
  const f = await fixture();
  const executor = new LocalExecutor();
  const adapter = new GitAdapter(executor);
  const store = new MemoryStore(board(f.project));
  const sessions = new Sessions(f.project.projectPath);
  const coordinator = new WorktreeCoordinator(store, sessions, adapter);
  return { ...f, executor, adapter, store, sessions, coordinator };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

function addTask(f: Fixture, id: string): void {
  const base = f.store.state.tasks[0]!;
  f.store.state.tasks.push({ ...structuredClone(base), id, title: id, sessionIds: [id + '-a', id + '-b'], closedSessionIds: [], operation: null, worktree: null, unclaimedWorktrees: undefined });
  f.sessions.dirs.set(id + '-a', base.effectiveCwd); f.sessions.dirs.set(id + '-b', base.effectiveCwd);
}

/** Seed the journal a killed creation leaves: a failed operation that may own a checkout. */
async function seedFailedCreate(f: Fixture, target: string, branchName: string, overrides: { attemptPath?: string; targetPath?: string; observed?: CheckoutObservation; sourceCommit?: string; omitSourceCommit?: boolean } = {}): Promise<void> {
  const commit = overrides.sourceCommit ?? (await gitOk(f.project.gitRootPath, ['rev-parse', 'HEAD'])).trim();
  await f.store.transact(draft => {
    const task = draft.tasks.find(item => item.id === 'task')!;
    task.operation = {
      id: 'seeded', request: { kind: 'create', mode: 'new', path: target, branchName }, phase: 'failed',
      targetPath: overrides.targetPath ?? target,
      previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: new Date().toISOString(),
      createAttempt: {
        operationId: 'seeded', path: overrides.attemptPath ?? target, gitRootPath: f.project.gitRootPath, branchName, mode: 'new', absentBefore: true,
        ...(overrides.omitSourceCommit === true ? {} : { sourceCommit: commit }), ...(overrides.observed === undefined ? {} : { observed: overrides.observed }),
      },
      error: { code: 'GIT_TIMEOUT', message: 'The Git operation exceeded its execution deadline.', details: { failedPhase: 'git', gitAttempted: true } },
    };
  });
}

function observation(directory: CheckoutObservation['directory'], registration: CheckoutObservation['registration'], parentCandidates: string[] = []): CheckoutObservation {
  return { directory, registration, at: new Date().toISOString(), parentCandidates };
}

describe('checkout state probe', () => {
  it('exposes an orphan registration instead of dropping it from worktree list', async () => {
    const f = await setup();
    await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'stale' }, []);
    await rm(f.tree, { recursive: true, force: true });
    const repository = await f.adapter.resolve(f.project, []);
    expect(await repository.registered()).toContainEqual({ path: f.tree, locked: false, prunable: true });
    expect(await new CheckoutStateProbe().probe(repository, f.tree)).toMatchObject({ directory: 'absent', registration: 'orphan' });
  });

  it('reads the directory and the registration as separate facts', async () => {
    const f = await setup();
    const probe = new CheckoutStateProbe();
    const repository = await f.adapter.resolve(f.project, []);
    const absent = path.join(f.root, 'trees', 'absent');
    expect(await probe.probe(repository, absent)).toMatchObject({ directory: 'absent', registration: 'none' });
    await mkdir(absent, { recursive: true });
    expect(await probe.probe(repository, absent)).toMatchObject({ directory: 'empty', registration: 'none' });
    const present = path.join(f.root, 'trees', 'present');
    await mkdir(present, { recursive: true }); await writeFile(path.join(present, 'file.txt'), 'x');
    expect(await probe.probe(repository, present)).toMatchObject({ directory: 'present', registration: 'none' });
    await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []);
    repository.invalidate();
    expect(await probe.probe(repository, f.tree)).toMatchObject({ directory: 'present', registration: 'registered' });
  });

  it('reports a present directory that also carries an orphan registration', async () => {
    const f = await setup();
    const target = path.join(f.root, 'trees', 'mixed');
    await mkdir(target, { recursive: true }); await writeFile(path.join(target, 'file.txt'), 'x');
    const repository: GitRepository = {
      project: f.project, root: f.project.gitRootPath, projectPath: f.project.projectPath,
      commonDirectory: path.join(f.project.gitRootPath, '.git'),
      registered: async () => [{ path: target, locked: false, prunable: true }],
      invalidate() {},
    };
    expect(await new CheckoutStateProbe().probe(repository, target)).toMatchObject({ directory: 'present', registration: 'orphan' });
  });
});

describe('create attempt', () => {
  const operation = (attempt: ContextOperation['createAttempt']): ContextOperation => ({
    id: 'op', request: { kind: 'create', mode: 'new', path: '/trees/a', branchName: 'a' }, phase: 'failed', targetPath: '/trees/a',
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now', createAttempt: attempt,
  });

  it('proves a branch tip only against the commit the attempt recorded', () => {
    expect(retryModeFor(undefined, 'abc')).toBe('create');
    expect(retryModeFor('abc', 'abc')).toBe('reuse');
    expect(retryModeFor('def', 'abc')).toBe('blocked');
  });

  it('exposes the predicates over a recorded attempt', () => {
    const recorded = new CreateAttempt(operation({ operationId: 'op', path: '/trees/a', gitRootPath: '/repo', branchName: 'a', mode: 'new', absentBefore: true, sourceCommit: 'abc' }), {
      operationId: 'op', path: '/trees/a', gitRootPath: '/repo', branchName: 'a', mode: 'new', absentBefore: true, sourceCommit: 'abc',
    });
    expect(recorded.commitProven('abc', 'abc')).toBe(true);
    expect(recorded.commitProven('def', 'abc')).toBe(false);
    expect(recorded.retryMode('abc', 'abc')).toBe('reuse');
    expect(recorded.retryMode('def', 'abc')).toBe('blocked');
  });
});

describe('creation recovery', () => {
  it('gives checkout commands the long deadline and keeps ref reads short', async () => {
    const f = await setup();
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    const addIndex = f.executor.calls.findIndex(args => args.includes('worktree') && args.includes('add'));
    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(f.executor.deadlines[addIndex]).toBe('write');
    const branchIndex = f.executor.calls.findIndex(args => args.includes('branch') && args.includes('--show-current'));
    expect(f.executor.deadlines[branchIndex]).toBe('tree');
    const refIndex = f.executor.calls.findIndex(args => args.includes('rev-parse') && args.includes('--git-common-dir'));
    expect(f.executor.deadlines[refIndex] ?? 'read').toBe('read');
  });

  it('records what a failed write left and revalidates before the next action', async () => {
    const f = await setup();
    let injected = true;
    const port = wrap(f.adapter, {
      create: async (...args) => {
        if (injected) {
          injected = false;
          const request = args[1] as { path: string };
          args[5]?.beforeWrite?.();
          await mkdir(request.path, { recursive: true });
          await writeFile(path.join(request.path, 'partial.txt'), 'x');
          throw new KanbanError('GIT_TIMEOUT', 'The Git operation exceeded its execution deadline.');
        }
        return f.adapter.create(...args);
      },
    });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'GIT_TIMEOUT' });
    const failed = f.store.snapshot().tasks[0]!;
    expect(failed.operation!.createAttempt!.observed).toMatchObject({ directory: 'present', registration: 'none' });
    expect(failed.operation!.error?.details).toMatchObject({ failedPhase: 'git', gitAttempted: true });
    await rm(f.tree, { recursive: true, force: true });
    await coordinator.retry('task');
    const recovered = f.store.snapshot().tasks[0]!;
    expect(recovered.worktree).toMatchObject({ path: f.tree, branch: 'feature', status: 'ready' });
    expect(recovered.operation).toBeNull();
  });

  it('disarms a failure that left nothing and frees return', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    expect(f.store.snapshot().tasks[0]!.operation!.createAttempt).toBeUndefined();
    await f.coordinator.returnToBase('task');
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull();
    expect(await f.sessions.directory('a')).toBe(f.project.projectPath);
  });

  it('disarms a failure that left nothing and frees deletion', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    await f.coordinator.request('task', { kind: 'delete', discardChanges: false, expectedWorktreePath: null });
    await f.coordinator.settle();
    expect(f.store.snapshot().tasks).toEqual([]);
  });

  it('retries into a destination that exists but is empty', async () => {
    const f = await setup();
    await mkdir(f.tree, { recursive: true });
    await seedFailedCreate(f, f.tree, 'feature', { observed: observation('empty', 'none') });
    await f.coordinator.retry('task');
    const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toMatchObject({ path: f.tree, branch: 'feature', status: 'ready' });
    expect(task.operation).toBeNull();
  });

  it('records that the retry reused the branch', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    let reused: boolean | undefined;
    const port = wrap(f.adapter, { create: async (...args) => { reused = f.store.snapshot().tasks[0]!.operation?.createAttempt?.reusedBranch; return f.adapter.create(...args); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    await coordinator.retry('task');
    expect(reused).toBe(true);
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull();
  });

  it('heals a journal whose destination vanished before this behavior existed', async () => {
    const f = await setup();
    await seedFailedCreate(f, path.join(f.root, 'trees', 'gone'), 'gone', { observed: observation('present', 'none') });
    await f.coordinator.retry('task');
    const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toMatchObject({ branch: 'gone', status: 'ready' });
    expect(task.operation).toBeNull();
  });

  it('clears only the registration whose directory is gone', async () => {
    const f = await setup();
    const other = path.join(f.root, 'trees', 'other');
    await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'ours' }, []);
    await f.adapter.create(f.project, { mode: 'new', path: other, branchName: 'other' }, []);
    await rm(f.tree, { recursive: true, force: true }); await rm(other, { recursive: true, force: true });
    await seedFailedCreate(f, f.tree, 'ours', { observed: observation('absent', 'orphan') });
    await f.coordinator.returnToBase('task');
    const entries = await (await f.adapter.resolve(f.project, [])).registered();
    expect(entries.some(entry => entry.path === other && entry.prunable)).toBe(true);
    expect(entries.some(entry => entry.path === f.tree)).toBe(false);
  });

  it('reuses the branch a failed attempt left when its tip still matches', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    await f.coordinator.retry('task');
    expect(f.store.snapshot().tasks[0]!.worktree).toMatchObject({ path: f.tree, branch: 'feature', status: 'ready' });
  });

  it('resolves a legacy attempt once and reuses the branch that still matches', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    await seedFailedCreate(f, f.tree, 'feature', { observed: observation('absent', 'none'), omitSourceCommit: true });
    await f.coordinator.retry('task');
    expect(f.store.snapshot().tasks[0]!.worktree).toMatchObject({ path: f.tree, branch: 'feature', status: 'ready' });
  });

  it('refuses to reuse a branch whose tip moved', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    await gitOk(f.project.gitRootPath, ['commit', '--allow-empty', '-m', 'advance']);
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    await expect(f.coordinator.retry('task')).rejects.toMatchObject({ code: 'CREATE_BRANCH_CHANGED' });
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull();
  });

  it('discards an incomplete checkout and retries in one accepted action', async () => {
    const f = await setup();
    f.store.basePath = path.join(f.root, 'trees');
    const target = path.join(f.store.basePath, 'deep', 'level', 'feature');
    await mkdir(target, { recursive: true }); await writeFile(path.join(target, 'partial.txt'), 'x');
    await seedFailedCreate(f, target, 'feature', { observed: observation('present', 'none', [path.dirname(target), path.dirname(path.dirname(target))]) });
    await f.coordinator.discardCreate('task', true);
    const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toMatchObject({ path: target, status: 'ready' });
    expect(task.operation).toBeNull();
    expect((await stat(f.store.basePath)).isDirectory()).toBe(true);
  });

  it('removes the empty parents up to, but never including, the configured base', async () => {
    const f = await setup();
    f.store.basePath = path.join(f.root, 'trees');
    const target = path.join(f.store.basePath, 'deep', 'level', 'feature');
    await mkdir(target, { recursive: true }); await writeFile(path.join(target, 'partial.txt'), 'x');
    await seedFailedCreate(f, target, 'feature', { observed: observation('present', 'none', [path.dirname(target), path.dirname(path.dirname(target))]) });
    f.executor.fail = args => args.includes('worktree') && args.includes('add') ? { exitCode: 1, stdout: '', stderr: 'injected' } : undefined;
    await expect(f.coordinator.discardCreate('task', true)).rejects.toMatchObject({ code: 'GIT_FAILED' });
    await expect(lstat(path.join(f.store.basePath, 'deep'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(f.store.basePath)).isDirectory()).toBe(true);
  });

  it('refuses an unconfirmed discard and touches nothing', async () => {
    const f = await setup();
    await mkdir(f.tree, { recursive: true }); await writeFile(path.join(f.tree, 'partial.txt'), 'x');
    await seedFailedCreate(f, f.tree, 'feature', { observed: observation('present', 'none') });
    await expect(f.coordinator.discardCreate('task', false)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('refuses to discard a registered checkout, the configured base, or an unverifiable attempt', async () => {
    const registered = await setup();
    await registered.adapter.create(registered.project, { mode: 'new', path: registered.tree, branchName: 'feature' }, []);
    await seedFailedCreate(registered, registered.tree, 'feature', { observed: observation('present', 'registered') });
    await expect(registered.coordinator.discardCreate('task', true)).rejects.toMatchObject({ code: 'CREATE_CHECKOUT_REGISTERED' });

    const base = await setup();
    base.store.basePath = base.tree;
    await seedFailedCreate(base, base.tree, 'feature', { observed: observation('present', 'none') });
    await expect(base.coordinator.discardCreate('task', true)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE_TARGET' });

    const unverified = await setup();
    await mkdir(unverified.tree, { recursive: true });
    await seedFailedCreate(unverified, unverified.tree, 'feature', { attemptPath: path.join(unverified.root, 'other'), observed: observation('present', 'none') });
    await expect(unverified.coordinator.discardCreate('task', true)).rejects.toMatchObject({ code: 'CREATE_RECOVERY_UNVERIFIED' });
  });
});

describe('cancellation', () => {
  it('cancels only the running operation and keeps its recovery available', async () => {
    const f = await setup();
    addTask(f, 'task2');
    const other = path.join(f.root, 'trees', 'other');
    let held = false;
    f.executor.gate = async (args, signal) => {
      if (!(args.includes('worktree') && args.includes('add')) || !args.includes(f.tree)) return;
      held = true;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new KanbanError('OPERATION_CANCELLED', 'The Git operation was cancelled.')), { once: true });
      });
    };
    const first = f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    const rejection = expect(first).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    await vi.waitFor(() => expect(held).toBe(true));
    await expect(f.coordinator.request('task2', { kind: 'create', mode: 'new', path: other, branchName: 'other' })).resolves.toBeDefined();
    await f.coordinator.cancel('task');
    await rejection;
    const failed = f.store.snapshot().tasks.find(task => task.id === 'task')!;
    expect(failed.operation!.phase).toBe('failed');
    expect(failed.operation!.error?.code).toBe('OPERATION_CANCELLED');
    expect(failed.operation!.createAttempt).toBeUndefined();
    stderrGateReset(f);
    await f.coordinator.retry('task');
    expect(f.store.snapshot().tasks.find(task => task.id === 'task')!.worktree).toMatchObject({ status: 'ready' });
  });

  it('refuses to cancel a task with no operation', async () => {
    const f = await setup();
    await expect(f.coordinator.cancel('task')).rejects.toMatchObject({ code: 'NO_OPERATION' });
  });

  it('refuses to cancel when no pass holds the operation', async () => {
    const f = await setup();
    await seedFailedCreate(f, f.tree, 'feature', { observed: observation('present', 'none') });
    await expect(f.coordinator.cancel('task')).rejects.toMatchObject({ code: 'NO_RUNNING_OPERATION' });
  });
});

function stderrGateReset(f: Fixture): void { f.executor.gate = undefined; }
