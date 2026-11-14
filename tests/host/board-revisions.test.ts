import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { BoardRevisions } from '../../src/host/revisions.js';
import type { RevisionStore } from '../../src/host/revision-storage.js';
import type { BoardRevisionLog } from '../../src/domain/revisions/log.js';
import { fixture } from './helpers.js';

const FLOW = 'name: Flow\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    on_enter_prompt: Start.\n  - id: done\n    label: Done\n';

class MemoryRevisionStore implements RevisionStore {
  readonly records = new Map<string, BoardRevisionLog>();
  failNextSave = false;
  async load(boardId: string) {
    const value = this.records.get(boardId);
    return value === undefined ? undefined : structuredClone(value);
  }
  async save(log: BoardRevisionLog) {
    if (this.failNextSave) { this.failNextSave = false; throw new Error('the revision store is unavailable'); }
    this.records.set(log.boardId, structuredClone(log));
  }
  async delete(boardId: string) { this.records.delete(boardId); }
  async deleteHub(hubId: string) { for (const [key, value] of this.records) if (value.hubId === hubId) this.records.delete(key); }
  async close() {}
}

type F = Awaited<ReturnType<typeof fixture>> & { tools: ToolDefinition[]; revisionStore: MemoryRevisionStore; revisions: BoardRevisions; reported: unknown[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

async function setup(): Promise<F> {
  const store = new MemoryRevisionStore();
  const revisions = new BoardRevisions({ store, now: () => '2026-11-11T09:00:00.000Z' });
  const reported: unknown[] = [];
  const f = await fixture({ revisions, report: error => reported.push(error) });
  const value: F = { ...f, tools: productToolDefinitions(f.app, f.app.boards, undefined, { revisions }), revisionStore: store, revisions, reported };
  active.push(value);
  return value;
}

function execution(id = 'ordinary-session'): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}

function named(tools: ToolDefinition[], name: string): ToolDefinition {
  const definition = tools.find(candidate => candidate.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

async function run(f: F, name: string, args: Record<string, unknown>): Promise<any> {
  return named(f.tools, name).execute(args, execution());
}

async function boardWith(f: F, name: string, yaml: string): Promise<string> {
  const created = await run(f, 'create_board', { hub_id: f.hub.id, name, workflow_yaml: yaml });
  return created.id;
}

describe('board revisions', () => {
  it('records the creation of a board as its first revision', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    const list = await run(f, 'list_board_revisions', { board_id: boardId });
    expect(list.revisions).toHaveLength(1);
    expect(list.revisions[0]).toMatchObject({ at: '2026-11-11T09:00:00.000Z', actor: { kind: 'agent', sessionId: 'ordinary-session' }, origin: 'tool', summary: 'Created the board workflow.' });
    expect(list.olderNotRetained).toBe(0);
  });

  it('records one revision per accepted write, newest first', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Start carefully.' });
    const list = await run(f, 'list_board_revisions', { board_id: boardId });
    expect(list.revisions).toHaveLength(2);
    expect(list.revisions[0]).toMatchObject({ origin: 'tool', summary: 'changed 1 stage' });
    expect(list.revisions[1]!.summary).toBe('Created the board workflow.');
  });

  it('records a GUI write as an operator edit', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    await f.app.command({ type: 'board.workflow.save', hubId: f.hub.id, boardId, yaml: FLOW.replace('label: Done', 'label: Finished'), expectedRevision: f.hubs.requireHub(f.hub.id).revision });
    const list = await run(f, 'list_board_revisions', { board_id: boardId });
    expect(list.revisions[0]).toMatchObject({ actor: { kind: 'operator' }, origin: 'editor', summary: 'changed 1 stage' });
  });

  it('continues an older page without a gap or a repeat', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'One.' });
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Two.' });
    const first = await run(f, 'list_board_revisions', { board_id: boardId, limit: 2 });
    expect(first.revisions).toHaveLength(2);
    expect(first.nextBefore).toBe(first.revisions[1]!.revision);
    const second = await run(f, 'list_board_revisions', { board_id: boardId, limit: 2, before: first.nextBefore });
    expect(second.revisions).toHaveLength(1);
    expect(second.revisions[0]!.summary).toBe('Created the board workflow.');
  });

  it('reports a board that was never written', async () => {
    const f = await setup();
    const list = await run(f, 'list_board_revisions', { board_id: f.board.id });
    expect(list).toEqual({ boardId: f.board.id, revisions: [], olderNotRetained: 0, historyStarts: expect.objectContaining({ kind: 'created' }) });
  });

  it('compares two revisions by stage', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Also verify.' });
    await run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'todo', transitions: ['done'] });
    const list = await run(f, 'list_board_revisions', { board_id: boardId });
    const newest = list.revisions[0]!.revision;
    const oldest = list.revisions[list.revisions.length - 1]!.revision;
    const diff = await run(f, 'diff_board_revisions', { board_id: boardId, from: oldest, to: newest });
    expect(diff.difference.stages.find((stage: { stage: string }) => stage.stage === 'todo')?.fields).toContainEqual({ field: 'onEnterPrompt', from: 'Start.', to: 'Also verify.' });
  });

  it('rejects a revision it no longer retains', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    await expect(run(f, 'diff_board_revisions', { board_id: boardId, from: 99, to: 100 })).rejects.toMatchObject({ code: 'REVISION_NOT_RETAINED' });
    await expect(run(f, 'revert_board', { board_id: boardId, to_revision: 99, confirmed: true, expected_revision: f.hubs.requireHub(f.hub.id).revision })).rejects.toMatchObject({ code: 'REVISION_NOT_RETAINED' });
  });

  it('restores an earlier document as a new revision', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    const original = (await run(f, 'get_board_yaml', { board_id: boardId })).yaml;
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Changed.' });
    expect((await run(f, 'get_board_yaml', { board_id: boardId })).yaml).not.toBe(original);
    const before = await run(f, 'list_board_revisions', { board_id: boardId });
    const created = before.revisions.find((revision: { summary: string }) => revision.summary === 'Created the board workflow.');
    const reverted = await run(f, 'revert_board', { board_id: boardId, to_revision: created.revision, confirmed: true, expected_revision: f.hubs.requireHub(f.hub.id).revision });
    expect(reverted.report.valid).toBe(true);
    expect((await run(f, 'get_board_yaml', { board_id: boardId })).yaml).toBe(original);
    const after = await run(f, 'list_board_revisions', { board_id: boardId });
    expect(after.revisions).toHaveLength(3);
    expect(after.revisions[0]).toMatchObject({ origin: 'tool' });
    expect(after.revisions.some((revision: { summary: string }) => revision.summary === 'Created the board workflow.')).toBe(true);
  });

  it('refuses a revert without confirmation', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    await expect(run(f, 'revert_board', { board_id: boardId, to_revision: 0, expected_revision: f.hubs.requireHub(f.hub.id).revision })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('keeps the write when the revision log cannot be saved', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    f.revisionStore.failNextSave = true;
    const value = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Changed.' });
    expect(value.report.valid).toBe(true);
    expect((await run(f, 'get_board_yaml', { board_id: boardId })).yaml).toContain('Changed.');
    expect(f.reported.length).toBe(1);
  });

  it('reports no difference between a revision and itself', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Changed.' });
    const revision = (await run(f, 'list_board_revisions', { board_id: boardId })).revisions[0]!.revision;
    const diff = await run(f, 'diff_board_revisions', { board_id: boardId, from: revision, to: revision });
    expect(diff.difference).toEqual({ workflow: [], stages: [], groups: [], connections: [] });
  });

  it('refuses a revert with a stale Hub revision and changes nothing', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    const before = (await run(f, 'get_board_yaml', { board_id: boardId })).yaml;
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Changed.' });
    const after = (await run(f, 'get_board_yaml', { board_id: boardId })).yaml;
    const value = await run(f, 'revert_board', { board_id: boardId, to_revision: 1, confirmed: true, expected_revision: 0 });
    expect(value).toMatchObject({ saved: false, error: { code: 'REVISION_CONFLICT' }, details: { staleRevision: 0 } });
    expect((await run(f, 'get_board_yaml', { board_id: boardId })).yaml).toBe(after);
    expect(after).not.toBe(before);
  });

  it('refuses a revert that would strand cards and reports them', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    // A revision without the final stage, then a revision that restores it.
    await run(f, 'remove_stage', { board_id: boardId, stage_id: 'done', confirmed: true });
    const withoutDone = (await run(f, 'list_board_revisions', { board_id: boardId })).revisions[0]!.revision;
    await run(f, 'add_stage', { board_id: boardId, stage_yaml: 'id: done\nlabel: Done' });
    const task = await f.app.createTask({ projectId: f.project.id, boardId, title: 'Tracked', description: '' });
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.columnId = 'done'; });
    const value = await run(f, 'revert_board', { board_id: boardId, to_revision: withoutDone, confirmed: true, expected_revision: f.hubs.requireHub(f.hub.id).revision });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('WORKFLOW_ORPHAN_COLUMNS');
    expect(value.report.affectedCards).toContainEqual({ taskId: task.id, stage: 'done', reason: 'stage-removed' });
    expect((await run(f, 'get_board_yaml', { board_id: boardId })).yaml).toContain('id: done');
  });

  it('removes the log with the board', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Archived flow', FLOW);
    expect(f.revisionStore.records.has(boardId)).toBe(true);
    await run(f, 'delete_board', { board_id: boardId, confirmed: true });
    expect(f.revisionStore.records.has(boardId)).toBe(false);
  });
});