import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fixture, taskWithConversation } from './helpers.js';
import { KanbanError } from '../../src/shared/errors.js';
import type { ContextOperation } from '../../src/shared/types.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0).reverse()) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
type F = Awaited<ReturnType<typeof setup>>;

function failedReturn(id = 'failed-return'): ContextOperation {
  return {
    id, request: { kind: 'return' }, phase: 'failed',
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    error: { code: 'PATH_UNAVAILABLE', message: 'The directory cannot be resolved.', details: { failedPhase: 'preflight' } },
  };
}

async function setOperation(f: F, taskId: string, operation: ContextOperation): Promise<void> {
  await f.store.transact(draft => { draft.tasks.find(task => task.id === taskId)!.operation = operation; });
}

const unavailable = (f: F) => new KanbanError('PATH_UNAVAILABLE', 'The directory cannot be resolved.', { path: f.projectPath });

async function worktreeTask(f: F, title: string) {
  const task = await f.app.createTask({ projectId: f.project.id, title, description: '' });
  const root = path.join(f.root, 'trees', title.replace(/\s+/g, '-'));
  await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: root, branchName: 'task/' + title.replace(/\s+/g, '-'), sourceBranch: 'main' });
  await f.app.createConversation(task.id);
  return { task: f.store.requireTask(task.id), root };
}

describe('failed context operation recovery', () => {
  it('lets an explicit deletion replace a failed return and retains the unverifiable checkout', async () => {
    const f = await setup();
    const { task, root } = await worktreeTask(f, 'Stuck return');
    await setOperation(f, task.id, failedReturn());
    f.git.projectDirectoryFailure = unavailable(f);

    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();

    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(f.sessions.archived).toEqual(task.sessionIds);
    expect(f.git.removed).toEqual([]);
    expect((await f.app.snapshot()).retainedCheckouts).toEqual([{ path: root, projectId: f.project.id, taskTitle: 'Stuck return', reason: 'unresolved' }]);
  });

  it('deletes a task with a failed return and no worktree without resolving the base', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Stuck base return', description: '' });
    await setOperation(f, task.id, failedReturn());
    f.git.projectDirectoryFailure = unavailable(f);

    await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    await f.app.worktrees.settle();

    expect(f.store.snapshot().tasks.some(value => value.id === task.id)).toBe(false);
    expect(f.git.projectDirectoryCalls).toBe(0);
    expect((await f.app.snapshot()).retainedCheckouts).toBeUndefined();
  });

  it('keeps the failed journal when returning conversations cannot resolve the base', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Return guard', description: '' });
    const failedDelete: ContextOperation = { ...failedReturn('failed-delete'), request: { kind: 'delete', discardChanges: false, expectedWorktreePath: null } };
    await setOperation(f, task.id, failedDelete);
    f.git.projectDirectoryFailure = unavailable(f);

    await expect(f.app.command({ type: 'operation.return', taskId: task.id })).rejects.toMatchObject({ code: 'PROJECT_PATH_UNAVAILABLE' });
    const current = f.store.requireTask(task.id);
    expect(current.operation?.id).toBe('failed-delete');
    expect(current.operation?.request.kind).toBe('delete');
    expect(current.operation?.phase).toBe('failed');
  });

  it('returns a failed return whose base resolves and clears it', async () => {
    const f = await setup();
    const { task } = await worktreeTask(f, 'Recovered return');
    await setOperation(f, task.id, failedReturn());

    await f.app.command({ type: 'operation.return', taskId: task.id });

    expect(f.store.requireTask(task.id).operation).toBeNull();
    expect(await f.sessions.directory(task.sessionIds[0]!)).toBe(f.projectPath);
  });

  it('refuses to cancel an unknown task and a task with no operation', async () => {
    const f = await setup();
    await expect(f.app.command({ type: 'operation.cancel', taskId: 'missing' })).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Idle task', description: '' });
    await expect(f.app.command({ type: 'operation.cancel', taskId: task.id })).rejects.toMatchObject({ code: 'NO_OPERATION' });
  });

  it('refuses an unconfirmed discard and a discard with nothing to discard', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'No attempt', description: '' });
    await expect(f.app.command({ type: 'worktree.discardCreate', taskId: task.id, confirmed: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(f.app.command({ type: 'worktree.discardCreate', taskId: task.id, confirmed: true })).rejects.toMatchObject({ code: 'NO_OPERATION' });
  });

  it('still protects a failed create that owns an unclaimed attempt', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Protected create', description: '' });
    const failedCreate: ContextOperation = {
      ...failedReturn('failed-create'),
      request: { kind: 'create', mode: 'new', path: '/trees/protected', branchName: 'protected' },
      createAttempt: { operationId: 'failed-create', path: '/trees/protected', gitRootPath: f.gitRoot, branchName: 'protected', mode: 'new', absentBefore: true },
    };
    await setOperation(f, task.id, failedCreate);
    const moved = path.join(f.gitRoot, 'apps', 'protected-move');
    await (await import('node:fs/promises')).mkdir(moved);
    f.probe.locations.set(moved, { kind: 'git', projectPath: moved, gitRootPath: f.gitRoot, defaultBranch: 'main' });

    await expect(f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null })).rejects.toMatchObject({ code: 'CONTEXT_OPERATION_PENDING' });
    await expect(f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: f.project.name, projectPath: moved, gitRootPath: f.gitRoot }, confirmed: true })).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
  });
});
