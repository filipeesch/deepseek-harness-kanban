import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitAdapter } from '../../src/host/git.js';
import { WorktreeCoordinator } from '../../src/host/worktrees.js';
import type { GitPort } from '../../src/shared/ports.js';
import { KanbanError } from '../../src/shared/errors.js';
import { board, cleanup, fixture, git, gitOk, LocalExecutor, MemoryStore, Sessions } from './helpers.js';

afterEach(cleanup);
function wrapped(adapter: GitPort, overrides: Partial<GitPort>): GitPort {
  return { branches: adapter.branches.bind(adapter), inspect: adapter.inspect.bind(adapter), create: adapter.create.bind(adapter), remove: adapter.remove.bind(adapter), assertPolicy: adapter.assertPolicy.bind(adapter), projectDirectory: adapter.projectDirectory.bind(adapter), discover: adapter.discover.bind(adapter), ...overrides };
}
async function setup() {
  const f = await fixture(); const executor = new LocalExecutor(); const adapter = new GitAdapter(executor);
  const store = new MemoryStore(board(f.project)); const sessions = new Sessions(f.project.projectPath);
  return { ...f, executor, adapter, store, sessions, coordinator: new WorktreeCoordinator(store, sessions, adapter) };
}
async function create(f: Awaited<ReturnType<typeof setup>>) { await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' }); }
function adds(executor: LocalExecutor): number { return executor.calls.filter(args => args.includes('worktree') && args.includes('add')).length; }

describe('WorktreeCoordinator', () => {
  it('persists waiting, returns immediately, and resumes only when ALL sessions are idle', async () => {
    const f = await setup(); f.sessions.active.add('b'); f.store.state.tasks[0]!.closedSessionIds = ['b'];
    const waiting = await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    expect(waiting.tasks[0]!.operation?.phase).toBe('waiting'); expect(adds(f.executor)).toBe(0); expect(f.sessions.setCalls).toEqual([]);
    await f.coordinator.resumePending(); expect(adds(f.executor)).toBe(0);
    f.sessions.active.clear(); await f.coordinator.resumePending();
    const task = f.store.snapshot().tasks[0]!;
    expect(task.operation).toBeNull(); expect(task.worktree?.status).toBe('ready');
    expect(task.effectiveCwd).toBe(path.join(f.tree, 'packages/api'));
    expect([...f.sessions.dirs.values()]).toEqual([task.effectiveCwd, task.effectiveCwd]); expect(adds(f.executor)).toBe(1);
  });

  it('journals a partial directory failure and retries without recreating Git resources', async () => {
    const f = await setup(); let fail = true;
    f.sessions.beforeSet = id => { if (id === 'b' && fail) throw new KanbanError('INJECTED_SET', 'Injected directory failure.'); };
    await expect(create(f)).rejects.toMatchObject({ code: 'INJECTED_SET' });
    const failed = f.store.snapshot().tasks[0]!; const operationId = failed.operation!.id;
    expect(failed.effectiveCwd).toBe(f.project.projectPath); expect(failed.operation!.phase).toBe('failed'); expect(failed.operation!.switchedSessionIds).toEqual(['a']);
    expect(failed.operation!.previousDirectories).toEqual({ a: f.project.projectPath, b: f.project.projectPath });
    expect(failed.operation!.gitCompleted).toBe(true); expect(await f.sessions.directory('a')).toBe(path.join(f.tree, 'packages/api'));
    fail = false; await f.coordinator.retry('task');
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull(); expect(adds(f.executor)).toBe(1);
    expect(f.sessions.setCalls.filter(call => call.id === 'a')).toHaveLength(1); expect(operationId).toBeTruthy();
  });

  it('rechecks every participant before each directory set when another native session wakes', async () => {
    const f = await setup(); f.sessions.beforeSet = id => { if (id === 'a') f.sessions.active.add('b'); };
    await create(f);
    expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('waiting');
    expect(await f.sessions.directory('a')).toBe(path.join(f.tree, 'packages/api')); expect(await f.sessions.directory('b')).toBe(f.project.projectPath);
    expect(f.store.snapshot().tasks[0]!.effectiveCwd).toBe(f.project.projectPath);
    f.sessions.beforeSet = undefined; f.sessions.active.clear(); await f.coordinator.resumePending();
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull(); expect(adds(f.executor)).toBe(1);
  });

  it('recovers a completed-but-unacknowledged Git create rather than creating the branch again', async () => {
    const f = await setup(); let creates = 0;
    const port = wrapped(f.adapter, { create: async (...args) => { creates++; await f.adapter.create(...args); throw new KanbanError('AFTER_GIT', 'Injected crash after Git success.'); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    expect(f.store.snapshot().tasks[0]!.operation!.gitCompleted).toBe(false);
    await coordinator.retry('task');
    expect(creates).toBe(1); expect(f.store.snapshot().tasks[0]!.operation).toBeNull();
    expect(f.store.snapshot().tasks[0]!.worktree?.branch).toBe('feature');
  });

  it('preserves Git recovery markers while a restored operation waits on activity', async () => {
    const f = await setup();
    const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); throw new Error('Crash'); } });
    const first = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(first.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toThrow('Crash');
    f.store.state.tasks[0]!.operation!.phase = 'git'; delete f.store.state.tasks[0]!.operation!.error;
    first.dispose(); await first.settle(); f.sessions.active.add('b');
    const next = new WorktreeCoordinator(f.store, f.sessions, f.adapter);
    await next.resumePending(); expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('waiting');
    f.sessions.active.clear(); await next.resumePending();
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull(); expect(adds(f.executor)).toBe(1);
  });

  it('surfaces a policy denial without pretending directory changes grant access', async () => {
    const f = await setup(); const target = path.join(f.tree, 'packages/api');
    f.executor.deny = (paths, write) => write && paths.includes(target);
    await expect(create(f)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' });
    expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('failed'); expect(f.sessions.setCalls).toEqual([]);
    expect(f.store.snapshot().tasks[0]!.effectiveCwd).toBe(f.project.projectPath);
    f.executor.deny = undefined; await f.coordinator.retry('task'); expect(adds(f.executor)).toBe(1);
  });

  it('returns every retained conversation to base before worktree-only removal', async () => {
    const f = await setup(); await create(f); let removals = 0;
    const port = wrapped(f.adapter, { remove: async (...args) => { removals++; expect([...f.sessions.dirs.values()]).toEqual([f.project.projectPath, f.project.projectPath]); await f.adapter.remove(...args); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await coordinator.request('task', { kind: 'remove', discardChanges: false });
    const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toBeNull(); expect(task.operation).toBeNull(); expect(task.effectiveCwd).toBe(f.project.projectPath);
    expect(f.store.snapshot().notes).toHaveLength(1); expect(f.sessions.archiveCalls).toEqual([]); expect(removals).toBe(1);
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', 'refs/heads/feature'])).exitCode).toBe(0);
  });

  it('returns chats before deleting a tree, archives native chats, then removes task-owned data', async () => {
    const f = await setup(); await create(f);
    f.sessions.beforeArchive = async id => { expect(await f.sessions.directory(id)).toBe(f.project.projectPath); await expect(stat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' }); };
    await f.coordinator.request('task', { kind: 'delete', discardChanges: false });
    expect(f.store.snapshot().tasks).toEqual([]); expect(f.store.snapshot().notes).toEqual([]); expect(f.sessions.archiveCalls).toEqual(['a', 'b']);
    expect([...f.sessions.dirs.values()]).toEqual([f.project.projectPath, f.project.projectPath]);
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', 'refs/heads/feature'])).exitCode).toBe(0);
  });

  it('keeps the checkout and recovery record when returning a retained chat fails', async () => {
    const f = await setup(); await create(f); let fail = true;
    f.sessions.beforeSet = (id, target) => { if (id === 'b' && target === f.project.projectPath && fail) throw new KanbanError('RETURN_FAILED', 'Cannot return session.'); };
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: false })).rejects.toMatchObject({ code: 'RETURN_FAILED' });
    expect((await stat(f.tree)).isDirectory()).toBe(true); expect(f.sessions.archiveCalls).toEqual([]); expect(f.store.snapshot().notes).toHaveLength(1);
    expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('failed');
    fail = false; await f.coordinator.retry('task'); expect(f.store.snapshot().tasks).toEqual([]);
  });

  it('upgrades the same failed dirty-deletion request without losing its journal', async () => {
    const f = await setup(); await create(f); await writeFile(path.join(f.tree, 'untracked.txt'), 'local');
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: false })).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    const originalId = f.store.snapshot().tasks[0]!.operation!.id;
    expect([...f.sessions.dirs.values()]).toEqual([path.join(f.tree, 'packages/api'), path.join(f.tree, 'packages/api')]);
    f.sessions.active.add('b');
    const waiting = await f.coordinator.request('task', { kind: 'delete', discardChanges: true });
    expect(waiting.tasks[0]!.operation!.id).toBe(originalId); expect(waiting.tasks[0]!.operation!.request).toEqual({ kind: 'delete', discardChanges: true });
    f.sessions.active.clear(); await f.coordinator.resumePending(); expect(f.store.snapshot().tasks).toEqual([]);
  });

  it('does not replace an unrelated failed operation without explicit recovery', async () => {
    const f = await setup(); f.sessions.beforeSet = () => { throw new Error('Set failed'); };
    await expect(create(f)).rejects.toThrow('Set failed'); const id = f.store.snapshot().tasks[0]!.operation!.id;
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: true })).rejects.toMatchObject({ code: 'OPERATION_PENDING' });
    expect(f.store.snapshot().tasks[0]!.operation!.id).toBe(id);
    f.sessions.beforeSet = undefined; await f.coordinator.returnToBase('task');
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull(); expect((await stat(f.tree)).isDirectory()).toBe(true);
    expect([...f.sessions.dirs.values()]).toEqual([f.project.projectPath, f.project.projectPath]);
  });

  it('protects worktrees shared by another native session', async () => {
    const f = await setup(); await create(f); f.sessions.dirs.set('outside', path.join(f.tree, 'packages/api'));
    await expect(f.coordinator.request('task', { kind: 'remove', discardChanges: true })).rejects.toMatchObject({ code: 'SHARED_WORKTREE' });
    expect((await stat(f.tree)).isDirectory()).toBe(true); expect(f.sessions.archiveCalls).toEqual([]);
    f.sessions.dirs.set('outside', f.project.projectPath); await f.coordinator.retry('task');
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull();
  });

  it('protects canonical aliases shared by another task', async () => {
    const f = await setup(); await create(f); const alias = path.join(f.root, 'tree-alias'); await symlink(f.tree, alias);
    f.store.state.tasks.push({ ...structuredClone(f.store.state.tasks[0]!), id: 'other', sessionIds: [], worktree: { ...f.store.state.tasks[0]!.worktree!, path: alias } });
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: true })).rejects.toMatchObject({ code: 'SHARED_WORKTREE' });
    expect(f.store.snapshot().tasks).toHaveLength(2); expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('deletes a task without a worktree without deleting base project or Git root', async () => {
    const f = await setup(); await f.coordinator.request('task', { kind: 'delete', discardChanges: false });
    expect(f.store.snapshot().tasks).toEqual([]); expect(f.sessions.archiveCalls).toEqual(['a', 'b']);
    expect((await stat(f.project.projectPath)).isDirectory()).toBe(true); expect((await stat(f.project.gitRootPath)).isDirectory()).toBe(true);
    expect(f.executor.calls.some(args => args.includes('remove'))).toBe(false);
  });

  it('retries partially completed native archives without repeating Git removal or prior archives', async () => {
    const f = await setup(); await create(f); let fail = true;
    f.sessions.beforeArchive = id => { if (id === 'b' && fail) throw new KanbanError('ARCHIVE_FAILED', 'Native archive failed.'); };
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: false })).rejects.toMatchObject({ code: 'ARCHIVE_FAILED' });
    const pending = f.store.snapshot().tasks[0]!;
    expect(pending.worktree).toBeNull(); expect(pending.operation!.gitCompleted).toBe(true); expect(pending.operation!.archivedSessionIds).toEqual(['a']); expect(f.store.snapshot().notes).toHaveLength(1);
    await expect(f.coordinator.returnToBase('task')).rejects.toMatchObject({ code: 'DELETE_IN_PROGRESS' });
    fail = false; await f.coordinator.request('task', { kind: 'delete', discardChanges: true });
    expect(f.sessions.archiveCalls).toEqual(['a', 'b']); expect(f.executor.calls.filter(args => args.includes('remove'))).toHaveLength(1); expect(f.store.snapshot().tasks).toEqual([]);
  });

  it('detects participant changes instead of publishing a false shared-directory success', async () => {
    const f = await setup(); let added = false;
    f.sessions.beforeSet = id => { if (id === 'a' && !added) { added = true; f.store.state.tasks[0]!.sessionIds.push('c'); f.sessions.dirs.set('c', f.project.projectPath); } };
    await expect(create(f)).rejects.toMatchObject({ code: 'CONTEXT_DIVERGED' });
    expect(f.store.snapshot().tasks[0]!.effectiveCwd).toBe(f.project.projectPath);
    f.sessions.beforeSet = undefined; await f.coordinator.retry('task'); expect(await f.sessions.directory('c')).toBe(path.join(f.tree, 'packages/api'));
  });

  it('aborts and settles on disposal without touching the remaining conversation', async () => {
    const f = await setup(); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    f.sessions.beforeSet = async (_id, _directory, signal) => { entered(); await new Promise<void>((_resolve, reject) => { signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }); }); };
    const request = create(f); const rejection = expect(request).rejects.toBeDefined(); await ready;
    f.coordinator.dispose(); await rejection; await f.coordinator.settle();
    expect(f.sessions.setCalls).toHaveLength(1); expect((await stat(f.tree)).isDirectory()).toBe(true);
    await expect(f.coordinator.retry('task')).rejects.toMatchObject({ code: 'COORDINATOR_DISPOSED' });
    expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('failed');
  });
  it('attaches an existing tree without recreating it and preserves the project subdirectory', async () => {
    const f = await setup(); await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'external' }, []);
    await f.coordinator.request('task', { kind: 'attach', path: f.tree });
    const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree?.owned).toBe(false); expect(task.worktree?.branch).toBe('external');
    expect(task.effectiveCwd).toBe(path.join(f.tree, 'packages/api')); expect(adds(f.executor)).toBe(1);
  });

  it('uses an existing branch through the same coordinator flow', async () => {
    const f = await setup(); await git(f.project.gitRootPath, ['branch', 'existing']);
    await f.coordinator.request('task', { kind: 'create', mode: 'existing', path: f.tree, branchName: 'existing' });
    expect(f.store.snapshot().tasks[0]!.worktree?.branch).toBe('existing');
    expect([...f.sessions.dirs.values()]).toEqual([path.join(f.tree, 'packages/api'), path.join(f.tree, 'packages/api')]);
  });

  it('rejects a rebound target rather than applying prior discard consent to another checkout', async () => {
    const f = await setup(); await create(f); await writeFile(path.join(f.tree, 'local.txt'), 'keep');
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: false })).rejects.toMatchObject({ code: 'DISCARD_REQUIRED' });
    const replacement = path.join(f.root, 'trees', 'other');
    await f.adapter.create(f.project, { mode: 'new', path: replacement, branchName: 'other' }, []);
    f.store.state.tasks[0]!.worktree!.path = replacement;
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: true })).rejects.toMatchObject({ code: 'OPERATION_TARGET_CHANGED' });
    expect((await stat(f.tree)).isDirectory()).toBe(true); expect((await stat(replacement)).isDirectory()).toBe(true); expect(f.sessions.archiveCalls).toEqual([]);
  });

  it('rechecks shared native targets after journaling the removal phase', async () => {
    const f = await setup(); await create(f); const transact = f.store.transact.bind(f.store); let injected = false;
    f.store.transact = async change => { await transact(change); if (f.store.snapshot().tasks[0]?.operation?.phase === 'removing' && !injected) { injected = true; f.sessions.dirs.set('late-user', path.join(f.tree, 'packages/api')); } };
    await expect(f.coordinator.request('task', { kind: 'remove', discardChanges: true })).rejects.toMatchObject({ code: 'SHARED_WORKTREE' });
    expect((await stat(f.tree)).isDirectory()).toBe(true); expect(f.executor.calls.some(args => args.includes('remove'))).toBe(false);
  });

  it('persists a requested return while busy without later performing the cancelled create', async () => {
    const f = await setup(); f.sessions.active.add('b'); await create(f);
    const waiting = await f.coordinator.returnToBase('task'); expect(waiting.tasks[0]!.operation?.request.kind).toBe('return'); expect(waiting.tasks[0]!.operation?.phase).toBe('waiting');
    f.sessions.active.clear(); await f.coordinator.resumePending();
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull(); expect(adds(f.executor)).toBe(0);
  });

  it('retains task metadata when final cleanup persistence fails after native archives', async () => {
    const f = await setup(); await create(f); const transact = f.store.transact.bind(f.store); let fail = true;
    f.store.transact = change => transact(draft => { change(draft); if (draft.tasks.length === 0 && fail) { fail = false; throw new KanbanError('STORAGE_FAILED', 'Injected final write failure.'); } });
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: false })).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    const pending = f.store.snapshot().tasks[0]!; expect(pending.operation?.archivedSessionIds).toEqual(['a', 'b']); expect(f.store.snapshot().notes).toHaveLength(1);
    await f.coordinator.retry('task'); expect(f.store.snapshot().tasks).toEqual([]); expect(f.sessions.archiveCalls).toEqual(['a', 'b']);
    expect(f.executor.calls.filter(args => args.includes('remove'))).toHaveLength(1);
  });

  it('detects source project changes before publishing an old directory as the new context', async () => {
    const f = await setup(); const port = wrapped(f.adapter, { create: async (...args) => { const tree = await f.adapter.create(...args); f.store.state.projects[0]!.projectPath = path.join(f.project.gitRootPath, 'other-project'); return tree; } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_CHANGED' });
    expect(f.sessions.setCalls).toEqual([]); expect(f.store.snapshot().tasks[0]!.effectiveCwd).toBe(f.project.projectPath);
    expect((await stat(f.tree)).isDirectory()).toBe(true); expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('failed');
  });

  it('rejects a stale primary confirmation without recording an operation or touching either checkout', async () => {
    const f = await setup(); await create(f); const confirmed = f.tree; const replacement = path.join(f.root, 'trees', 'replacement');
    await f.adapter.create(f.project, { mode: 'new', path: replacement, branchName: 'replacement' }, []);
    f.store.state.tasks[0]!.worktree = { path: replacement, branch: 'replacement', owned: true, status: 'ready' };
    f.store.state.tasks[0]!.effectiveCwd = path.join(replacement, 'packages/api');
    f.sessions.dirs.set('a', path.join(replacement, 'packages/api')); f.sessions.dirs.set('b', path.join(replacement, 'packages/api'));
    const before = f.store.snapshot(); const sets = f.sessions.setCalls.length;
    await expect(f.coordinator.request('task', { kind: 'delete', discardChanges: true, expectedWorktreePath: confirmed })).rejects.toMatchObject({ code: 'WORKTREE_CHANGED' });
    expect(f.store.snapshot()).toEqual(before); expect(f.sessions.setCalls).toHaveLength(sets); expect(f.sessions.archiveCalls).toEqual([]);
    expect((await stat(confirmed)).isDirectory()).toBe(true); expect((await stat(replacement)).isDirectory()).toBe(true);
    expect(f.executor.calls.some(args => args.includes('remove'))).toBe(false);
  });

  it('checks a queued null confirmation after an earlier create binds a new tree', async () => {
    const f = await setup(); const creating = create(f);
    const staleDelete = f.coordinator.request('task', { kind: 'delete', discardChanges: true, expectedWorktreePath: null });
    const rejection = expect(staleDelete).rejects.toMatchObject({ code: 'WORKTREE_CHANGED' });
    await creating; await rejection;
    const task = f.store.snapshot().tasks[0]!;
    expect(task.operation).toBeNull(); expect(task.worktree?.path).toBe(f.tree); expect(f.store.snapshot().notes).toHaveLength(1);
    expect((await stat(f.tree)).isDirectory()).toBe(true); expect(f.sessions.archiveCalls).toEqual([]);
  });

  it('accepts a current canonical confirmation and null when no tree is bound', async () => {
    const f = await setup(); await create(f);
    await f.coordinator.request('task', { kind: 'remove', discardChanges: false, expectedWorktreePath: f.tree });
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull();
    await f.coordinator.request('task', { kind: 'delete', discardChanges: false, expectedWorktreePath: null });
    expect(f.store.snapshot().tasks).toEqual([]); expect(f.sessions.archiveCalls).toEqual(['a', 'b']);
    expect((await stat(f.project.projectPath)).isDirectory()).toBe(true);
  });

  it('CR03 never adopts a preexisting matching-branch checkout on retry or return', async () => {
    const f = await setup(); await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []);
    const calls = f.executor.calls.length;
    await expect(create(f)).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    let task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toBeNull(); expect(task.operation!.createAttempt).toBeUndefined();
    expect(task.operation!.error?.details).toMatchObject({ failedPhase: 'preflight', gitAttempted: false });
    await expect(f.coordinator.retry('task')).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    await f.coordinator.returnToBase('task'); task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toBeNull(); expect(task.operation).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
    expect(f.executor.calls).toHaveLength(calls); expect((await stat(f.tree)).isDirectory()).toBe(true);
    await f.coordinator.request('task', { kind: 'attach', path: f.tree });
    expect(f.store.snapshot().tasks[0]!.worktree?.owned).toBe(false);
  });

  it.each(['existing-branch', 'detached', 'ordinary-directory', 'ordinary-file', 'dangling-symlink'] as const)('CR03 refuses preexisting %s targets without ownership inference', async kind => {
    const f = await setup();
    if (kind === 'existing-branch') await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []);
    else if (kind === 'detached') await gitOk(f.project.gitRootPath, ['worktree', 'add', '--detach', f.tree, 'main']);
    else { await mkdir(path.dirname(f.tree), { recursive: true }); if (kind === 'ordinary-directory') await mkdir(f.tree); else if (kind === 'ordinary-file') await writeFile(f.tree, 'External file'); else await symlink(path.join(f.root, 'absent-external-target'), f.tree); }
    const before = f.executor.calls.length;
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'existing', path: f.tree, branchName: kind === 'detached' ? 'main' : 'feature' })).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    await expect(f.coordinator.retry('task')).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    await f.coordinator.returnToBase('task');
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
    expect(f.executor.calls).toHaveLength(before); expect(await lstat(f.tree)).toBeDefined();
  });

  it('CR03 disarms a failed branch creation before a later external checkout appears', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    await expect(create(f)).rejects.toMatchObject({ code: 'GIT_FAILED' });
    expect(f.store.snapshot().tasks[0]!.operation!.createAttempt).toBeUndefined();
    await gitOk(f.project.gitRootPath, ['worktree', 'add', f.tree, 'feature']);
    await expect(f.coordinator.retry('task')).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    await f.coordinator.returnToBase('task');
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
  });

  it('CR03 never arms ownership for a known source-ref validation error even if another actor fills the path', async () => {
    const f = await setup(); let calls = 0;
    const port = wrapped(f.adapter, { create: async (...args) => {
      calls++;
      try { return await f.adapter.create(...args); }
      catch (error) { await gitOk(f.project.gitRootPath, ['worktree', 'add', '-b', 'feature', f.tree, 'main']); throw error; }
    } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature', sourceBranch: 'missing-source' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    expect(f.store.snapshot().tasks[0]!.operation!.createAttempt).toBeUndefined();
    await expect(coordinator.retry('task')).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    await coordinator.returnToBase('task'); expect(calls).toBe(1);
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
  });

  it('CR03 rechecks absence after persisting the intent and disarms before calling Git if the target appeared', async () => {
    const f = await setup(); const transact = f.store.transact.bind(f.store); let injected = false; let creates = 0;
    const port = wrapped(f.adapter, { create: async (...args) => { creates++; return f.adapter.create(...args); } });
    f.store.transact = async change => { await transact(change); if (!injected && f.store.snapshot().tasks[0]!.operation?.createAttempt) { injected = true; await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []); } };
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    expect(creates).toBe(0); expect(f.store.snapshot().tasks[0]!.operation!.createAttempt).toBeUndefined();
    await coordinator.returnToBase('task'); expect(f.store.snapshot().tasks[0]!.worktree).toBeNull();
  });

  it('CR03 persists the canonical absent-target proof before Git is invoked', async () => {
    const f = await setup(); let observed = false;
    const port = wrapped(f.adapter, { create: async (...args) => {
      const operation = f.store.snapshot().tasks[0]!.operation!;
      expect(operation.createAttempt).toEqual({ operationId: operation.id, path: f.tree, gitRootPath: f.project.gitRootPath, branchName: 'feature', mode: 'new', absentBefore: true });
      expect(operation.phase).toBe('git'); await expect(lstat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' }); observed = true;
      return f.adapter.create(...args);
    } });
    await new WorktreeCoordinator(f.store, f.sessions, port).request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' });
    expect(observed).toBe(true); expect(f.store.snapshot().tasks[0]!.worktree?.owned).toBe(true);
  });

  it('CR03 does not invoke Git if persisting the absent-target proof fails', async () => {
    const f = await setup(); const transact = f.store.transact.bind(f.store); let fail = true;
    f.store.transact = change => transact(draft => { change(draft); if (fail && draft.tasks[0]!.operation?.createAttempt) { fail = false; throw new KanbanError('STORAGE_FAILED', 'Cannot persist create intent.'); } });
    await expect(create(f)).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    expect(adds(f.executor)).toBe(0); expect(f.store.snapshot().tasks[0]!.operation!.createAttempt).toBeUndefined();
    await f.coordinator.retry('task'); expect(adds(f.executor)).toBe(1);
  });

  it('CR03 recovers actual Git creation after binding storage failure across a serialized restart', async () => {
    const f = await setup(); const transact = f.store.transact.bind(f.store); let fail = true;
    f.store.transact = change => transact(draft => { change(draft); if (fail && draft.tasks[0]!.worktree && draft.tasks[0]!.operation?.gitCompleted) { fail = false; throw new KanbanError('STORAGE_FAILED', 'Git success was not acknowledged.'); } });
    await expect(create(f)).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    const serialized = JSON.stringify(f.store.snapshot());
    expect(f.store.snapshot().tasks[0]!.operation!.createAttempt?.absentBefore).toBe(true);
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
    f.coordinator.dispose(); await f.coordinator.settle();
    const restored = new MemoryStore(JSON.parse(serialized));
    await new WorktreeCoordinator(restored, f.sessions, f.adapter).retry('task');
    expect(restored.snapshot().tasks[0]!.worktree).toMatchObject({ owned: true, branch: 'feature', status: 'ready' });
    expect(adds(f.executor)).toBe(1);
  });

  it.each(['detached', 'mismatched-ref'] as const)('CR03 rejects %s recovery of a genuinely attempted existing-branch create', async kind => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']);
    const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); await gitOk(f.tree, kind === 'detached' ? ['checkout', '--detach', 'HEAD'] : ['checkout', '-b', 'other-ref']); throw new KanbanError('AFTER_GIT', 'Acknowledgment interrupted.'); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'existing', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    expect(f.store.snapshot().tasks[0]!.operation!.createAttempt?.absentBefore).toBe(true);
    await expect(coordinator.retry('task')).rejects.toMatchObject({ code: 'RECOVERY_TARGET_MISMATCH' });
    await coordinator.returnToBase('task');
    const returned = f.store.snapshot().tasks[0]!;
    expect(returned.worktree).toBeNull(); expect(returned.operation).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
    expect(returned.unclaimedWorktrees).toEqual([{ path: f.tree, branch: kind === 'detached' ? 'HEAD' : 'other-ref', error: expect.objectContaining({ code: 'UNCLAIMED_WORKTREE' }) }]);
    await coordinator.request('task', { kind: 'attach', path: f.tree });
    expect(f.store.snapshot().tasks[0]!.worktree?.owned).toBe(false);
    expect(f.store.snapshot().tasks[0]!.unclaimedWorktrees).toBeUndefined(); expect(adds(f.executor)).toBe(1);
  });

  it.each(['operationId', 'path', 'gitRootPath', 'branchName', 'mode'] as const)('CR03 checks the persisted proof binding for %s before recovery', async field => {
    const f = await setup(); const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); throw new KanbanError('AFTER_GIT', 'Acknowledgment interrupted.'); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    const proof = f.store.state.tasks[0]!.operation!.createAttempt!;
    (proof as unknown as Record<string, unknown>)[field] = field === 'mode' ? 'existing' : field === 'path' || field === 'gitRootPath' ? path.join(f.root, 'different') : 'different';
    await expect(coordinator.retry('task')).rejects.toMatchObject({ code: 'CREATE_RECOVERY_UNVERIFIED' });
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull(); expect(f.sessions.setCalls).toEqual([]); expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('keeps raw missing directories observable for explicit context recovery', async () => {
    const f = await setup(); const missing = path.join(f.root, 'missing-tree'); f.sessions.dirs.set('a', missing);
    expect(await f.sessions.directory('a')).toBe(missing);
    await expect(f.sessions.validateDirectory('a', missing)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.coordinator.returnToBase('task'); expect(await f.sessions.directory('a')).toBe(f.project.projectPath);
  });

  it('CR03 ignores legacy phase and error hints that lack an absent-target proof', async () => {
    const f = await setup(); await f.adapter.create(f.project, { mode: 'new', path: f.tree, branchName: 'feature' }, []);
    await expect(create(f)).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    const old = f.store.state.tasks[0]!.operation!; old.phase = 'git'; old.error = { code: 'GIT_FAILED', message: 'Legacy journal', details: { failedPhase: 'git', gitAttempted: true } };
    await f.coordinator.resumePending(); expect(f.store.snapshot().tasks[0]!.operation?.phase).toBe('failed');
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
    await f.coordinator.returnToBase('task'); expect(f.store.snapshot().tasks[0]!.worktree).toBeNull(); expect(f.sessions.setCalls).toEqual([]);
  });

  it('CR03 preserves a verified post-effect checkout when returning to base before its binding was saved', async () => {
    const f = await setup(); const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); throw new KanbanError('AFTER_GIT', 'Acknowledgment interrupted.'); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    await coordinator.returnToBase('task'); const task = f.store.snapshot().tasks[0]!;
    expect(task.operation).toBeNull(); expect(task.worktree).toMatchObject({ path: f.tree, branch: 'feature', owned: true, status: 'error' });
    expect(task.effectiveCwd).toBe(f.project.projectPath); expect(f.sessions.setCalls).toEqual([]); expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('rejects a remote-only existing branch before effects and never retains a recoverable create intent', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['update-ref', 'refs/remotes/origin/feature', 'HEAD']);
    const request = { kind: 'create', mode: 'existing', path: f.tree, branchName: 'origin/feature' } as const;
    await expect(f.coordinator.request('task', request)).rejects.toMatchObject({ code: 'LOCAL_BRANCH_REQUIRED' });
    expect(f.store.snapshot().tasks[0]!.operation?.createAttempt).toBeUndefined(); expect(adds(f.executor)).toBe(0);
    await expect(f.coordinator.retry('task')).rejects.toMatchObject({ code: 'LOCAL_BRANCH_REQUIRED' });
    await f.coordinator.returnToBase('task');
    const returned = f.store.snapshot().tasks[0]!;
    expect(returned.operation).toBeNull(); expect(returned.worktree).toBeNull(); expect(returned.unclaimedWorktrees).toBeUndefined(); expect(f.sessions.setCalls).toEqual([]);
    await expect(lstat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a real existing local branch after acknowledgment storage failure without detaching or recreating', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['branch', 'feature']); await gitOk(f.project.gitRootPath, ['tag', 'feature']);
    const transact = f.store.transact.bind(f.store); let fail = true;
    f.store.transact = change => transact(draft => { change(draft); if (fail && draft.tasks[0]!.worktree && draft.tasks[0]!.operation?.gitCompleted) { fail = false; throw new KanbanError('STORAGE_FAILED', 'Lost local-branch acknowledgment.'); } });
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'existing', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    expect((await gitOk(f.tree, ['symbolic-ref', '--quiet', 'HEAD'])).trim()).toBe('refs/heads/feature');
    await f.coordinator.retry('task');
    expect(f.store.snapshot().tasks[0]!.worktree).toMatchObject({ branch: 'feature', owned: true, status: 'ready' }); expect(adds(f.executor)).toBe(1);
  });

  it('persists unclaimed detached recovery across restart and never removes it during task deletion', async () => {
    const f = await setup(); const alias = path.join(f.root, 'unclaimed-alias'); const other = path.join(f.root, 'other-diagnostic'); await mkdir(other);
    const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); await gitOk(f.tree, ['checkout', '--detach', 'HEAD']); throw new KanbanError('AFTER_GIT', 'Detached acknowledgment unavailable.'); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    await symlink(f.tree, alias); const oldError = { code: 'OLD_DIAGNOSTIC', message: 'Retained recovery.' };
    f.store.state.tasks[0]!.unclaimedWorktrees = [{ path: alias, branch: 'HEAD', error: oldError }, { path: f.tree, branch: 'HEAD', error: oldError }, { path: other, branch: 'other', error: oldError }];
    await coordinator.returnToBase('task'); const returned = f.store.snapshot().tasks[0]!;
    expect(returned.worktree).toBeNull(); expect(returned.effectiveCwd).toBe(f.project.projectPath); expect(returned.operation).toBeNull();
    expect(returned.unclaimedWorktrees?.filter(record => record.path === f.tree)).toHaveLength(1); expect(returned.unclaimedWorktrees).toHaveLength(2);
    const restored = new MemoryStore(JSON.parse(JSON.stringify(f.store.snapshot()))); const next = new WorktreeCoordinator(restored, f.sessions, f.adapter);
    await next.returnToBase('task'); expect(restored.snapshot().tasks[0]!.unclaimedWorktrees).toEqual(returned.unclaimedWorktrees);
    await next.request('task', { kind: 'delete', discardChanges: true, expectedWorktreePath: null });
    expect(restored.snapshot().tasks).toEqual([]); expect((await stat(f.tree)).isDirectory()).toBe(true); expect((await stat(other)).isDirectory()).toBe(true);
    expect(f.executor.calls.some(args => args.includes('worktree') && args.includes('remove'))).toBe(false);
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', '--quiet', 'refs/heads/feature'])).exitCode).toBe(0);
    expect([...f.sessions.dirs.values()]).toEqual([f.project.projectPath, f.project.projectPath]); expect(f.sessions.archiveCalls).toEqual(['a', 'b']);
  });

  it('returns a partially switched detached checkout to base without retaining it as an owned binding', async () => {
    const f = await setup(); f.sessions.beforeSet = id => { if (id === 'b') throw new KanbanError('SET_FAILED', 'Injected native set failure.'); };
    await expect(create(f)).rejects.toMatchObject({ code: 'SET_FAILED' }); await gitOk(f.tree, ['checkout', '--detach', 'HEAD']);
    expect(f.store.snapshot().tasks[0]!.worktree?.owned).toBe(true); expect(await f.sessions.directory('a')).toBe(path.join(f.tree, 'packages/api'));
    f.sessions.beforeSet = undefined; await f.coordinator.returnToBase('task'); const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toBeNull(); expect(task.operation).toBeNull(); expect(task.unclaimedWorktrees?.[0]).toMatchObject({ path: f.tree, branch: 'HEAD', error: { code: 'UNCLAIMED_WORKTREE' } });
    expect([...f.sessions.dirs.values()]).toEqual([f.project.projectPath, f.project.projectPath]); expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('preserves a different known binding while returning an unverified attempted checkout to base', async () => {
    const f = await setup(); const known = path.join(f.root, 'trees', 'known');
    const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); await gitOk(f.tree, ['checkout', '--detach', 'HEAD']); throw new KanbanError('AFTER_GIT', 'Acknowledgment unavailable.'); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    await f.adapter.create(f.project, { mode: 'new', path: known, branchName: 'known' }, []);
    const binding = { path: known, branch: 'known', owned: true, status: 'ready' } as const;
    f.store.state.tasks[0]!.worktree = binding; f.store.state.tasks[0]!.effectiveCwd = path.join(known, 'packages/api');
    f.sessions.dirs.set('a', path.join(known, 'packages/api')); f.sessions.dirs.set('b', path.join(known, 'packages/api'));
    await coordinator.returnToBase('task'); const returned = f.store.snapshot().tasks[0]!;
    expect(returned.worktree).toEqual(binding); expect(returned.unclaimedWorktrees?.[0]?.path).toBe(f.tree); expect(returned.effectiveCwd).toBe(f.project.projectPath);
    await coordinator.request('task', { kind: 'delete', discardChanges: false, expectedWorktreePath: known });
    await expect(stat(known)).rejects.toMatchObject({ code: 'ENOENT' }); expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('does not turn an unrelated detached checkout into either a binding or recovery authority on return', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['worktree', 'add', '--detach', f.tree, 'main']);
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'existing', path: f.tree, branchName: 'main' })).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    f.sessions.dirs.set('a', path.join(f.tree, 'packages/api')); f.sessions.dirs.set('b', path.join(f.tree, 'packages/api'));
    await f.coordinator.returnToBase('task'); const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toBeNull(); expect(task.unclaimedWorktrees).toBeUndefined(); expect(task.operation).toBeNull();
    expect([...f.sessions.dirs.values()]).toEqual([f.project.projectPath, f.project.projectPath]); expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('retains the original failed journal if repository identity cannot be validated during return', async () => {
    const f = await setup(); const foreign = await fixture();
    const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); throw new KanbanError('AFTER_GIT', 'Acknowledgment unavailable.'); }, inspect: async project => f.adapter.inspect(project, foreign.project.gitRootPath, []) });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    const operation = f.store.snapshot().tasks[0]!.operation;
    await expect(coordinator.returnToBase('task')).rejects.toMatchObject({ code: 'REPOSITORY_MISMATCH' });
    const retained = f.store.snapshot().tasks[0]!; expect(retained.operation).toEqual(operation); expect(retained.unclaimedWorktrees).toBeUndefined(); expect(retained.worktree).toBeNull();
    expect(f.sessions.setCalls).toEqual([]); expect((await stat(f.tree)).isDirectory()).toBe(true);
  });

  it('returns an actual legacy remote-ref detached checkout as unclaimed rather than owned', async () => {
    const f = await setup(); await gitOk(f.project.gitRootPath, ['update-ref', 'refs/remotes/origin/feature', 'HEAD']);
    await expect(lstat(f.tree)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.store.transact(state => { state.tasks[0]!.operation = { id: 'legacy-remote-operation', request: { kind: 'create', mode: 'existing', path: f.tree, branchName: 'origin/feature' }, phase: 'git', targetPath: f.tree, previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: new Date().toISOString(), createAttempt: { operationId: 'legacy-remote-operation', path: f.tree, gitRootPath: f.project.gitRootPath, branchName: 'origin/feature', mode: 'existing', absentBefore: true } }; });
    await gitOk(f.project.gitRootPath, ['worktree', 'add', f.tree, 'origin/feature']);
    expect((await git(f.tree, ['symbolic-ref', '--quiet', 'HEAD'])).exitCode).toBe(1);
    await expect(f.coordinator.retry('task')).rejects.toMatchObject({ code: 'RECOVERY_TARGET_MISMATCH' });
    await f.coordinator.returnToBase('task'); const task = f.store.snapshot().tasks[0]!;
    expect(task.worktree).toBeNull(); expect(task.operation).toBeNull(); expect(task.unclaimedWorktrees?.[0]).toMatchObject({ path: f.tree, branch: 'HEAD', error: { code: 'UNCLAIMED_WORKTREE' } });
    expect([...f.sessions.dirs.values()]).toEqual([f.project.projectPath, f.project.projectPath]); expect((await stat(f.tree)).isDirectory()).toBe(true);
    expect((await git(f.project.gitRootPath, ['show-ref', '--verify', '--quiet', 'refs/heads/origin/feature'])).exitCode).toBe(1);
  });

  it('does not clear the original create journal if persisting unclaimed recovery metadata fails', async () => {
    const f = await setup(); const port = wrapped(f.adapter, { create: async (...args) => { await f.adapter.create(...args); await gitOk(f.tree, ['checkout', '--detach', 'HEAD']); throw new KanbanError('AFTER_GIT', 'Acknowledgment unavailable.'); } });
    const coordinator = new WorktreeCoordinator(f.store, f.sessions, port);
    await expect(coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'feature' })).rejects.toMatchObject({ code: 'AFTER_GIT' });
    const before = f.store.snapshot().tasks[0]!.operation; const transact = f.store.transact.bind(f.store); let fail = true;
    f.store.transact = change => transact(draft => { change(draft); if (fail && draft.tasks[0]!.unclaimedWorktrees?.length) { fail = false; throw new KanbanError('STORAGE_FAILED', 'Cannot record unclaimed checkout.'); } });
    await expect(coordinator.returnToBase('task')).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    expect(f.store.snapshot().tasks[0]!.operation).toEqual(before); expect(f.store.snapshot().tasks[0]!.unclaimedWorktrees).toBeUndefined(); expect(f.sessions.setCalls).toEqual([]);
    await coordinator.returnToBase('task'); expect(f.store.snapshot().tasks[0]!.operation).toBeNull(); expect(f.store.snapshot().tasks[0]!.unclaimedWorktrees?.[0]?.path).toBe(f.tree);
  });

});
