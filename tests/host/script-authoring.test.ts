import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { fixture } from './helpers.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
type F = Fixture & { tools: ToolDefinition[] };
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

const SCRIPTED = [
  'name: Scripted',
  'initial_column: todo',
  'columns:',
  '  - id: todo',
  '    label: Todo',
  '  - id: check',
  '    label: Check',
  '    deterministic:',
  '      language: bash',
  '      directory: task',
  '      # keep this comment',
  '      code: |',
  '        echo hello',
  '      params:',
  '        - name: pipeline',
  '          description: Pipeline identifier.',
  '      exits: {passed: done, error: todo}',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

async function boardWith(f: F, name: string, yaml: string): Promise<string> {
  const created = await run(f, 'create_board', { hub_id: f.hub.id, name, workflow_yaml: yaml });
  expect(created.saved).toBe(true);
  return created.id;
}

/** One stage block with its program source field removed, so only the changed field may differ. */
function withoutSource(block: string): string {
  const lines = block.split('\n');
  const index = lines.findIndex(line => /^\s*code:/.test(line));
  if (index < 0) return block;
  const indent = /^\s*/.exec(lines[index]!)![0].length;
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (line.trim().length === 0) { end += 1; continue; }
    if (/^\s*/.exec(line)![0].length <= indent) break;
    end += 1;
  }
  return [...lines.slice(0, index), 'code: <source>', ...lines.slice(end)].join('\n');
}

async function stageBlock(f: F, boardId: string, stageId: string): Promise<string> {
  return (await run(f, 'get_stage', { board_id: boardId, stage_id: stageId, include_code: true })).yaml;
}

describe('stage script writes', () => {
  it('creates a scripted stage from the parts it names', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Bare', ['name: Bare', 'initial_column: todo', 'columns:', '  - id: todo', '    label: Todo', '  - id: done', '    label: Done', ''].join('\n'));
    const value = await run(f, 'set_stage_script', {
      board_id: boardId, stage_id: 'todo', language: 'typescript', code: 'return { exit: "passed", message: "ok" }', exits: { passed: 'done' },
    });
    expect(value.saved).toBe(true);
    const workflow = (await run(f, 'get_board_summary', { board_id: boardId, include_workflow: true })).workflow;
    const column = workflow.columns.find((value: { id: string }) => value.id === 'todo');
    expect(column.deterministic).toMatchObject({ language: 'typescript', directory: 'task', exits: { passed: 'done' } });
    expect(column.deterministic.code).toContain('return { exit: "passed"');
  });

  it('rewrites only the program source and keeps the comment and every other part', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Scripted', SCRIPTED);
    const before = await stageBlock(f, boardId, 'check');
    const value = await run(f, 'set_stage_script', { board_id: boardId, stage_id: 'check', code: 'echo changed' });
    expect(value.saved).toBe(true);
    const after = await stageBlock(f, boardId, 'check');
    expect(after).toContain('# keep this comment');
    expect(after).toContain('echo changed');
    expect(after).not.toContain('echo hello');
    expect(after).toContain('pipeline');
    expect(after).toContain('passed: done');
    expect(withoutSource(after)).toBe(withoutSource(before));
  });

  it('adds a declared parameter without touching the source', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Scripted', SCRIPTED);
    await run(f, 'set_stage_script', { board_id: boardId, stage_id: 'check', params: [{ name: 'pipeline' }, { name: 'app' }] });
    const workflow = (await run(f, 'get_board_summary', { board_id: boardId, include_workflow: true })).workflow;
    const column = workflow.columns.find((value: { id: string }) => value.id === 'check');
    expect(column.deterministic.params.map((parameter: { name: string }) => parameter.name)).toEqual(['pipeline', 'app']);
    expect(column.deterministic.code).toContain('echo hello');
    expect(column.deterministic.exits).toEqual({ passed: 'done', error: 'todo' });
  });

  it('clears the environment names with an empty list', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Scripted', SCRIPTED.replace('      directory: task', '      directory: task\n      env: [CI_TOKEN]'));
    await run(f, 'set_stage_script', { board_id: boardId, stage_id: 'check', env: [] });
    expect(await stageBlock(f, boardId, 'check')).not.toContain('CI_TOKEN');
  });

  it('rejects naming two sources at once', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Scripted', SCRIPTED);
    const value = await run(f, 'set_stage_script', { board_id: boardId, stage_id: 'check', code: 'echo a', file: 'check.sh' });
    expect(value).toMatchObject({ saved: false, error: { code: 'INVALID_INPUT' } });
    expect((await stageBlock(f, boardId, 'check'))).toContain('echo hello');
  });

  it('requires the parts a stage with no script cannot omit', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Bare', ['name: Bare', 'initial_column: todo', 'columns:', '  - id: todo', '    label: Todo', '  - id: done', '    label: Done', ''].join('\n'));
    expect(await run(f, 'set_stage_script', { board_id: boardId, stage_id: 'todo', code: 'echo x', exits: { passed: 'done' } })).toMatchObject({ saved: false, error: { code: 'INVALID_INPUT' } });
    expect(await run(f, 'set_stage_script', { board_id: boardId, stage_id: 'todo', language: 'bash', code: 'echo x' })).toMatchObject({ saved: false, error: { code: 'INVALID_INPUT' } });
    expect((await stageBlock(f, boardId, 'todo'))).not.toContain('deterministic');
  });

  it('reports an unknown exit destination as a refused write', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Scripted', SCRIPTED);
    const value = await run(f, 'set_stage_script', { board_id: boardId, stage_id: 'check', exits: { passed: 'missing' } });
    expect(value.saved).toBe(false);
    expect(value.report.valid).toBe(false);
  });

  it('scopes a literal edit to one of two stages carrying the same sentence', async () => {
    const f = await setup();
    const text = [
      'name: Twice', 'initial_column: a', 'columns:',
      '  - id: a', '    label: A', '    on_enter_prompt: |', '      Exit code 4 means the space is not configured.',
      '  - id: b', '    label: B', '    on_enter_prompt: |', '      Exit code 4 means the space is not configured.',
      '',
    ].join('\n');
    const boardId = await boardWith(f, 'Twice', text);
    const ambiguous = await run(f, 'edit_board_yaml', { board_id: boardId, edits: [{ old: 'Exit code 4 means the space is not configured.', new: 'x' }] });
    expect(ambiguous).toMatchObject({ saved: false, error: { code: 'WORKFLOW_EDIT_AMBIGUOUS' } });
    expect(ambiguous.details).toMatchObject({ index: 0, occurrences: 2, lineNumbers: [7, 11], stages: ['a', 'b'] });
    const scoped = await run(f, 'edit_board_yaml', { board_id: boardId, edits: [{ old: 'Exit code 4 means the space is not configured.', new: 'Only here.', stage: 'b' }] });
    expect(scoped.saved).toBe(true);
    expect(await stageBlock(f, boardId, 'a')).toContain('Exit code 4 means the space is not configured.');
    expect(await stageBlock(f, boardId, 'b')).toContain('Only here.');
  });

  it('reports the failing edit index and the closest line for a copied line break', async () => {
    const f = await setup();
    const boardId = await boardWith(f, 'Scripted', SCRIPTED);
    const value = await run(f, 'edit_board_yaml', {
      board_id: boardId,
      edits: [
        { old: 'label: Done', new: 'label: Complete' },
        { old: 'echo hello\n      parameters', new: 'echo hello\n      params' },
      ],
    });
    expect(value).toMatchObject({ saved: false, error: { code: 'WORKFLOW_EDIT_NOT_FOUND' } });
    expect(value.details).toMatchObject({ index: 1, occurrences: 0 });
    expect(value.details.closest.text).toContain('echo hello');
  });
});
