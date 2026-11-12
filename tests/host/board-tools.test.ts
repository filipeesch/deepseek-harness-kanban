import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import type { HubSharingService } from '../../src/host/sharing/service.js';
import type { HubSharingView } from '../../src/shared/types.js';
import { fixture, taskWithConversation } from './helpers.js';

const CUSTOM_FLOW = 'name: Custom\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';
const COMMENTED_FLOW = '# Keep this comment\nname: Commented\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';
const MODEL_FLOW = 'name: Modelled\ninitial_column: todo\nmodel:\n  provider: deepseek\n  model: chat\n  reasoning_effort: high\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';
const MALFORMED_MODEL_FLOW = 'name: Broken\ninitial_column: todo\nmodel:\n  provider: deepseek\n  temperature: 0.2\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';
const GROUPED_FLOW = 'name: Grouped\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    on_enter_prompt: Do it.\n    allowed_transitions: [done]\n  - id: done\n    label: Done\ngroups:\n  - id: flow\n    label: Flow\n    columns: [todo, done]\n';

class FakeSharing {
  readonly hubId = 'default';
  viewValue: HubSharingView | undefined;
  bound = new Set<string>();
  localChanges: string[] = [];
  removed: Array<{ hubId: string; boardId: string; scope: 'local' | 'team'; name: string }> = [];
  published: string[] = [];
  publishedManifest = 0;
  publishCheck: (() => void) | undefined;
  publishFailure: unknown;
  views(): Record<string, HubSharingView> { return this.viewValue === undefined ? {} : { [this.hubId]: this.viewValue }; }
  view(): HubSharingView | undefined { return this.viewValue; }
  isBound(_hubId: string, boardId: string): boolean { return this.bound.has(boardId); }
  noteLocalChange(hubId: string): void { this.localChanges.push(hubId); }
  async publishBoard(_hubId: string, boardId: string): Promise<void> {
    this.publishCheck?.();
    this.published.push(boardId);
    if (this.publishFailure) throw this.publishFailure;
  }
  async publishManifest(_hubId: string): Promise<void> {
    this.publishCheck?.();
    this.publishedManifest += 1;
    if (this.publishFailure) throw this.publishFailure;
  }
  async removeBoard(hubId: string, boardId: string, scope: 'local' | 'team', name: string): Promise<void> {
    this.removed.push({ hubId, boardId, scope, name });
    this.bound.delete(boardId);
  }
}

function sharingView(overrides: Partial<HubSharingView> = {}): HubSharingView {
  return {
    status: 'published', provider: 'git', providerLabel: 'Git', supportsFiles: true, address: 'team/repo', syncMode: 'explicit', intervalMinutes: 5,
    drafts: 0, pending: 0, updates: 0, conflicts: 0, orderChanged: false, syncing: false,
    boards: [], incoming: [], removed: [], blockers: [], removing: [], ...overrides,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type F = Fixture & { tools: ToolDefinition[]; sharing: FakeSharing | undefined };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

async function setup(options: { sharing?: FakeSharing } = {}): Promise<F> {
  const f = await fixture(options.sharing === undefined ? {} : { sharing: options.sharing as unknown as HubSharingService });
  const value: F = { ...f, tools: productToolDefinitions(f.app), sharing: options.sharing };
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

async function run(f: F, name: string, args: Record<string, unknown>, id = 'ordinary-session'): Promise<any> {
  return named(f.tools, name).execute(args, execution(id));
}

function boards(f: F) { return f.store.snapshot().boards; }
function revision(f: F) { return f.store.snapshot().revision; }

describe('task payloads', () => {
  it('keeps the flow record out of every task the tools return', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Recorded task', description: '' });
    await f.store.transact(draft => {
      draft.tasks.find(item => item.id === task.id)!.history = [{ kind: 'created', at: '2026-11-11T09:00:00.000Z', columnId: task.columnId }];
    });
    const listed = await run(f, 'list_cards', { board_id: f.board.id });
    expect(listed.find((value: { id: string }) => value.id === task.id).history).toBeUndefined();
    const read = await run(f, 'get_card', { task_id: task.id });
    expect(read.task.history).toBeUndefined();
    const created = await run(f, 'create_card', { board_id: f.board.id, project_id: f.project.id, title: 'Another', description: '' });
    expect(created.history).toBeUndefined();
    const edited = await run(f, 'edit_card', { task_id: task.id, title: 'Renamed' });
    expect(edited.history).toBeUndefined();
  });
});

describe('board workflow reads', () => {
  it('summarizes a board and includes the Hub revision without the workflow payload', async () => {
    const f = await setup();
    const value = await run(f, 'get_board_summary', { board_id: f.board.id });
    expect(value).toMatchObject({ id: f.board.id, hubId: f.hub.id, hubRevision: revision(f) });
    expect(value.columns.find((column: { id: string }) => column.id === 'backlog').count).toBe(0);
    expect(value.workflowYaml).toBeUndefined();
    expect(value.sharing).toBeUndefined();
  });

  it('returns the parsed workflow, revision, and publishing state on request', async () => {
    const f = await setup();
    const value = await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true });
    expect(value.workflowYaml).toBeUndefined();
    expect((await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml).toBe(f.board.workflowYaml);
    expect(value.workflow.columns.map((column: { id: string }) => column.id)).toEqual(['backlog', 'plan', 'in_progress', 'in_review', 'done']);
    expect(value.initialColumnId).toBe('backlog');
    expect(value.sharing).toMatchObject({ status: 'not-published', bound: false });
  });

  it('rejects an unknown board', async () => {
    const f = await setup();
    await expect(run(f, 'get_board_summary', { board_id: 'missing' })).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
  });

  it('returns groups, entry prompts, and transitions for a grouped workflow', async () => {
    const f = await setup();
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Grouped', workflow_yaml: GROUPED_FLOW });
    const value = await run(f, 'get_board_summary', { board_id: created.id, include_workflow: true });
    expect(value.groups).toEqual([{ id: 'flow', name: 'Flow', columnIds: ['todo', 'done'] }]);
    expect(value.workflow.columns[0]).toMatchObject({ id: 'todo', onEnterPrompt: 'Do it.', allowedTransitions: [{ to: 'done' }] });
  });

  it('reports the board publishing state when the board is bound', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView({ boards: [{ boardId: 'board', name: 'Kanban', state: 'draft', bound: true, pending: false }] });
    const f = await setup({ sharing });
    const value = await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true });
    expect(value.sharing).toMatchObject({ status: 'published', bound: true, boardState: 'draft' });
  });

  it('reads a task conversation board while board writes stay unavailable there', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Read only', description: '' });
    const sessionId = task.sessionIds[0]!;
    const value = await run(f, 'get_board_summary', {}, sessionId);
    expect(value).toMatchObject({ id: f.board.id, hubId: f.hub.id });
    await expect(run(f, 'create_board', { hub_id: f.hub.id, name: 'Forbidden' }, sessionId)).rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
  });

  it('exposes no Hub administration tool', async () => {
    const f = await setup();
    expect(f.tools.some(tool => /^(create|rename|delete)_hub$/.test(tool.name))).toBe(false);
  });
});

describe('board creation tools', () => {
  it('creates a board with the default workflow', async () => {
    const f = await setup();
    const value = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Second' });
    expect(value).toMatchObject({ hubId: f.hub.id, name: 'Second', sharing: { status: 'not-bound' } });
    // The write result stays compact; the document is read through its own tool.
    expect(value.workflowYaml).toBeUndefined();
    expect(boards(f).map(board => board.name)).toEqual(['Kanban', 'Second']);
    const read = await run(f, 'get_board_summary', { board_id: value.id, include_workflow: true });
    expect(read.workflow.columns.map((column: { id: string }) => column.id)).toEqual(['backlog', 'plan', 'in_progress', 'in_review', 'done']);
  });

  it('creates a board with a supplied workflow', async () => {
    const f = await setup();
    const value = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Custom', workflow_yaml: CUSTOM_FLOW });
    expect((await run(f, 'get_board_yaml', { board_id: value.id })).yaml).toBe(CUSTOM_FLOW);
    expect((await run(f, 'get_board_summary', { board_id: value.id, include_workflow: true })).workflow.columns.map((column: { id: string }) => column.id)).toEqual(['todo', 'done']);
  });

  it('rejects a duplicate board name', async () => {
    const f = await setup();
    await run(f, 'create_board', { hub_id: f.hub.id, name: 'Second' });
    await expect(run(f, 'create_board', { hub_id: f.hub.id, name: ' second ' })).rejects.toMatchObject({ code: 'BOARD_NAME_CONFLICT' });
    expect(boards(f)).toHaveLength(2);
  });

  it('reports an invalid workflow without creating a board', async () => {
    const f = await setup();
    const value = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Broken', workflow_yaml: 'columns: []' });
    expect(value.saved).toBe(false);
    expect(value.report.valid).toBe(false);
    expect(value.report.problems[0].message).toContain('at least one column');
    expect(boards(f)).toHaveLength(1);
  });

  it('creates a board without creating a conversation or sending a message', async () => {
    const f = await setup();
    const before = f.sessions.dirs.size;
    await run(f, 'create_board', { hub_id: f.hub.id, name: 'Quiet' });
    expect(f.sessions.dirs.size).toBe(before);
    expect(f.sessions.sent).toEqual([]);
  });

  it('creates a board without a hub identifier when only one Hub exists', async () => {
    const f = await setup();
    const value = await run(f, 'create_board', { name: 'Solo' });
    expect(value.hubId).toBe(f.hub.id);
    expect(boards(f).some(board => board.name === 'Solo')).toBe(true);
  });

  it('requires a Hub for creation when several Hubs exist', async () => {
    const f = await setup();
    await f.app.command({ type: 'hub.create', name: 'Second Hub' });
    await expect(run(f, 'create_board', { name: 'Ambiguous' })).rejects.toMatchObject({ code: 'HUB_CONTEXT_REQUIRED' });
  });

  it('honors cancellation before a board write', async () => {
    const f = await setup();
    const aborted = new AbortController();
    aborted.abort();
    await expect(named(f.tools, 'create_board').execute({ hub_id: f.hub.id, name: 'Aborted' }, { ...execution(), signal: aborted.signal })).rejects.toThrow();
    expect(boards(f)).toHaveLength(1);
  });
});

describe('board update tools', () => {
  it('renames a board without changing its workflow', async () => {
    const f = await setup();
    const value = await run(f, 'update_board', { board_id: f.board.id, name: 'Renamed' });
    expect(value.name).toBe('Renamed');
    expect(value.workflowYaml).toBe(f.board.workflowYaml);
  });

  it('renames a board without touching its tasks, conversations, or messages', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Keep', description: '' });
    const value = await run(f, 'update_board', { board_id: f.board.id, name: 'Renamed' });
    const located = f.app.locator.byTask(task.id);
    expect(value.name).toBe('Renamed');
    expect(located?.task.title).toBe('Keep');
    expect(located?.task.sessionIds).toEqual(task.sessionIds);
    expect(f.sessions.sent).toEqual([]);
  });

  it('rejects renaming a board to another board name', async () => {
    const f = await setup();
    await run(f, 'create_board', { hub_id: f.hub.id, name: 'Second' });
    await expect(run(f, 'update_board', { board_id: f.board.id, name: 'Second' })).rejects.toMatchObject({ code: 'BOARD_NAME_CONFLICT' });
  });

  it('replaces the whole workflow', async () => {
    const f = await setup();
    const value = await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: CUSTOM_FLOW });
    expect(value.workflowYaml).toBeUndefined();
    expect((await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true })).workflow.columns.map((column: { id: string }) => column.id)).toEqual(['todo', 'done']);
  });

  it('requires a name or a workflow', async () => {
    const f = await setup();
    await expect(run(f, 'update_board', { board_id: f.board.id })).rejects.toMatchObject({ code: 'INVALID_EDIT' });
  });

  it('rejects a stale revision', async () => {
    const f = await setup();
    await run(f, 'update_board', { board_id: f.board.id, name: 'First' });
    await expect(run(f, 'update_board', { board_id: f.board.id, name: 'Second', expected_revision: 0 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(boards(f)[0]!.name).toBe('First');
  });

  it('reports a workflow that would orphan a task stage and changes nothing', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Task', description: '' });
    await f.hubs.hub(f.hub.id).transact(draft => { draft.tasks.find(value => value.id === task.id)!.columnId = 'done'; });
    const before = await run(f, 'get_board_yaml', { board_id: f.board.id });
    const value = await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: CUSTOM_FLOW.replace('  - id: done\n    label: Done\n', '') });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('WORKFLOW_ORPHAN_COLUMNS');
    expect(value.report.affectedCards).toContainEqual({ taskId: task.id, stage: 'done', reason: 'stage-removed' });
    expect((await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml).toBe(before.yaml);
  });

  it('rejects a write for a Hub that does not exist', async () => {
    const f = await setup();
    await expect(run(f, 'update_board', { board_id: f.board.id, hub_id: 'other', name: 'No' })).rejects.toMatchObject({ code: 'HUB_NOT_FOUND' });
  });
});

describe('partial workflow edit tools', () => {
  it('adds an entry prompt and preserves unrelated text', async () => {
    const f = await setup();
    const value = await run(f, 'edit_board_yaml', {
      board_id: f.board.id,
      edits: [{ old: '  - id: plan\n    label: Plan\n', new: '  - id: plan\n    label: Plan\n    on_enter_prompt: Plan first.\n' }],
    });
    expect((await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true })).workflow.columns[1].onEnterPrompt).toBe('Plan first.');
  });

  it('applies several edits in order', async () => {
    const f = await setup();
    const value = await run(f, 'edit_board_yaml', {
      board_id: f.board.id,
      edits: [
        { old: '  - id: plan\n    label: Plan\n', new: '  - id: plan\n    label: Planning\n' },
        { old: '    label: Planning\n', new: '    label: Planning\n    allowed_transitions: [backlog]\n' },
      ],
    });
    expect((await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true })).workflow.columns[1].allowedTransitions).toEqual([{ to: 'backlog' }]);
  });

  it('rejects a missing match without changing the board', async () => {
    const f = await setup();
    const value = await run(f, 'edit_board_yaml', { board_id: f.board.id, edits: [{ old: 'label: Missing', new: 'label: Other' }] });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('WORKFLOW_EDIT_NOT_FOUND');
    expect(value.report.valid).toBe(false);
    expect(boards(f)[0]!.workflowYaml).toBe(f.board.workflowYaml);
  });

  it('rejects an ambiguous match without changing the board', async () => {
    const f = await setup();
    const value = await run(f, 'edit_board_yaml', { board_id: f.board.id, edits: [{ old: '    label: ', new: '    label: X' }] });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('WORKFLOW_EDIT_AMBIGUOUS');
    expect(boards(f)[0]!.workflowYaml).toBe(f.board.workflowYaml);
  });

  it('rejects an empty edit collection', async () => {
    const f = await setup();
    const value = await run(f, 'edit_board_yaml', { board_id: f.board.id, edits: [] });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('INVALID_INPUT');
  });

  it('preserves comments outside the replaced span', async () => {
    const f = await setup();
    await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: COMMENTED_FLOW });
    await run(f, 'edit_board_yaml', { board_id: f.board.id, edits: [{ old: '    label: Done', new: '    label: Complete' }] });
    const text = (await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml;
    expect(text).toContain('# Keep this comment');
    expect(text).toContain('label: Complete');
  });
});

describe('board deletion tools', () => {
  it('deletes an empty board and keeps its projects', async () => {
    const f = await setup();
    const value = await run(f, 'delete_board', { board_id: f.board.id, confirmed: true });
    expect(value.id).toBe(f.board.id);
    expect(boards(f)).toHaveLength(0);
    expect(f.store.snapshot().projects).toContainEqual(expect.objectContaining({ id: f.project.id }));
  });

  it('rejects a stale revision on delete', async () => {
    const f = await setup();
    await run(f, 'update_board', { board_id: f.board.id, name: 'Renamed' });
    await expect(run(f, 'delete_board', { board_id: f.board.id, confirmed: true, expected_revision: 0 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(boards(f)).toHaveLength(1);
  });

  it('requires explicit confirmation', async () => {
    const f = await setup();
    await expect(run(f, 'delete_board', { board_id: f.board.id, confirmed: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(boards(f)).toHaveLength(1);
  });

  it('refuses a board with tasks', async () => {
    const f = await setup();
    await f.app.createTask({ projectId: f.project.id, title: 'Task', description: '' });
    await expect(run(f, 'delete_board', { board_id: f.board.id, confirmed: true })).rejects.toMatchObject({ code: 'BOARD_IN_USE' });
    expect(boards(f)).toHaveLength(1);
  });

  it('requires a scope for a team-bound board', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    const f = await setup({ sharing });
    await expect(run(f, 'delete_board', { board_id: f.board.id, confirmed: true })).rejects.toMatchObject({ code: 'SHARING_SCOPE_REQUIRED' });
  });

  it('removes a bound board locally without publishing', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView();
    const f = await setup({ sharing });
    const value = await run(f, 'delete_board', { board_id: f.board.id, confirmed: true, sharing: 'local' });
    expect(value.sharing).toEqual({ status: 'local-only' });
    expect(sharing.removed[0]?.scope).toBe('local');
    expect(sharing.published).toEqual([]);
  });

  it('removes a bound board for the team and publishes it', async () => {
    const sharing = new FakeSharing();
    sharing.bound.add('board');
    sharing.viewValue = sharingView();
    const f = await setup({ sharing });
    const value = await run(f, 'delete_board', { board_id: f.board.id, confirmed: true, sharing: 'team' });
    expect(value.sharing).toEqual({ status: 'published' });
    // A removal is a manifest change, so it publishes the manifest and no board log.
    expect(sharing.published).toEqual([]);
    expect(sharing.publishedManifest).toBe(1);
  });

  it('keeps an unbound board removal local on a published Hub', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    const f = await setup({ sharing });
    const value = await run(f, 'delete_board', { board_id: f.board.id, confirmed: true });
    expect(value.sharing).toEqual({ status: 'local-only' });
    expect(sharing.published).toEqual([]);
  });
});

describe('board write guard', () => {
  it('rejects a subagent descendant of a task conversation before mutating', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Parent', description: '' });
    const child = f.sessions.seedSubagent(task.sessionIds[0]!, 'subagent-1', f.projectPath);
    await expect(run(f, 'create_board', { hub_id: f.hub.id, name: 'Forbidden' }, child)).rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
    expect(boards(f)).toHaveLength(1);
  });

  it('rejects a nested subagent descendant of a task conversation', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Parent', description: '' });
    const child = f.sessions.seedSubagent(task.sessionIds[0]!, 'subagent-1', f.projectPath);
    const grandchild = f.sessions.seedSubagent(child, 'subagent-2', f.projectPath);
    await expect(run(f, 'create_board', { hub_id: f.hub.id, name: 'Nested' }, grandchild)).rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
    expect(boards(f)).toHaveLength(1);
  });

  it('rejects a write without an owning session', async () => {
    const f = await setup();
    const context = { signal: new AbortController().signal, agent: undefined, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
    await expect(named(f.tools, 'create_board').execute({ hub_id: f.hub.id, name: 'No session' }, context)).rejects.toMatchObject({ code: 'MISSING_SESSION' });
  });

  it('rejects edit_board_yaml from a task conversation', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Edit', description: '' });
    await expect(run(f, 'edit_board_yaml', { board_id: f.board.id, edits: [{ old: '    label: Done', new: '    label: Complete' }] }, task.sessionIds[0]!)).rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
    expect(boards(f)[0]!.workflowYaml).toBe(f.board.workflowYaml);
  });

  it('fails closed when the lineage read fails', async () => {
    const f = await setup();
    await taskWithConversation(f.app, { projectId: f.project.id, title: 'Task', description: '' });
    vi.spyOn(f.sessions, 'topology').mockRejectedValueOnce(new Error('topology unavailable'));
    await expect(run(f, 'create_board', { hub_id: f.hub.id, name: 'Forbidden' })).rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
    expect(boards(f)).toHaveLength(1);
  });

  it('rejects update and delete from a task conversation without changing the board', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Task', description: '' });
    const sessionId = task.sessionIds[0]!;
    await expect(run(f, 'update_board', { board_id: f.board.id, name: 'Renamed' }, sessionId)).rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
    await expect(run(f, 'delete_board', { board_id: f.board.id, confirmed: true }, sessionId)).rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
    expect(boards(f)[0]!.name).toBe('Kanban');
  });
});

describe('board tool publishing', () => {
  it('reports an unbound Hub without publishing', async () => {
    const f = await setup();
    const value = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Local' });
    expect(value.sharing).toEqual({ status: 'not-bound' });
  });

  it('publishes after create, update, and edit on an explicit binding', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView();
    const f = await setup({ sharing });
    await run(f, 'create_board', { hub_id: f.hub.id, name: 'Second' });
    await run(f, 'update_board', { board_id: f.board.id, name: 'Renamed' });
    await run(f, 'edit_board_yaml', { board_id: f.board.id, edits: [{ old: '    label: Done', new: '    label: Complete' }] });
    expect(sharing.published).toEqual([expect.any(String), f.board.id, f.board.id]);
  });

  it('publishes a new board even when another board is behind', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView({ updates: 1, boards: [{ boardId: 'board', name: 'Kanban', state: 'updates-available', bound: true, pending: true }] });
    const f = await setup({ sharing });
    const value = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Fresh' });
    // A new board writes only its own log, so another board's pending events do not
    // block it; that board's own writes stay blocked.
    expect(value.sharing).toMatchObject({ status: 'published' });
    expect(boards(f).some(board => board.name === 'Fresh')).toBe(true);
    expect(sharing.published).toHaveLength(1);
  });

  it('keeps a blocked edit local and reports the blocker', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView({ updates: 1, boards: [{ boardId: 'board', name: 'Kanban', state: 'updates-available', bound: true, pending: true }] });
    const f = await setup({ sharing });
    const value = await run(f, 'edit_board_yaml', { board_id: f.board.id, edits: [{ old: '    label: Done', new: '    label: Complete' }] });
    expect(value.sharing).toMatchObject({ status: 'blocked' });
    expect((await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml).toContain('label: Complete');
    expect(sharing.published).toEqual([]);
  });

  it('reports a Hub awaiting review without publishing', async () => {
    const sharing = new FakeSharing();
    sharing.viewValue = sharingView({ status: 'preview' });
    const f = await setup({ sharing });
    const value = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Preview' });
    expect(value.sharing).toEqual({ status: 'preview' });
    expect(sharing.published).toEqual([]);
  });
});

describe('the board default model', () => {
  it('states the model a board names and the absence of one', async () => {
    const f = await setup();
    const named = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Modelled', workflow_yaml: MODEL_FLOW });
    const withModel = await run(f, 'get_board_summary', { board_id: named.id, include_workflow: true });
    expect(withModel.defaultModel).toEqual({ provider: 'deepseek', model: 'chat', reasoningEffort: 'high' });
    expect(withModel.workflow.model).toEqual({ provider: 'deepseek', model: 'chat', reasoningEffort: 'high' });
    const withoutModel = await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true });
    expect(withoutModel.defaultModel).toBeNull();
    expect(withoutModel.workflow.model).toBeUndefined();
  });

  it('sets the model through a replacement workflow', async () => {
    const f = await setup();
    await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: MODEL_FLOW });
    const value = await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true });
    expect(value.defaultModel).toEqual({ provider: 'deepseek', model: 'chat', reasoningEffort: 'high' });
    expect((await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml).toBe(MODEL_FLOW);
  });

  it('clears the model when the replacement workflow omits it', async () => {
    const f = await setup();
    await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: MODEL_FLOW });
    await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: CUSTOM_FLOW });
    const value = await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true });
    expect(value.defaultModel).toBeNull();
    expect(value.workflow.model).toBeUndefined();
  });

  it('rejects a malformed model mapping and leaves the board unchanged', async () => {
    const f = await setup();
    await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: MODEL_FLOW });
    const before = await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true });
    const value = await run(f, 'update_board', { board_id: f.board.id, workflow_yaml: MALFORMED_MODEL_FLOW });
    expect(value.saved).toBe(false);
    expect(value.report.problems[0].message).toContain('temperature');
    const after = await run(f, 'get_board_summary', { board_id: f.board.id, include_workflow: true });
    expect(after).toEqual(before);
    expect((await run(f, 'get_board_yaml', { board_id: f.board.id })).yaml).toBe(MODEL_FLOW);
  });

  it('guides the agent to the model mapping before it writes a workflow', async () => {
    const f = await setup();
    const create = named(f.tools, 'create_board');
    const update = named(f.tools, 'update_board');
    const summary = named(f.tools, 'get_board_summary');
    const described = (tool: ToolDefinition, parameter: string): string =>
      String((tool.parameters as { properties?: Record<string, { description?: string }> }).properties?.[parameter]?.description ?? '');
    expect(described(create, 'workflow_yaml')).toContain('board default model');
    expect(described(update, 'workflow_yaml')).toContain('defaultModel');
    expect(summary.description).toContain("board's default model");
  });
});