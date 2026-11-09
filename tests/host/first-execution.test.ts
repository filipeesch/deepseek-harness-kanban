import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { KanbanError } from '../../src/shared/errors.js';
import { fixture } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

const INSTRUCTED_WORKFLOW = ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    label: Backlog', '    on_enter_prompt: |', '      Start the task.', '  - id: done', '    label: Done', ''].join(String.fromCharCode(10));

async function instructed(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  await f.store.saveBoardWorkflow(f.board.id, INSTRUCTED_WORKFLOW);
  return f.store.snapshot().workflow.columns.find(column => column.id === 'backlog')!.onEnterPrompt!;
}
async function created(f: Awaited<ReturnType<typeof fixture>>, title = 'Start me') {
  return f.app.createTask({ projectId: f.project.id, title, description: '' });
}

describe('prepareFirstExecution', () => {
  it('creates the sibling worktree and the first conversation without sending', async () => {
    const f = await setup(); const instruction = await instructed(f);
    const task = await created(f);
    const opened = await f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' });
    const current = f.store.requireTask(task.id);
    expect(opened.sent).toBe(false);
    expect(f.git.created).toBe(1);
    expect(current.worktree).toMatchObject({ status: 'ready', branch: 'start-me' });
    expect(current.worktree!.path).toBe(path.join(f.root, 'repo-start-me'));
    expect(current.sessionIds).toHaveLength(1);
    expect(f.sessions.dirs.get(opened.sessionId)).toBe(path.join(current.worktree!.path, 'apps', 'web'));
    expect(f.sessions.sent).toEqual([]);
    expect(current.instructionPending).toEqual({ columnId: 'backlog', enteredAt: expect.any(Number) });
    expect(instruction).toContain('Start the task.');
  });

  it('dispatches the instructed entry when asked to send', async () => {
    const f = await setup(); const instruction = await instructed(f);
    const task = await created(f);
    const opened = await f.app.startFirstExecution(task.id, { send: true, columnId: 'backlog' });
    const current = f.store.requireTask(task.id);
    expect(opened.sent).toBe(true);
    expect(f.sessions.sent).toEqual([{ id: opened.sessionId, text: instruction, requestId: undefined }]);
    expect(current.instructionPending).toBeUndefined();
  });

  it('is idempotent when the conversation already exists', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    const first = await f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' });
    const second = await f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' });
    expect(second.sessionId).toBe(first.sessionId);
    expect(f.git.created).toBe(1);
    expect(f.sessions.dirs.size).toBe(1);
  });

  it('uses the project directory for a folder project', async () => {
    const f = await setup(); await instructed(f);
    const folderPath = path.join(f.root, 'docs'); await mkdir(folderPath, { recursive: true });
    const folder = await f.store.saveProject({ name: 'Docs', projectPath: folderPath });
    const task = await f.app.createTask({ projectId: folder.id, title: 'Write docs', description: '' });
    const opened = await f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' });
    expect(f.git.created).toBe(0);
    expect(f.store.requireTask(task.id).worktree).toBeNull();
    expect(f.sessions.dirs.get(opened.sessionId)).toBe(folderPath);
  });

  it('skips the worktree after a recorded base-project choice', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    await f.app.command({ type: 'worktree.dismiss', taskId: task.id });
    const opened = await f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' });
    expect(f.git.created).toBe(0);
    expect(f.sessions.dirs.get(opened.sessionId)).toBe(f.projectPath);
  });

  it('rejects a stale entry identity before creating anything', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    const marker = f.store.requireTask(task.id).instructionPending!;
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog', expectedEnteredAt: marker.enteredAt + 1 }))
      .rejects.toMatchObject({ code: 'INSTRUCTION_ALREADY_RESOLVED' });
    expect(f.git.created).toBe(0);
    expect(f.sessions.dirs.size).toBe(0);
  });

  it('rejects a changed reviewed instruction', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog', expectedInstruction: 'Other text' }))
      .rejects.toMatchObject({ code: 'INSTRUCTION_CHANGED' });
    expect(f.git.created).toBe(0);
  });

  it('rejects a busy task with a confirmed transition', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    await f.store.transact(draft => {
      draft.tasks.find(value => value.id === task.id)!.pendingTransition = { id: 'pending', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'waiting' };
    });
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' })).rejects.toMatchObject({ code: 'TASK_BUSY' });
    expect(f.git.created).toBe(0);
  });

  it('rejects a project with an unresolved relocation', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    await f.store.transact(draft => {
      draft.projects[0]!.operation = {
        id: 'relocation', request: { from: { projectPath: f.projectPath, gitRootPath: f.gitRoot }, to: { name: 'Web 2', projectPath: f.projectPath, gitRootPath: f.gitRoot } },
        phase: 'queued', migratedSessionIds: [], started: false, createdAt: new Date().toISOString(),
      };
    });
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' })).rejects.toMatchObject({ code: 'PROJECT_RELOCATING' });
    expect(f.git.created).toBe(0);
  });

  it('keeps the card and creates no conversation when the worktree fails', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    f.git.create = async () => { throw new KanbanError('GIT_FAILED', 'No checkout.'); };
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' })).rejects.toBeTruthy();
    expect(f.sessions.dirs.size).toBe(0);
    expect(f.store.requireTask(task.id).sessionIds).toEqual([]);
  });

  it('keeps the created worktree when the conversation fails', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    f.sessions.create = async () => { throw new KanbanError('SESSION_FAILED', 'No conversation.'); };
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' })).rejects.toMatchObject({ code: 'SESSION_FAILED' });
    expect(f.git.created).toBe(1);
    expect(f.store.requireTask(task.id).sessionIds).toEqual([]);
  });

  it('rejects a task that moved away from the creation entry', async () => {
    const f = await setup(); const instruction = await instructed(f);
    const task = await created(f);
    const marker = f.store.requireTask(task.id).instructionPending!;
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'done' });
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog', expectedEnteredAt: marker.enteredAt, expectedInstruction: instruction }))
      .rejects.toMatchObject({ code: 'TASK_MOVED' });
    expect(f.git.created).toBe(0);
    expect(f.sessions.dirs.size).toBe(0);
  });

  it('rejects a stale destination identity on the command', async () => {
    const f = await setup(); const instruction = await instructed(f);
    const task = await created(f);
    const marker = f.store.requireTask(task.id).instructionPending!;
    await expect(f.app.command({ type: 'task.prepareFirstExecution', taskId: task.id, columnId: 'done', expectedEnteredAt: marker.enteredAt, expectedInstruction: instruction }))
      .rejects.toMatchObject({ code: 'TASK_MOVED' });
    expect(f.git.created).toBe(0);
  });

  it('keeps the entry and created resources when the send fails', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    f.sessions.failSend = true;
    await expect(f.app.startFirstExecution(task.id, { send: true, columnId: 'backlog' })).rejects.toMatchObject({ code: 'SEND_FAILED' });
    const current = f.store.requireTask(task.id);
    expect(current.instructionPending).toEqual({ columnId: 'backlog', enteredAt: expect.any(Number) });
    expect(current.sessionIds).toHaveLength(1);
    expect(current.worktree?.status).toBe('ready');
    expect(f.sessions.sent).toEqual([]);
  });

  it('propagates an unavailable worktree default without creating a conversation', async () => {
    const f = await setup(); await instructed(f);
    const trees = path.join(f.root, 'trees'); await mkdir(trees, { recursive: true });
    await f.app.command({ type: 'settings.save', settings: { worktreeBasePath: trees } });
    for (let index = 1; index <= 100; index++) await mkdir(path.join(trees, index === 1 ? 'start-me' : 'start-me-' + index));
    const task = await created(f);
    await expect(f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' })).rejects.toMatchObject({ code: 'WORKTREE_NAME_UNAVAILABLE' });
    expect(f.sessions.dirs.size).toBe(0);
    expect(f.store.requireTask(task.id).sessionIds).toEqual([]);
  });

  it('serializes two concurrent preparations for the same entry', async () => {
    const f = await setup(); await instructed(f);
    const task = await created(f);
    const [first, second] = await Promise.all([
      f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' }),
      f.app.startFirstExecution(task.id, { send: false, columnId: 'backlog' }),
    ]);
    expect(second.sessionId).toBe(first.sessionId);
    expect(f.git.created).toBe(1);
    expect(f.sessions.dirs.size).toBe(1);
  });

  it('runs through the task.prepareFirstExecution command with its receipt', async () => {
    const f = await setup(); const instruction = await instructed(f);
    const task = await created(f);
    const marker = f.store.requireTask(task.id).instructionPending!;
    const snapshot = await f.app.command({ type: 'task.prepareFirstExecution', taskId: task.id, columnId: 'backlog', expectedEnteredAt: marker.enteredAt, expectedInstruction: instruction });
    expect(snapshot.commandReceipt).toMatchObject({ kind: 'conversation' });
    expect(f.git.created).toBe(1);
    expect(f.sessions.dirs.size).toBe(1);
  });
});
