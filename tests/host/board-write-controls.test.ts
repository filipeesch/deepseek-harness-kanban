import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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

async function document(f: F, boardId?: string): Promise<string> {
  const first = await run(f, 'get_board_yaml', boardId === undefined ? {} : { board_id: boardId });
  let text = first.yaml as string;
  let offset = first.nextOffset as number | undefined;
  while (offset !== undefined) {
    const page = await run(f, 'get_board_yaml', { ...(boardId === undefined ? {} : { board_id: boardId }), offset });
    text += '\n' + page.yaml;
    offset = page.nextOffset;
  }
  return text;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A board whose one scripted stage carries a source large enough to dominate a full report. */
function largeFlow(stages = 30, sourceBytes = 100 * 1024): string {
  const lines = ['name: Large', 'initial_column: stage-0', 'columns:'];
  for (let index = 0; index < stages; index += 1) {
    if (index === 1) {
      lines.push('  - id: stage-1', '    label: Scripted', '    deterministic:', '      language: bash', '      directory: task', '      exits: {passed: stage-2}', '      code: |', '        echo marker');
      const body = 'echo ' + 'x'.repeat(80);
      for (let written = 0; written < sourceBytes; written += body.length + 1) lines.push('        ' + body);
      continue;
    }
    lines.push('  - id: stage-' + index, '    label: Stage ' + index, '    on_enter_prompt: |', '      Work on stage ' + index + '.');
  }
  return lines.join('\n') + '\n';
}

describe('workflow write controls', () => {
  it('declares the digest, dry review, and detail controls on every workflow write', async () => {
    const f = await setup();
    for (const name of ['create_board', 'update_board', 'edit_board_yaml', 'set_stage_prompt', 'set_stage_routes', 'set_layout', 'add_stage', 'remove_stage']) {
      const properties = (named(f.tools, name).parameters as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(properties)).toEqual(expect.arrayContaining(['expect_sha256', 'dry_run', 'detail']));
    }
  });

  it('reports the digest of exactly the bytes it stored', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Digest board', workflow_yaml: largeFlow(3, 0) })).id;
    const value = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'Changed instruction.' });
    expect(value.saved).toBe(true);
    expect(value.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(await document(f, boardId))).toBe(value.sha256);
  });

  it('refuses a write whose document does not match the expected digest and saves nothing', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Mismatch board', workflow_yaml: largeFlow(3, 0) })).id;
    const before = await document(f, boardId);
    const revision = f.store.snapshot().revision;
    const value = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'Changed.', expect_sha256: 'a'.repeat(64) });
    expect(value).toMatchObject({ saved: false, error: { code: 'EXPECTED_SHA256_MISMATCH' }, expected: 'a'.repeat(64) });
    expect(value.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(await document(f, boardId)).toBe(before);
    expect(f.store.snapshot().revision).toBe(revision);
  });

  it('accepts a write whose document matches the expected digest', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Expected board', workflow_yaml: largeFlow(3, 0) })).id;
    const dry = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'Expected.', dry_run: true });
    const value = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'Expected.', expect_sha256: dry.sha256 });
    expect(value.saved).toBe(true);
    expect(value.sha256).toBe(dry.sha256);
  });

  it('reviews a write without saving anything and produces the same report', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Dry board', workflow_yaml: largeFlow(3, 0) })).id;
    const before = await document(f, boardId);
    const revision = f.store.snapshot().revision;
    const dry = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'Reviewed.', dry_run: true });
    expect(dry).toMatchObject({ saved: false, dryRun: true, report: { valid: true, mode: 'summary' } });
    expect(await document(f, boardId)).toBe(before);
    expect(f.store.snapshot().revision).toBe(revision);
    const real = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'Reviewed.' });
    expect(real.report).toEqual(dry.report);
    expect(real.sha256).toBe(dry.sha256);
  });

  it('keeps the changed field text out of the summary and returns it in the full report', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Shape board', workflow_yaml: largeFlow(3, 0) })).id;
    const summary = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'A distinct instruction body.' });
    expect(summary.report.mode).toBe('summary');
    expect(summary.report.difference).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain('A distinct instruction body.');
    expect(summary.report.stages).toEqual([{ stage: 'stage-0', change: 'changed', fields: ['onEnterPrompt'] }]);
    expect(summary.report.sizes).toEqual([{ stage: 'stage-0', instructionChars: 28, instructionBytes: 28, instructionTokensEstimate: 7 }]);
    const full = await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'stage-0', prompt: 'Another instruction body.', detail: 'full' });
    expect(JSON.stringify(full)).toContain('Another instruction body.');
    expect(full.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bounds the summary of a large document and keeps the full report available', async () => {
    const f = await setup();
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Huge board', workflow_yaml: largeFlow(30, 100 * 1024) });
    const boardId = created.id;
    const summary = await run(f, 'edit_board_yaml', { board_id: boardId, edits: [{ old: 'echo marker', new: 'echo marker changed' }] });
    expect(summary.saved).toBe(true);
    expect(JSON.stringify(summary).length).toBeLessThan(30_000);
    expect(summary.report.stages).toEqual([{ stage: 'stage-1', change: 'changed', fields: ['deterministic'] }]);
    expect(summary.report.sizes).toEqual([{ stage: 'stage-1', sourceBytes: expect.any(Number) }]);
    expect(JSON.stringify(summary)).not.toContain('echo marker changed');
    const full = await run(f, 'edit_board_yaml', { board_id: boardId, edits: [{ old: 'echo marker changed', new: 'echo marker again' }], detail: 'full' });
    expect(JSON.stringify(full).length).toBeGreaterThan(100_000);
    expect(JSON.stringify(full)).toContain('echo marker again');
  });

  it('applies a write whose revision moved because a task moved on another board', async () => {
    const f = await setup();
    const first = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'First board', workflow_yaml: largeFlow(3, 0) })).id;
    const second = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Second board' })).id;
    const stale = (await run(f, 'get_board_yaml', { board_id: first })).hubRevision;
    const task = await f.app.createTask({ boardId: second, projectId: f.project.id, title: 'Moves elsewhere', description: '' });
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan' });
    expect(f.store.snapshot().revision).toBeGreaterThan(stale);
    const value = await run(f, 'set_stage_prompt', { board_id: first, stage_id: 'stage-0', prompt: 'Applied after the move.', expected_revision: stale });
    expect(value.saved).toBe(true);
    expect(await document(f, first)).toContain('Applied after the move.');
  });

  it('refuses the controls on a rename that carries no workflow document', async () => {
    const f = await setup();
    await expect(run(f, 'update_board', { board_id: f.board.id, name: 'Renamed', dry_run: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('write report observations', () => {
  const PROSE_FLOW = [
    'name: Prose', 'initial_column: backlog', 'columns:',
    '  - id: backlog', '    label: Backlog', '    allowed_transitions: [explore]',
    '  - id: explore', '    label: Explore', '    allowed_transitions: [done]', '    on_enter_prompt: |',
    '      The backlog and the scope are discussed here. Route to the review queue, then go to nothing.',
    '  - id: scope', '    label: Scope', '    allowed_transitions: [done]',
    '  - id: done', '    label: Done',
    '',
  ].join('\n');

  const PARAMETER_FLOW = [
    'name: Parameterized', 'initial_column: todo', 'columns:',
    '  - id: todo', '    label: Todo', '    allowed_transitions: [check]', '    on_enter_prompt: Send the work on without naming the required value.',
    '  - id: check', '    label: Check', '    deterministic:', '      language: bash', '      code: echo hi', '      params:', '        - name: pipeline', '      exits: {passed: done}',
    '  - id: done', '    label: Done',
    '',
  ].join('\n');

  it('reports prose words as observations and never as routing defects', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Prose board', workflow_yaml: PROSE_FLOW })).id;
    const value = await run(f, 'edit_board_yaml', { board_id: boardId, edits: [{ old: 'label: Scope', new: 'label: Scope work' }] });
    const kinds = value.report.warnings.map((warning: { kind: string }) => warning.kind);
    expect(kinds).not.toContain('instruction-names-unknown-stage');
    expect(kinds).not.toContain('instruction-names-unpermitted-stage');
    const mentions = value.report.warnings.filter((warning: { kind: string }) => warning.kind === 'instruction-mentions-stage').map((warning: { reference: string }) => warning.reference).sort();
    expect(mentions).toEqual(['backlog', 'nothing', 'scope', 'the']);
  });

  it('reports a destination parameter the origin instruction never names', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Parameter board', workflow_yaml: PARAMETER_FLOW })).id;
    const value = await run(f, 'edit_board_yaml', { board_id: boardId, edits: [{ old: 'label: Todo', new: 'label: To do' }] });
    expect(value.report.warnings).toContainEqual({ kind: 'destination-parameter-unmentioned', stage: 'todo', destination: 'check', parameter: 'pipeline' });
  });

  it('reports a card parked in a stage whose parameters it does not have', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Card board', workflow_yaml: PARAMETER_FLOW })).id;
    const task = await f.app.createTask({ boardId, projectId: f.project.id, title: 'Left behind', description: '' });
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.columnId = 'check'; });
    const value = await run(f, 'edit_board_yaml', { board_id: boardId, edits: [{ old: 'label: Done', new: 'label: Complete' }] });
    expect(value.report.warnings).toContainEqual({ kind: 'card-missing-parameters', stage: 'check', taskId: task.id, parameters: ['pipeline'] });
  });

});
