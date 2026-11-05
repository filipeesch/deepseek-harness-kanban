import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture, taskWithConversation } from './helpers.js';
import { KanbanApp } from '../../src/host/app.js';
import { HubRepository } from '../../src/host/hub-repository.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

async function worktreeTask(f: Awaited<ReturnType<typeof setup>>, title: string, projectId = f.project.id) {
  const task = await f.app.createTask({ projectId, title, description: '' });
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

/** Hold the repository lane at native archiving so a later admission can be observed before it runs. */
async function occupyLane(f: Awaited<ReturnType<typeof setup>>) {
  const blocker = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Lane blocker', description: '' });
  const gate = deferred();
  const archive = f.sessions.archive.bind(f.sessions);
  f.sessions.archive = async (id: string) => { await gate.promise; return archive(id); };
  await f.app.command({ type: 'task.delete', taskId: blocker.id, confirmed: true, expectedWorktreePath: null });
  await expect.poll(() => f.store.requireTask(blocker.id).operation?.phase, { timeout: 5000 }).toBe('archiving');
  return { release: () => { f.sessions.archive = archive; gate.resolve(); } };
}

describe('background destructive commands', () => {
  it('returns after admission and completes the deletion from the queue', async () => {
    const f = await setup();
    const lane = await occupyLane(f);
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Queued delete', description: '' });
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    expect(f.store.requireTask(task.id).operation?.phase).toBe('queued');
    expect(f.sessions.archived).toEqual([]);
    lane.release();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
  });

  it('records a queued preflight failure instead of rejecting the command', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Shared admission');
    await bindSecondTask(f, 'other-binding', root);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    expect(f.store.requireTask(task.id).operation).not.toBeNull();
    expect(f.git.removed).toEqual([]);
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(task.id);
    expect(failed.operation?.phase).toBe('failed');
    expect(failed.operation?.error?.code).toBe('SHARED_WORKTREE');
    expect(f.git.removed).toEqual([]);
    expect(f.store.requireTask('other-binding').worktree?.status).toBe('ready');
  });

  it('force deletes a checkout shared with another task and marks that binding', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Force delete');
    await bindSecondTask(f, 'other-binding', root);
    await bindSecondTask(f, 'third-binding', root);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(task.id).operation!;
    expect(failed.phase).toBe('failed');
    expect(failed.error?.code).toBe('SHARED_WORKTREE');
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
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true });
    await f.app.worktrees.settle();
    const refused = f.store.requireTask(task.id).operation!;
    expect(refused.phase).toBe('failed');
    expect(refused.error?.code).toBe('OPERATION_PENDING');
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
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root, force: true });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(task.id).operation!;
    expect(failed.phase).toBe('failed');
    expect(failed.error?.code).toBe('DISCARD_REQUIRED');
    expect(f.git.removed).toEqual([]);
  });

  it('force removes a shared checkout while retaining the task and marking affected bindings', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Force remove');
    await bindSecondTask(f, 'other-binding', root);
    await f.app.command({ type: 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    expect(f.store.requireTask(task.id).operation?.error?.code).toBe('SHARED_WORKTREE');
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

describe('destructive admission and repository lanes', () => {
  it('admits a deletion and a worktree removal without inspecting Git or native conversations', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'No io admission');
    const { task: removal, root: removalRoot } = await worktreeTask(f, 'No io removal');
    const lane = await occupyLane(f);
    let ioCalls = 0;
    const inspect = f.git.inspect.bind(f.git);
    const projectDirectory = f.git.projectDirectory.bind(f.git);
    const isIdle = f.sessions.isIdle.bind(f.sessions);
    const topology = f.sessions.topology.bind(f.sessions);
    f.git.inspect = async (...args) => { ioCalls += 1; return inspect(...args); };
    f.git.projectDirectory = async (...args) => { ioCalls += 1; return projectDirectory(...args); };
    f.sessions.isIdle = async (id: string) => { ioCalls += 1; return isIdle(id); };
    f.sessions.topology = async (...args) => { ioCalls += 1; return topology(...args); };
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.command({ type: 'worktree.remove', taskId: removal.id, confirmed: true, expectedWorktreePath: removalRoot });
    expect(f.store.requireTask(task.id).operation?.phase).toBe('queued');
    expect(f.store.requireTask(removal.id).operation?.phase).toBe('queued');
    expect(ioCalls).toBe(0);
    lane.release();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    const retained = f.store.requireTask(removal.id);
    expect(retained.operation).toBeNull();
    expect(retained.worktree).toBeNull();
    expect(f.git.removed).toContain(removalRoot);
  });

  it('fails the queued preflight when the binding changed after confirmation', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Moved binding');
    const replacement = path.join(f.root, 'trees', 'replacement');
    await mkdir(path.join(replacement, 'apps', 'web'), { recursive: true });
    const lane = await occupyLane(f);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === task.id)!;
      value.worktree = { ...value.worktree!, path: replacement, branch: 'task/replacement' };
    });
    lane.release();
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(task.id).operation!;
    expect(failed.phase).toBe('failed');
    expect(failed.error?.code).toBe('WORKTREE_CHANGED');
    expect(f.git.removed).toEqual([]);
    expect(f.store.requireTask(task.id).worktree?.path).toBe(replacement);
  });

  it('resumes a waiting deletion after its conversations settle', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Waiting delete', description: '' });
    f.sessions.busy.add(task.sessionIds[0]!);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();
    expect(f.store.requireTask(task.id).operation?.phase).toBe('waiting');
    expect(f.sessions.archived).toEqual([]);
    f.sessions.busy.clear();
    await f.app.worktrees.resumePending();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(f.sessions.archived).toEqual(task.sessionIds);
  });

  it('runs deletions in different repositories concurrently and keeps one repository serial', async () => {
    const f = await setup();
    const secondRoot = path.join(f.root, 'repo-two');
    const secondProjectPath = path.join(secondRoot, 'apps', 'web');
    await mkdir(secondProjectPath, { recursive: true });
    const second = await f.store.saveProject({ name: 'Second', projectPath: secondProjectPath, gitRootPath: secondRoot });
    const first = await taskWithConversation(f.app, { projectId: f.project.id, title: 'First repo', description: '' });
    const sibling = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Same repo', description: '' });
    const other = await taskWithConversation(f.app, { projectId: second.id, title: 'Second repo', description: '' });
    const archive = f.sessions.archive.bind(f.sessions);
    const releases: Array<() => void> = [];
    f.sessions.archive = async (id: string) => { await new Promise<void>(resolve => { releases.push(resolve); }); return archive(id); };
    await f.app.command({ type: 'task.delete', taskId: first.id, confirmed: true, expectedWorktreePath: null });
    await f.app.command({ type: 'task.delete', taskId: sibling.id, confirmed: true, expectedWorktreePath: null });
    await f.app.command({ type: 'task.delete', taskId: other.id, confirmed: true, expectedWorktreePath: null });
    await expect.poll(() => f.store.requireTask(first.id).operation?.phase, { timeout: 5000 }).toBe('archiving');
    await expect.poll(() => f.store.requireTask(other.id).operation?.phase, { timeout: 5000 }).toBe('archiving');
    // A different repository runs in parallel; the same repository waits for its lane.
    expect(f.store.requireTask(sibling.id).operation?.phase).toBe('queued');
    f.sessions.archive = archive;
    for (const release of releases.splice(0)) release();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks).toHaveLength(0);
  });

  it('keeps a confirmed transition when a destructive command is rejected', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Pending transition', description: '' });
    const pending = { id: 'pending-1', fromColumnId: task.columnId, columnId: task.columnId, mode: 'move' as const, status: 'failed' as const };
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.pendingTransition = pending; });
    // A target that no longer matches the binding rejects the command before any state is cleared.
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: '/different' })).rejects.toMatchObject({ code: 'WORKTREE_CHANGED' });
    expect(f.store.requireTask(task.id).pendingTransition).toMatchObject({ id: 'pending-1' });
    // An unresolved operation of another kind rejects it the same way.
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === task.id)!;
      value.operation = { id: 'create-op', request: { kind: 'create', mode: 'new', path: '/tree', branchName: 'feature' }, phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: new Date().toISOString() };
    });
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null })).rejects.toMatchObject({ code: 'CONTEXT_OPERATION_PENDING' });
    expect(f.store.requireTask(task.id).pendingTransition).toMatchObject({ id: 'pending-1' });
    expect(f.store.requireTask(task.id).operation?.id).toBe('create-op');
  });

  it('records a failed retry when admission is rejected', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Retry stale');
    await bindSecondTask(f, 'other-binding', root);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    expect(f.store.requireTask(task.id).operation?.phase).toBe('failed');
    const replacement = path.join(f.root, 'trees', 'retry-replacement');
    await mkdir(path.join(replacement, 'apps', 'web'), { recursive: true });
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === task.id)!;
      value.worktree = { ...value.worktree!, path: replacement, branch: 'task/replacement' };
    });
    await expect(f.app.command({ type: 'operation.retry', taskId: task.id })).rejects.toMatchObject({ code: 'WORKTREE_CHANGED' });
    const after = f.store.requireTask(task.id).operation!;
    // The rejected retry leaves a recoverable failure, not a stuck waiting phase.
    expect(after.phase).toBe('failed');
    expect(after.error?.code).toBe('WORKTREE_CHANGED');
    expect(f.git.removed).toEqual([]);
  });

  it('refuses a new confirmation that would substitute the recorded target', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Reconfirm stale');
    await bindSecondTask(f, 'other-binding', root);
    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    const failed = f.store.requireTask(task.id).operation!;
    expect(failed.phase).toBe('failed');
    const replacement = path.join(f.root, 'trees', 'reconfirm-replacement');
    await mkdir(path.join(replacement, 'apps', 'web'), { recursive: true });
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === task.id)!;
      value.worktree = { ...value.worktree!, path: replacement, branch: 'task/replacement' };
    });
    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: replacement })).rejects.toMatchObject({ code: 'OPERATION_TARGET_CHANGED' });
    const after = f.store.requireTask(task.id).operation!;
    expect(after.phase).toBe('failed');
    expect(after.request).toMatchObject({ expectedWorktreePath: root });
    expect(f.git.removed).toEqual([]);
  });

  it('resumes queued operations in creation order within a lane', async () => {
    const f = await setup();
    const second = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Second queued', description: '' });
    const first = await taskWithConversation(f.app, { projectId: f.project.id, title: 'First queued', description: '' });
    await f.store.transact(draft => {
      const queued = (id: string, createdAt: string) => ({ id, request: { kind: 'delete' as const, discardChanges: false, expectedWorktreePath: null }, phase: 'queued' as const, previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt });
      draft.tasks.find(item => item.id === first.id)!.operation = queued('op-first', '2026-01-01T00:00:00.000Z');
      draft.tasks.find(item => item.id === second.id)!.operation = queued('op-second', '2026-01-02T00:00:00.000Z');
    });
    await f.app.worktrees.resumePending();
    await f.app.worktrees.settle();
    // `first` was created last in wall-clock time but owns the earliest journal entry.
    expect(f.sessions.archived).toEqual([...first.sessionIds, ...second.sessionIds]);
    expect(f.store.snapshot().tasks).toHaveLength(0);
  });
});
