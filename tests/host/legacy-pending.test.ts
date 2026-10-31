import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { BoardStateSchema } from '../../src/domain/schema.js';
import { fixture, taskWithConversation } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
import { afterEach } from 'vitest';
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }
async function task(f: Awaited<ReturnType<typeof setup>>) { return taskWithConversation(f.app, { projectId: f.project.id, title: 'Legacy task', description: '' }); }
async function instructed(f: Awaited<ReturnType<typeof setup>>) {
  const workflow = f.store.snapshot().workflow;
  workflow.columns[1]!.onEnterPrompt = 'Plan this task.';
  const { stringify } = await import('yaml');
  await f.store.setWorkflow(stringify({ name: workflow.name, initial_column: workflow.initialColumnId, columns: workflow.columns.map(column => ({ id: column.id, label: column.name, ...(column.onEnterPrompt !== undefined ? { on_enter_prompt: column.onEnterPrompt } : {}) })) }));
  return workflow.columns[1]!.id;
}
async function replaceInstruction(f: Awaited<ReturnType<typeof setup>>, instruction: string) {
  const workflow = f.store.snapshot().workflow;
  const { stringify } = await import('yaml');
  await f.store.setWorkflow(stringify({ name: workflow.name, initial_column: workflow.initialColumnId, columns: workflow.columns.map(column => ({ id: column.id, label: column.name, ...(column.id === workflow.columns[1]!.id ? { on_enter_prompt: instruction } : column.onEnterPrompt !== undefined ? { on_enter_prompt: column.onEnterPrompt } : {}) })) }));
}

describe('legacy pending transitions', () => {
  it('retries a persisted waiting run with its frozen text even after the workflow instruction changes', async () => {
    const f = await setup(); const columnId = await instructed(f); const t = await task(f);
    const text = '    Frozen **legacy** prompt.\n\nKeep exact bytes.\n';
    await f.store.transact(draft => {
      const value = draft.tasks[0]!;
      value.instructionPending = { columnId, enteredAt: 1 };
      value.pendingTransition = { id: 'legacy-run', fromColumnId: 'backlog', columnId, mode: 'run', sessionId: t.sessionIds[0]!, text, status: 'waiting' };
    });
    await replaceInstruction(f, 'A later replacement.');
    await f.app.command({ type: 'operation.retry', taskId: t.id });
    expect(f.sessions.sent).toHaveLength(1);
    expect(f.sessions.sent[0]).toMatchObject({ id: t.sessionIds[0], text, requestId: 'legacy-run' });
    expect(f.store.requireTask(t.id).pendingTransition).toBeUndefined();
    expect(f.store.requireTask(t.id).columnId).toBe(columnId);
  });

  it('retries a persisted failed run without demanding a newer instruction', async () => {
    const f = await setup(); const columnId = await instructed(f); const t = await task(f);
    await f.store.transact(draft => {
      const value = draft.tasks[0]!;
      value.instructionPending = { columnId, enteredAt: 1 };
      value.pendingTransition = { id: 'legacy-failed', fromColumnId: 'backlog', columnId, mode: 'run', sessionId: t.sessionIds[0]!, text: 'Frozen instruction.', status: 'failed', error: { code: 'SEND_FAILED', message: 'The instruction was not delivered.' } };
    });
    await f.app.command({ type: 'operation.retry', taskId: t.id });
    expect(f.sessions.sent).toEqual([{ id: t.sessionIds[0], text: 'Frozen instruction.', requestId: 'legacy-failed' }]);
    expect(f.store.requireTask(t.id).pendingTransition).toBeUndefined();
  });

  it('cancels a persisted legacy run on operation.return without sending', async () => {
    const f = await setup(); const columnId = await instructed(f); const t = await task(f);
    await f.store.transact(draft => {
      const value = draft.tasks[0]!;
      value.instructionPending = { columnId, enteredAt: 1 };
      value.pendingTransition = { id: 'legacy-cancel', fromColumnId: 'backlog', columnId, mode: 'run', sessionId: t.sessionIds[0]!, text: 'Cancelled instruction.', status: 'waiting', worktreeRequest: { mode: 'new', path: path.join(f.root, 'cancel-tree'), branchName: 'task/cancel', sourceBranch: 'main' } };
    });
    await f.app.command({ type: 'operation.return', taskId: t.id });
    expect(f.store.requireTask(t.id).pendingTransition).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('marks an interrupted sending transition as uncertain on initialize without sending', async () => {
    const f = await setup(); const columnId = await instructed(f); const t = await task(f);
    await f.store.transact(draft => {
      const value = draft.tasks[0]!;
      value.instructionPending = { columnId, enteredAt: 1 };
      value.pendingTransition = { id: 'legacy-sending', fromColumnId: 'backlog', columnId, mode: 'run', sessionId: t.sessionIds[0]!, text: 'Interrupted instruction.', status: 'sending' };
    });
    await f.app.initialize();
    const pending = f.store.requireTask(t.id).pendingTransition;
    expect(pending).toMatchObject({ status: 'failed', error: { code: 'DELIVERY_UNCERTAIN' } });
    expect(f.sessions.sent).toEqual([]);
  });

  it('prepares a persisted worktree request before delivering the frozen run', async () => {
    const f = await setup(); const columnId = await instructed(f); const t = await task(f);
    const tree = path.join(f.root, 'legacy-tree');
    await f.store.transact(draft => {
      const value = draft.tasks[0]!;
      value.instructionPending = { columnId, enteredAt: 1 };
      value.pendingTransition = { id: 'legacy-worktree', fromColumnId: 'backlog', columnId, mode: 'run', sessionId: t.sessionIds[0]!, text: 'Frozen worktree instruction.', status: 'waiting', worktreeRequest: { mode: 'new', path: tree, branchName: 'task/legacy', sourceBranch: 'main' } };
    });
    await f.app.initialize();
    await expect.poll(() => f.store.requireTask(t.id).worktree?.status).toBe('ready');
    await f.app.worktrees.resumePending();
    await f.app.command({ type: 'operation.retry', taskId: t.id });
    expect(f.git.created).toBe(1);
    expect(f.sessions.sent).toHaveLength(1);
    expect(f.sessions.sent[0]!.text).toBe('Frozen worktree instruction.');
    expect(f.store.requireTask(t.id).pendingTransition).toBeUndefined();
  });

  it('keeps persisted legacy records valid for the strict board schema', () => {
    const workflowYaml = ['name: Flow', 'initial_column: a', 'columns:', '  - id: a', '    label: A', '  - id: b', '    label: B', '    on_enter_prompt: Run.', ''].join('\n');
    const state = {
      schemaVersion: 2 as const, revision: 1, workflowYaml, workflow: { name: 'Flow', initialColumnId: 'a', columns: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', onEnterPrompt: 'Run.' }], groups: [] },
      projects: [{ id: 'p', name: 'P', projectPath: '/p', gitRootPath: '/p' }], notes: [],
      tasks: [{ id: 't', projectId: 'p', title: 'T', description: '', columnId: 'b', position: 0, sessionIds: ['s'], closedSessionIds: [], effectiveCwd: '/p', worktree: null, operation: null, instructionPending: { columnId: 'b', enteredAt: 1 }, pendingTransition: { id: 'legacy', fromColumnId: 'a', columnId: 'b', mode: 'run' as const, sessionId: 's', text: 'Frozen.', worktreeRequest: { mode: 'new' as const, path: '/t', branchName: 'task/t', sourceBranch: 'main' }, status: 'failed' as const }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
    };
    expect(BoardStateSchema.safeParse(state).success).toBe(true);
  });
});
