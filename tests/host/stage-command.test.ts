import { afterEach, describe, expect, it } from 'vitest';
import { fixture } from './helpers.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { CommandSchema } from '../../src/remote.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }

const CONNECTED_FLOW = [
  'name: Connected',
  'initial_column: todo',
  'columns:',
  '  - id: todo',
  '    label: Todo',
  '  - id: plan',
  '    label: Plan',
  '  - id: done',
  '    label: Done',
  'connections:',
  '  - from: todo',
  '    to: done',
  '  - from: plan',
  '    to: done',
  '',
].join('\n');

describe('board.stage.update', () => {
  it('accepts its documented shape and rejects unknown fields', () => {
    const valid = { type: 'board.stage.update', hubId: 'hub', boardId: 'board', stageId: 'plan', patch: { name: 'Plan', allowedTransitions: [{ to: 'done', when: 'when ready' }], id: 'planned', initial: true, onEnterPrompt: null } };
    expect(CommandSchema.parse(valid)).toEqual(valid);
    expect(CommandSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
    expect(CommandSchema.safeParse({ ...valid, patch: { initial: false } }).success).toBe(false);
    expect(CommandSchema.safeParse({ ...valid, patch: { allowedTransitions: [{ to: 'done', extra: 1 }] } }).success).toBe(false);
  });

  it('edits one stage without sending anything', async () => {
    const f = await setup();
    const stage = f.store.snapshot().workflow.columns[0]!;
    await f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId: f.store.snapshot().boards[0]!.id, stageId: stage.id, patch: { name: 'To do', onEnterPrompt: 'Say hello.' } });
    const stored = f.store.snapshot().workflow.columns[0]!;
    expect(stored.name).toBe('To do');
    expect(stored.onEnterPrompt).toBe('Say hello.');
    expect(f.sessions.sent).toEqual([]);
  });

  it('migrates idle tasks when the identifier changes', async () => {
    const f = await setup();
    const boardId = f.store.snapshot().boards[0]!.id;
    const stage = f.store.snapshot().workflow.columns[0]!;
    const first = await f.app.createTask({ projectId: f.project.id, title: 'First', description: '' });
    const second = await f.app.createTask({ projectId: f.project.id, title: 'Second', description: '' });
    await f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: stage.id, patch: { id: 'backlog' } });
    expect(f.store.requireTask(first.id).columnId).toBe('backlog');
    expect(f.store.requireTask(second.id).columnId).toBe('backlog');
    const workflow = parseWorkflow(f.store.snapshot().boards[0]!.workflowYaml);
    expect(workflow.columns.find(column => column.id === 'backlog')?.name).toBe(stage.name);
    expect(workflow.initialColumnId).toBe('backlog');
  });

  it('delivers an edited instruction to a later entry and leaves a delivered one alone', async () => {
    const f = await setup();
    const boardId = f.store.snapshot().boards[0]!.id;
    const stage = f.store.snapshot().workflow.columns[1]!;
    const update = (patch: { onEnterPrompt?: string | null }) => f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: stage.id, patch });
    await update({ onEnterPrompt: 'Plan it.' });
    const first = await f.app.createTask({ projectId: f.project.id, title: 'First entry', description: '' });
    await f.app.command({ type: 'task.move', taskId: first.id, columnId: stage.id });
    const firstMarker = f.store.requireTask(first.id).instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: first.id, columnId: stage.id, expectedEnteredAt: firstMarker.enteredAt, expectedInstruction: 'Plan it.' });
    expect(f.sessions.sent.at(-1)).toMatchObject({ text: 'Plan it.' });

    // Editing the stage afterwards never rewrites what was already delivered.
    await update({ onEnterPrompt: 'Plan it better.' });
    expect(f.sessions.sent.at(-1)).toMatchObject({ text: 'Plan it.' });

    const second = await f.app.createTask({ projectId: f.project.id, title: 'Second entry', description: '' });
    await f.app.command({ type: 'task.move', taskId: second.id, columnId: stage.id });
    const secondMarker = f.store.requireTask(second.id).instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: second.id, columnId: stage.id, expectedEnteredAt: secondMarker.enteredAt, expectedInstruction: 'Plan it better.' });
    expect(f.sessions.sent.at(-1)).toMatchObject({ text: 'Plan it better.' });

    // Clearing the instruction leaves a later entry with nothing to deliver.
    await update({ onEnterPrompt: null });
    const third = await f.app.createTask({ projectId: f.project.id, title: 'Third entry', description: '' });
    await f.app.command({ type: 'task.move', taskId: third.id, columnId: stage.id });
    expect(f.store.requireTask(third.id).instructionPending).toBeUndefined();
  });

  it('refuses a rename while a task has work armed', async () => {
    const f = await setup();
    const boardId = f.store.snapshot().boards[0]!.id;
    const from = f.store.snapshot().workflow.columns[0]!.id;
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Armed', description: '' });
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.autoMode = { enabled: true }; });
    await expect(f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: from, patch: { id: 'renamed' } }))
      .rejects.toMatchObject({ code: 'STAGE_RENAME_IN_FLIGHT' });
    expect(f.store.requireTask(task.id).columnId).toBe(from);
  });

  it('refuses a rename while a conversation is running', async () => {
    const f = await setup();
    const boardId = f.store.snapshot().boards[0]!.id;
    const stage = f.store.snapshot().workflow.columns[0]!;
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Busy', description: '' });
    await f.app.command({ type: 'worktree.dismiss', taskId: task.id });
    const sessionId = await f.app.createConversation(task.id);
    f.sessions.busy.add(sessionId);
    await expect(f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: stage.id, patch: { id: 'renamed' } }))
      .rejects.toMatchObject({ code: 'STAGE_RENAME_IN_FLIGHT' });
    f.sessions.busy.delete(sessionId);
    await f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: stage.id, patch: { id: 'renamed' } });
    expect(f.store.requireTask(task.id).columnId).toBe('renamed');
  });

  it('reports a revision conflict and stores nothing', async () => {
    const f = await setup();
    const boardId = f.store.snapshot().boards[0]!.id;
    const stage = f.store.snapshot().workflow.columns[0]!;
    const before = f.store.snapshot().boards[0]!.workflowYaml;
    await expect(f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: stage.id, patch: { name: 'Later' }, expectedRevision: f.store.snapshot().revision - 1 }))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.store.snapshot().boards[0]!.workflowYaml).toBe(before);
  });

  it('stores nothing when a rename would merge two connection layouts', async () => {
    const f = await setup();
    const boardId = f.store.snapshot().boards[0]!.id;
    // The parser accepts a connection whose stage does not exist, so this stale
    // endpoint is what the rename would collide with.
    await f.store.setWorkflow([
      'columns:', '  - id: todo', '    label: Todo', '  - id: done', '    label: Done',
      'connections:', '  - from: todo', '    to: done', '  - from: ghost', '    to: done', '',
    ].join(String.fromCharCode(10)));
    const before = f.store.snapshot().boards[0]!.workflowYaml;
    await expect(f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: 'todo', patch: { id: 'ghost' } }))
      .rejects.toMatchObject({ code: 'INVALID_WORKFLOW' });
    expect(f.store.snapshot().boards[0]!.workflowYaml).toBe(before);
  });

  it('stores nothing when the rename cannot complete', async () => {
    const f = await setup();
    const boardId = f.store.snapshot().boards[0]!.id;
    await f.store.setWorkflow(CONNECTED_FLOW);
    const stage = f.store.snapshot().workflow.columns[1]!;
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Idle', description: '' });
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.columnId = stage.id; });
    const before = f.store.snapshot().boards[0]!.workflowYaml;
    await expect(f.app.command({ type: 'board.stage.update', hubId: f.store.hubId, boardId, stageId: stage.id, patch: { id: 'todo' } }))
      .rejects.toMatchObject({ code: 'INVALID_WORKFLOW' });
    expect(f.store.snapshot().boards[0]!.workflowYaml).toBe(before);
    expect(f.store.requireTask(task.id).columnId).toBe(stage.id);
  });
});
