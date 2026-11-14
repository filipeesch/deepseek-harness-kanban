import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { BoardRevisions } from '../../src/host/revisions.js';
import type { RevisionStore } from '../../src/host/revision-storage.js';
import type { BoardRevisionLog } from '../../src/domain/revisions/log.js';
import type { HubSharingService } from '../../src/host/sharing/service.js';
import { fixture } from './helpers.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
type F = Fixture & { tools: ToolDefinition[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

/** One board's log per record, exactly as the durable store behaves after a restart. */
class MemoryRevisionStore implements RevisionStore {
  readonly logs = new Map<string, BoardRevisionLog>();
  async load(boardId: string) { return this.logs.get(boardId); }
  async save(log: BoardRevisionLog) { this.logs.set(log.boardId, log); }
  async delete(boardId: string) { this.logs.delete(boardId); }
  async deleteHub(hubId: string) { for (const [boardId, log] of this.logs) if (log.hubId === hubId) this.logs.delete(boardId); }
  async close() {}
}

async function setup(options: { sharing?: unknown } = {}): Promise<F & { revisions: BoardRevisions; revisionStore: MemoryRevisionStore }> {
  const revisionStore = new MemoryRevisionStore();
  const revisions = new BoardRevisions({ store: revisionStore });
  const f = await fixture({ revisions, ...(options.sharing === undefined ? {} : { sharing: options.sharing as HubSharingService }) });
  const value = { ...f, tools: productToolDefinitions(f.app, f.app.boards, undefined, { revisions }), revisions, revisionStore };
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

describe('board history', () => {
  it('records a board creation as the start of its history', async () => {
    const f = await setup();
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'History' });
    const list = await run(f, 'list_board_revisions', { board_id: created.id });
    expect(list.historyStarts).toMatchObject({ kind: 'created' });
    expect(list.revisions.map((revision: { revision: number }) => revision.revision)).toEqual([1]);
  });

  it('marks a history that starts after the board existed as recovered', async () => {
    const f = await setup();
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Lost' });
    f.revisionStore.logs.delete(created.id);
    await run(f, 'set_stage_prompt', { board_id: created.id, stage_id: 'backlog', prompt: 'After the loss.' });
    const list = await run(f, 'list_board_revisions', { board_id: created.id });
    expect(list.historyStarts).toMatchObject({ kind: 'recovered' });
    expect(list.revisions).toHaveLength(1);
  });

  it('keeps a revision identity when a history is reconciled', async () => {
    const f = await setup();
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Reconciled' });
    await run(f, 'set_stage_prompt', { board_id: created.id, stage_id: 'backlog', prompt: 'First.' });
    await run(f, 'set_stage_prompt', { board_id: created.id, stage_id: 'backlog', prompt: 'Second.' });
    const before = await run(f, 'list_board_revisions', { board_id: created.id });
    const newest = before.revisions[0].revision;
    const board = f.store.snapshot().boards.find(value => value.id === created.id)!;
    await f.revisions.reconcile({ hubId: f.hub.id, boardId: created.id, storedText: board.workflowYaml.replace('Second.', 'Recovered.') });
    const after = await run(f, 'list_board_revisions', { board_id: created.id });
    expect(after.revisions[0].revision).toBe(newest + 1);
    expect(after.revisions[0].origin).toBe('recovery');
    expect(after.revisions.find((revision: { revision: number }) => revision.revision === newest)).toBeDefined();
  });
});

/** A sharing service that publishes nothing and answers one published workflow. */
function fakeSharing(published: string | undefined) {
  return {
    view: () => undefined,
    isBound: () => published !== undefined,
    noteLocalChange: () => {},
    removeBoard: async () => {},
    publishBoard: async () => {},
    publishAll: async () => {},
    publishedWorkflow: () => published,
  };
}

describe('published comparison', () => {
  const PUBLISHED = 'name: Flow\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';

  it('reports the per-stage difference between the local board and the published version', async () => {
    const f = await setup({ sharing: fakeSharing(PUBLISHED) });
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Compared' });
    await run(f, 'update_board', { board_id: created.id, workflow_yaml: PUBLISHED.replace('label: Done', 'label: Complete') });
    const value = await run(f, 'diff_published_board', { board_id: created.id });
    expect(value.comparable).toBe(true);
    expect(value.matches).toBe(false);
    expect(value.difference.stages).toContainEqual({ stage: 'done', change: 'changed', fields: [{ field: 'name', from: 'Done', to: 'Complete' }] });
  });

  it('reports a board that matches its published version', async () => {
    const f = await setup({ sharing: fakeSharing(PUBLISHED) });
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Matching', workflow_yaml: PUBLISHED });
    const value = await run(f, 'diff_published_board', { board_id: created.id });
    expect(value).toMatchObject({ comparable: true, matches: true });
  });

  it('reports a Hub with nothing published', async () => {
    const f = await setup();
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Unbound' });
    const value = await run(f, 'diff_published_board', { board_id: created.id });
    expect(value).toEqual({ boardId: created.id, comparable: false, reason: 'no-published-version' });
  });

  it('compares without publishing and without recording a revision', async () => {
    const f = await setup({ sharing: fakeSharing(PUBLISHED) });
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Read only' });
    const revision = f.store.snapshot().revision;
    const listBefore = await run(f, 'list_board_revisions', { board_id: created.id });
    await run(f, 'diff_published_board', { board_id: created.id });
    expect(f.store.snapshot().revision).toBe(revision);
    expect((await run(f, 'list_board_revisions', { board_id: created.id })).revisions).toEqual(listBefore.revisions);
  });
});
