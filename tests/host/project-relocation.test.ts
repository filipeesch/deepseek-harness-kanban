import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { fixture, taskWithConversation } from './helpers.js';
import { KanbanError } from '../../src/shared/errors.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0).reverse()) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
type F = Awaited<ReturnType<typeof setup>>;
type Target = { movedRoot: string; projectPath: string };

async function moveRepository(f: F): Promise<Target> {
  const movedRoot = path.join(f.root, 'moved');
  await rename(f.gitRoot, movedRoot);
  const projectPath = path.join(movedRoot, 'apps', 'web');
  f.probe.locations.set(projectPath, { kind: 'git', projectPath, gitRootPath: movedRoot, defaultBranch: 'main' });
  f.probe.locations.set(movedRoot, { kind: 'git', projectPath: movedRoot, gitRootPath: movedRoot, defaultBranch: 'main' });
  return { movedRoot, projectPath };
}

function relocate(f: F, target: Target, name = f.project.name) {
  return f.app.command({
    type: 'project.relocate',
    project: { id: f.project.id, name, projectPath: target.projectPath, gitRootPath: target.movedRoot, defaultBranch: 'main' },
    confirmed: true,
  });
}

async function worktreeTask(f: F, title: string) {
  const task = await f.app.createTask({ projectId: f.project.id, title, description: '' });
  const root = path.join(f.root, 'trees', title.replace(/\s+/g, '-'));
  await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: root, branchName: 'task/' + title.replace(/\s+/g, '-'), sourceBranch: 'main' });
  await f.app.createConversation(task.id);
  return { task: f.store.requireTask(task.id), root };
}

describe('project relocation', () => {
  it('moves the project, its tasks, conversations, and workspace binding', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Base task', description: '' });
    const sessionId = task.sessionIds[0]!;
    const previousWorkspaceId = f.store.requireProject(f.project.id).workspaceId!;
    expect(previousWorkspaceId).toBeDefined();
    const target = await moveRepository(f);

    await relocate(f, target);
    await f.app.relocations.settle();

    const project = f.store.requireProject(f.project.id);
    expect(project.operation).toBeUndefined();
    expect(project.projectPath).toBe(target.projectPath);
    expect(project.gitRootPath).toBe(target.movedRoot);
    expect(f.store.requireTask(task.id).effectiveCwd).toBe(target.projectPath);
    expect(await f.sessions.directory(sessionId)).toBe(target.projectPath);
    const workspace = f.workspaces.byPath.get(target.projectPath);
    expect(workspace).toBeDefined();
    expect(project.workspaceId).toBe(workspace!.id);
    expect(f.workspaces.byId.get(previousWorkspaceId)).toBeDefined();

    const nextSession = await f.app.createConversation(task.id);
    expect(f.sessions.workspaceIds.get(nextSession)).toBe(workspace!.id);
  });

  it('waits for every conversation and resumes on activity', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Busy task', description: '' });
    const sessionId = task.sessionIds[0]!;
    f.sessions.busy.add(sessionId);
    const target = await moveRepository(f);

    await relocate(f, target);
    await f.app.relocations.settle();
    const waiting = f.store.requireProject(f.project.id);
    expect(waiting.operation?.phase).toBe('waiting');
    expect(waiting.projectPath).toBe(f.projectPath);
    expect(await f.sessions.directory(sessionId)).toBe(f.projectPath);

    f.sessions.busy.delete(sessionId);
    await f.app.relocations.resumePending();
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
    expect(f.store.requireProject(f.project.id).projectPath).toBe(target.projectPath);
  });

  it('records a failed step, stays forward-only, and completes on retry', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Retry task', description: '' });
    const sessionId = task.sessionIds[0]!;
    const original = f.sessions.setDirectory.bind(f.sessions);
    f.sessions.setDirectory = async () => { throw new KanbanError('DIRECTORY_SWITCH_FAILED', 'Injected switch failure.'); };
    const target = await moveRepository(f);

    await relocate(f, target);
    await f.app.relocations.settle();
    const failed = f.store.requireProject(f.project.id);
    expect(failed.operation?.phase).toBe('failed');
    expect(failed.operation?.error?.code).toBe('DIRECTORY_SWITCH_FAILED');
    expect(failed.operation?.error?.details?.failedPhase).toBe('sessions');
    expect(failed.projectPath).toBe(target.projectPath);
    await expect(f.app.command({ type: 'project.relocationCancel', projectId: f.project.id })).rejects.toMatchObject({ code: 'RELOCATION_STARTED' });

    f.sessions.setDirectory = original;
    await f.app.command({ type: 'project.relocationRetry', projectId: f.project.id });
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
    expect(await f.sessions.directory(sessionId)).toBe(target.projectPath);
  });

  it('cancels only before the first write and leaves the project unchanged', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Cancel task', description: '' });
    const sessionId = task.sessionIds[0]!;
    f.sessions.busy.add(sessionId);
    const target = await moveRepository(f);
    await relocate(f, target);
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation?.phase).toBe('waiting');

    await f.app.command({ type: 'project.relocationCancel', projectId: f.project.id });
    const project = f.store.requireProject(f.project.id);
    expect(project.operation).toBeUndefined();
    expect(project.projectPath).toBe(f.projectPath);
    expect(f.store.requireTask(task.id).effectiveCwd).toBe(f.projectPath);
    f.sessions.busy.delete(sessionId);
  });

  it('blocks execution, conversations, worktree work, and project changes while pending', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Blocked task', description: '' });
    const sessionId = task.sessionIds[0]!;
    f.sessions.busy.add(sessionId);
    const target = await moveRepository(f);
    await relocate(f, target);
    await f.app.relocations.settle();

    await expect(f.app.command({ type: 'conversation.create', taskId: task.id })).rejects.toMatchObject({ code: 'PROJECT_RELOCATING' });
    await expect(f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: path.join(f.root, 'trees', 'blocked'), branchName: 'blocked' })).rejects.toMatchObject({ code: 'PROJECT_RELOCATING' });
    await expect(f.app.command({ type: 'project.save', project: { id: f.project.id, name: 'Renamed', projectPath: f.projectPath, gitRootPath: f.gitRoot } })).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
    await expect(f.app.command({ type: 'project.delete', projectId: f.project.id, confirmed: true })).rejects.toMatchObject({ code: 'PROJECT_BUSY' });

    await expect(f.app.command({ type: 'task.edit', taskId: task.id, title: 'Edited while waiting' })).resolves.toBeDefined();
    await expect(f.app.command({ type: 'task.move', taskId: task.id, columnId: f.board.workflow.columns[1]!.id })).resolves.toBeDefined();

    f.sessions.busy.delete(sessionId);
    await f.app.relocations.resumePending();
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
  });

  it('repairs and revalidates a worktree binding against the new Git root', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Relocated tree');
    const target = await moveRepository(f);

    await relocate(f, target);
    await f.app.relocations.settle();

    const relocated = f.store.requireTask(task.id);
    expect(relocated.worktree?.status).toBe('ready');
    expect(relocated.effectiveCwd).toBe(path.join(root, 'apps', 'web'));
    expect(f.git.repaired).toContain(root);
    expect(await f.sessions.directory(task.sessionIds[0]!)).toBe(path.join(root, 'apps', 'web'));
  });

  it('records an unverifiable worktree binding without failing the relocation', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Missing tree');
    const previousDirectory = f.store.requireTask(task.id).effectiveCwd;
    f.git.trees.delete(root);
    const target = await moveRepository(f);

    await relocate(f, target);
    await f.app.relocations.settle();

    const relocated = f.store.requireTask(task.id);
    expect(relocated.worktree?.status).toBe('error');
    expect(relocated.worktree?.error?.code).toBe('NOT_WORKTREE');
    expect(relocated.effectiveCwd).toBe(previousDirectory);
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
  });

  it('resumes a recorded relocation at startup', async () => {
    const f = await setup();
    await taskWithConversation(f.app, { projectId: f.project.id, title: 'Startup task', description: '' });
    const target = await moveRepository(f);
    await f.store.transact(draft => {
      const project = draft.projects.find(candidate => candidate.id === f.project.id)!;
      project.operation = {
        id: 'startup-op',
        request: { from: { projectPath: f.projectPath, gitRootPath: f.gitRoot }, to: { name: f.project.name, projectPath: target.projectPath, gitRootPath: target.movedRoot, defaultBranch: 'main' } },
        phase: 'queued',
        migratedSessionIds: [],
        started: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
    });

    await f.app.initialize();
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
    expect(f.store.requireProject(f.project.id).projectPath).toBe(target.projectPath);
  });

  it('keeps a waiting relocation resumable across shutdown', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Shutdown task', description: '' });
    f.sessions.busy.add(task.sessionIds[0]!);
    const target = await moveRepository(f);
    await relocate(f, target);
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation?.phase).toBe('waiting');

    await f.app.close();
    expect(f.store.requireProject(f.project.id).operation?.phase).toBe('waiting');
  });

  it('rejects a Git association conversion and a second relocation with another target', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Validation task', description: '' });
    f.sessions.busy.add(task.sessionIds[0]!);
    const target = await moveRepository(f);
    await expect(f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: f.project.name, projectPath: target.projectPath }, confirmed: true })).rejects.toMatchObject({ code: 'PROJECT_ASSOCIATION_CHANGE' });

    await relocate(f, target);
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation?.phase).toBe('waiting');
    const otherPath = target.movedRoot;
    await expect(f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: f.project.name, projectPath: otherPath, gitRootPath: target.movedRoot }, confirmed: true })).rejects.toMatchObject({ code: 'CONTEXT_OPERATION_PENDING' });
    await f.app.command({ type: 'project.relocationCancel', projectId: f.project.id });
  });

  it('refuses cancellation after migration started and resumes the remaining work', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Late busy task', description: '' });
    const sessionId = task.sessionIds[0]!;
    const target = await moveRepository(f);
    const originalIsIdle = f.sessions.isIdle.bind(f.sessions);
    f.sessions.isIdle = async (id: string) => f.store.requireProject(f.project.id).projectPath === target.projectPath ? false : originalIsIdle(id);

    await relocate(f, target);
    await f.app.relocations.settle();
    const waiting = f.store.requireProject(f.project.id);
    expect(waiting.projectPath).toBe(target.projectPath);
    expect(waiting.operation?.phase).toBe('waiting');
    expect(waiting.operation?.started).toBe(true);
    await expect(f.app.command({ type: 'project.relocationCancel', projectId: f.project.id })).rejects.toMatchObject({ code: 'RELOCATION_STARTED' });

    f.sessions.isIdle = originalIsIdle;
    await f.app.relocations.resumePending();
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
    expect(await f.sessions.directory(sessionId)).toBe(target.projectPath);
  });

  it('relocates a folder project that keeps a retained plain checkout', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Plain relocation');
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.projectPath } });
    const movedPath = path.join(f.root, 'plain-moved');
    await mkdir(movedPath);
    f.probe.locations.set(movedPath, { kind: 'folder', projectPath: movedPath });

    await f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: f.project.name, projectPath: movedPath }, confirmed: true });
    await f.app.relocations.settle();

    const project = f.store.requireProject(f.project.id);
    expect(project.operation).toBeUndefined();
    expect(project.projectPath).toBe(movedPath);
    expect(project.gitRootPath).toBeUndefined();
    const relocated = f.store.requireTask(task.id);
    expect(relocated.worktree?.path).toBe(root);
    expect(relocated.effectiveCwd).toBe(path.join(root, 'apps', 'web'));
    expect(await f.sessions.directory(task.sessionIds[0]!)).toBe(path.join(root, 'apps', 'web'));
  });

  it('repairs each worktree with its own conversation policies', async () => {
    const f = await setup();
    const first = await worktreeTask(f, 'First tree');
    const second = await worktreeTask(f, 'Second tree');
    await f.store.transact(draft => { const task = draft.tasks.find(value => value.id === second.task.id)!; task.sessionIds = []; task.closedSessionIds = []; });
    const target = await moveRepository(f);

    await relocate(f, target);
    await f.app.relocations.settle();

    expect(f.git.repairCalls).toEqual([{ paths: [first.root], sessionIds: first.task.sessionIds }]);
    expect(f.git.repaired).not.toContain(second.root);
    expect(f.store.requireTask(second.task.id).worktree?.status).toBe('ready');
  });

  it('defers when a task gains a transition while the relocation waits', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Transition task', description: '' });
    const sessionId = task.sessionIds[0]!;
    f.sessions.busy.add(sessionId);
    const target = await moveRepository(f);
    await relocate(f, target);
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation?.phase).toBe('waiting');

    await f.store.transact(draft => {
      const current = draft.tasks.find(value => value.id === task.id)!;
      // A delivery in progress is not dispatched by the pending-transition runner, so it
      // stays observable while the relocation resumes.
      current.pendingTransition = { id: 'waiting-move', fromColumnId: f.board.workflow.initialColumnId, columnId: f.board.workflow.initialColumnId, mode: 'move', status: 'sending' };
    });
    f.sessions.busy.delete(sessionId);
    await f.app.relocations.resumePending();
    await f.app.relocations.settle();
    const deferred = f.store.requireProject(f.project.id);
    expect(deferred.projectPath).toBe(f.projectPath);
    expect(deferred.operation?.phase).toBe('waiting');

    await f.store.transact(draft => { delete draft.tasks.find(value => value.id === task.id)!.pendingTransition; });
    await f.app.relocations.resumePending();
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
    expect(f.store.requireProject(f.project.id).projectPath).toBe(target.projectPath);
  });

  it('rejects a relocation that changes neither the path nor the Git root', async () => {
    const f = await setup();
    await taskWithConversation(f.app, { projectId: f.project.id, title: 'No move task', description: '' });
    await expect(f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: 'Renamed', projectPath: f.projectPath, gitRootPath: f.gitRoot }, confirmed: true })).rejects.toMatchObject({ code: 'NO_LOCATION_CHANGE' });
  });

  it('relocates a Git root change that keeps the project path', async () => {
    const f = await setup();
    await taskWithConversation(f.app, { projectId: f.project.id, title: 'Root only task', description: '' });
    f.probe.locations.set(f.projectPath, { kind: 'git', projectPath: f.projectPath, gitRootPath: f.root, defaultBranch: 'trunk' });

    await f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: f.project.name, projectPath: f.projectPath, gitRootPath: f.root, defaultBranch: 'trunk' }, confirmed: true });
    await f.app.relocations.settle();

    const project = f.store.requireProject(f.project.id);
    expect(project.operation).toBeUndefined();
    expect(project.projectPath).toBe(f.projectPath);
    expect(project.gitRootPath).toBe(f.root);
    expect(project.defaultBranch).toBe('trunk');
  });

  it('re-submitting a failed relocation retries it', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Join retry task', description: '' });
    const sessionId = task.sessionIds[0]!;
    const original = f.sessions.setDirectory.bind(f.sessions);
    f.sessions.setDirectory = async () => { throw new KanbanError('DIRECTORY_SWITCH_FAILED', 'Injected switch failure.'); };
    const target = await moveRepository(f);
    await relocate(f, target);
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation?.phase).toBe('failed');

    f.sessions.setDirectory = original;
    await relocate(f, target);
    await f.app.relocations.settle();
    expect(f.store.requireProject(f.project.id).operation).toBeUndefined();
    expect(await f.sessions.directory(sessionId)).toBe(target.projectPath);
  });

  it('migrates a closed conversation', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Closed conversation task', description: '' });
    const sessionId = task.sessionIds[0]!;
    await f.app.command({ type: 'conversation.close', taskId: task.id, sessionId });
    const target = await moveRepository(f);
    await relocate(f, target);
    await f.app.relocations.settle();
    expect(await f.sessions.directory(sessionId)).toBe(target.projectPath);
  });
});
