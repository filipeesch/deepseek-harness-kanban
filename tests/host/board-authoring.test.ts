import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { fixture } from './helpers.js';

const COMMENTED = `# Keep this comment
name: Custom
initial_column: todo
columns:
  - id: todo
    label: Todo
    # the first stage keeps its note
    on_enter_prompt: Do the work.
    allowed_transitions: [review]
  - id: review
    label: Review
    allowed_transitions: []
  - id: wait
    label: Wait
    deterministic:
      language: bash
      code: |
        echo waiting
      exits: {passed: review}
`;

const LINKED = `name: Linked
initial_column: todo
columns:
  - id: todo
    label: Todo
    allowed_transitions: [review, done]
  - id: review
    label: Review
    allowed_transitions: [done]
  - id: done
    label: Done
groups:
  - id: flow
    label: Flow
    columns: [todo, review, done]
connections:
  - from: review
    to: todo
    source: {side: right, at: 2}
`;

type F = Awaited<ReturnType<typeof fixture>> & { tools: ToolDefinition[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

async function setup(): Promise<F> {
  const f = await fixture();
  const value: F = { ...f, tools: productToolDefinitions(f.app) };
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

async function boardWith(f: F, yaml: string): Promise<string> {
  const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Authored ' + Math.random().toString(36).slice(2, 8), workflow_yaml: yaml });
  expect(created.saved).toBeUndefined();
  return created.id;
}

async function authoredDocument(f: F, boardId: string): Promise<string> {
  return (await run(f, 'get_board_yaml', { board_id: boardId })).yaml;
}

describe('exact workflow document reads', () => {
  it('returns the authored document character for character with the Hub revision', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'get_board_yaml', { board_id: boardId });
    expect(value.yaml).toBe(COMMENTED);
    expect(value.totalLines).toBe(COMMENTED.split('\n').length);
    expect(value.hubRevision).toBe(f.store.snapshot().revision);
    expect(await readFile(value.path, 'utf8')).toBe(COMMENTED);
  });

  it('continues a paged read without a gap or a repeat', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const lines = COMMENTED.split('\n');
    const first = await run(f, 'get_board_yaml', { board_id: boardId, offset: 0, limit: 4 });
    expect(first.yaml).toBe(lines.slice(0, 4).join('\n'));
    expect(first.nextOffset).toBe(4);
    const second = await run(f, 'get_board_yaml', { board_id: boardId, offset: first.nextOffset, limit: 4 });
    expect(second.yaml).toBe(lines.slice(4, 8).join('\n'));
  });

  it('reads without changing the board', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const before = f.store.snapshot().revision;
    await run(f, 'get_board_yaml', { board_id: boardId });
    expect(f.store.snapshot().revision).toBe(before);
  });

  it('rejects an unknown board', async () => {
    const f = await setup();
    await expect(run(f, 'get_board_yaml', { board_id: 'missing' })).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
  });
});

describe('single-stage reads', () => {
  it('returns the authored block with the inline source withheld', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'get_stage', { board_id: boardId, stage_id: 'wait' });
    expect(value.yaml).toContain('id: wait');
    expect(value.yaml).toContain('exits: {passed: review}');
    expect(value.yaml).not.toContain('echo waiting');
    expect(value.yaml).toContain('<source withheld sha256:');
    expect(value.source).toMatchObject({ kind: 'inline', bytes: 'echo waiting\n'.length });
    expect(value.source.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('returns the authored source on request', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'get_stage', { board_id: boardId, stage_id: 'wait', include_code: true });
    expect(value.yaml).toContain('echo waiting');
  });

  it('preserves the authored block of a stage without a script', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'get_stage', { board_id: boardId, stage_id: 'todo' });
    expect(value.yaml).toContain('# the first stage keeps its note');
    expect(value.yaml).toContain('on_enter_prompt: Do the work.');
    expect(value.source).toBeUndefined();
  });

  it('rejects an unknown stage', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    await expect(run(f, 'get_stage', { board_id: boardId, stage_id: 'ghost' })).rejects.toMatchObject({ code: 'STAGE_NOT_FOUND' });
  });

  it('withholds the source of a flow-style column too', async () => {
    const f = await setup();
    const flow = "name: Flow\ninitial_column: wait\ncolumns: [{id: wait, label: Wait, deterministic: {language: bash, code: 'echo secret', directory: project, exits: {passed: done}}}, {id: done, label: Done}]\n";
    const boardId = await boardWith(f, flow);
    const value = await run(f, 'get_stage', { board_id: boardId, stage_id: 'wait' });
    expect(value.yaml).not.toContain('echo secret');
    expect(value.yaml).toContain('<source withheld sha256:');
    expect((await run(f, 'get_stage', { board_id: boardId, stage_id: 'wait', include_code: true })).yaml).toContain('echo secret');
  });
});

describe('stage instructions', () => {
  it('sets and clears one instruction while keeping a neighbouring comment', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const set = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'Do it carefully.' });
    expect(set.saved).toBeUndefined();
    expect(set.report.valid).toBe(true);
    let text = await authoredDocument(f, boardId);
    expect(text).toContain('# the first stage keeps its note');
    expect(text).toContain('on_enter_prompt: Do it carefully.');
    const cleared = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: null });
    expect(cleared.report.difference?.stages).toContainEqual({ stage: 'todo', change: 'changed', fields: [{ field: 'onEnterPrompt', from: 'Do it carefully.', to: null }] });
    text = await authoredDocument(f, boardId);
    expect(text).not.toContain('on_enter_prompt');
    expect(text).toContain('# the first stage keeps its note');
  });

  it('rejects a stale revision without changing the document', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const before = await authoredDocument(f, boardId);
    await expect(run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'todo', prompt: 'x', expected_revision: 0 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await authoredDocument(f, boardId)).toBe(before);
  });
});

describe('stage routes', () => {
  it('writes transitions with a condition', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'todo', transitions: [{ to: 'review', when: 'when the checks pass' }, 'wait'] });
    expect(value.report.valid).toBe(true);
    const text = await authoredDocument(f, boardId);
    expect(text).toContain('when: when the checks pass');
    expect((await run(f, 'get_stage', { board_id: boardId, stage_id: 'todo' })).yaml).toContain('wait');
  });

  it('changes only the routed field, character for character', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    await run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'review', transitions: ['todo'] });
    expect(await authoredDocument(f, boardId)).toBe(COMMENTED.replace('    allowed_transitions: []', '    allowed_transitions: [{to: todo}]'));
  });

  it('distinguishes an empty list from an omitted one', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    await run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'review', transitions: [] });
    expect((await run(f, 'get_stage', { board_id: boardId, stage_id: 'review' })).yaml).toContain('allowed_transitions: []');
    await run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'review', permit_any: true });
    expect((await run(f, 'get_stage', { board_id: boardId, stage_id: 'review' })).yaml).not.toContain('allowed_transitions');
  });

  it('retargets a named exit without touching the source', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'wait', exits: { passed: 'todo' } });
    expect(value.report.valid).toBe(true);
    expect(value.report.scripts).toEqual([]);
    const text = await authoredDocument(f, boardId);
    expect(text).toContain('exits: {passed: todo}');
    expect(text).toContain('echo waiting');
  });

  it('refuses the wrong kind of routes for a stage', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    await expect(run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'wait', transitions: ['review'] })).rejects.toMatchObject({ code: 'INVALID_ROUTES' });
    await expect(run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'todo', exits: { passed: 'review' } })).rejects.toMatchObject({ code: 'INVALID_ROUTES' });
  });

  it('reports an unknown destination as a refused write', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'set_stage_routes', { board_id: boardId, stage_id: 'todo', transitions: ['ghost'] });
    expect(value.saved).toBe(false);
    expect(value.report.valid).toBe(false);
  });
});

describe('layout', () => {
  it('writes and clears placements and sizes without touching the rest', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    await run(f, 'set_layout', { board_id: boardId, positions: { review: { x: 40, y: 20 } }, sizes: { review: { width: 320, height: 220 } } });
    let text = await authoredDocument(f, boardId);
    expect(text).toContain('position: {x: 40, y: 20}');
    expect(text).toContain('size: {width: 320, height: 220}');
    expect(text).toContain('# the first stage keeps its note');
    await run(f, 'set_layout', { board_id: boardId, positions: { review: null }, sizes: { review: null } });
    text = await authoredDocument(f, boardId);
    expect(text).not.toContain('position:');
    expect(text).not.toContain('size:');
  });

  it('writes and removes a connection layout', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    await run(f, 'set_layout', { board_id: boardId, connections: [{ from: 'review', to: 'todo', source: { side: 'right', at: 3 }, segments: [{ axis: 'x', offset: 12 }] }] });
    let text = await authoredDocument(f, boardId);
    expect(text).toContain('at: 3');
    expect(text).toContain('offset: 12');
    await run(f, 'set_layout', { board_id: boardId, connections: [{ from: 'review', to: 'todo', remove: true }] });
    text = await authoredDocument(f, boardId);
    expect(text).not.toContain('connections:');
  });

  it('reports an unknown stage as a refused write', async () => {
    const f = await setup();
    const boardId = await boardWith(f, COMMENTED);
    const value = await run(f, 'set_layout', { board_id: boardId, positions: { ghost: { x: 1, y: 2 } } });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('INVALID_INPUT');
  });
});

describe('adding and removing stages', () => {
  it('inserts a stage after a named stage', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    const value = await run(f, 'add_stage', { board_id: boardId, after: 'review', stage_yaml: 'id: deploy\nlabel: Deploy\nallowed_transitions: [done]' });
    expect(value.report.valid).toBe(true);
    expect(value.report.difference?.stages).toContainEqual({ stage: 'deploy', change: 'added' });
    const workflow = (await run(f, 'get_board_summary', { board_id: boardId, include_workflow: true })).workflow;
    expect(workflow.columns.map((column: { id: string }) => column.id)).toEqual(['todo', 'review', 'deploy', 'done']);
  });

  it('appends a stage at the end', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    await run(f, 'add_stage', { board_id: boardId, stage_yaml: '  - id: archive\n    label: Archive' });
    const workflow = (await run(f, 'get_board_summary', { board_id: boardId, include_workflow: true })).workflow;
    expect(workflow.columns.map((column: { id: string }) => column.id)).toEqual(['todo', 'review', 'done', 'archive']);
  });

  it('reports an unknown neighbour as a refused write', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    const value = await run(f, 'add_stage', { board_id: boardId, after: 'ghost', stage_yaml: 'id: deploy\nlabel: Deploy' });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('STAGE_NOT_FOUND');
    expect(value.report.valid).toBe(false);
  });

  it('refuses a duplicate identifier through the report', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    const value = await run(f, 'add_stage', { board_id: boardId, stage_yaml: 'id: done\nlabel: Again' });
    expect(value.saved).toBe(false);
    expect(value.report.valid).toBe(false);
  });

  it('removes a stage together with its references', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    const value = await run(f, 'remove_stage', { board_id: boardId, stage_id: 'done', confirmed: true });
    expect(value.report.valid).toBe(true);
    const text = await authoredDocument(f, boardId);
    expect(text).not.toContain('id: done');
    expect(text).not.toContain('[review, done]');
    expect(text).toContain('columns: ["todo","review"]');
    const workflow = (await run(f, 'get_board_summary', { board_id: boardId, include_workflow: true })).workflow;
    expect(workflow.columns.map((column: { id: string }) => column.id)).toEqual(['todo', 'review']);
  });

  it('removes a connection that drew the stage', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    await run(f, 'remove_stage', { board_id: boardId, stage_id: 'todo', confirmed: true, replacement_initial: 'review' });
    const text = await authoredDocument(f, boardId);
    expect(text).not.toContain('connections:');
    expect(text).toContain('initial_column: review');
  });

  it('reports an initial stage without a replacement as a refused write', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    const value = await run(f, 'remove_stage', { board_id: boardId, stage_id: 'todo', confirmed: true });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('INITIAL_STAGE_REQUIRED');
    expect(value.report.problems[0].message).toContain('initial');
    expect(await authoredDocument(f, boardId)).toContain('initial_column: todo');
  });

  it('removes the last group with the stage that was its only member', async () => {
    const f = await setup();
    const single = LINKED.replace('    columns: [todo, review, done]', '    columns: [done]');
    const boardId = await boardWith(f, single);
    const value = await run(f, 'remove_stage', { board_id: boardId, stage_id: 'done', confirmed: true });
    expect(value.report.valid).toBe(true);
    const text = await authoredDocument(f, boardId);
    expect(text).not.toContain('groups:');
    expect((await run(f, 'get_board_summary', { board_id: boardId, include_workflow: true })).workflow.groups).toEqual([]);
  });

  it('refuses without confirmation', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    await expect(run(f, 'remove_stage', { board_id: boardId, stage_id: 'done' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('refuses a stage that still holds cards and names them without their text', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LINKED);
    const task = await f.app.createTask({ projectId: f.project.id, boardId, title: 'Secret title', description: 'Secret description' });
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.columnId = 'done'; });
    const value = await run(f, 'remove_stage', { board_id: boardId, stage_id: 'done', confirmed: true });
    expect(value.saved).toBe(false);
    expect(value.error.code).toBe('STAGE_HAS_CARDS');
    expect(value.report.affectedCards).toEqual([{ taskId: task.id, stage: 'done', reason: 'stage-removed' }]);
    expect(JSON.stringify(value)).not.toContain('Secret title');
    expect(JSON.stringify(value)).not.toContain('Secret description');
    expect((await run(f, 'get_board_summary', { board_id: boardId, include_workflow: true })).workflow.columns.map((column: { id: string }) => column.id)).toEqual(['todo', 'review', 'done']);
  });
});