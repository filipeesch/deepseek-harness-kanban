import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { batchTools } from '../../src/host/tools/batch.js';
import { BoardAdministration } from '../../src/host/board-administration.js';
import { WorkflowPreviewStore } from '../../src/host/workflow-preview-store.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { fixture, taskWithConversation } from './helpers.js';

const FLOW = `# Authored board, kept exactly as written
name: Batch flow
initial_column: intake
columns:
  - id: intake
    label: Intake
    description: Receive the request.
    on_enter_prompt: Read the request.
    allowed_transitions: [triage]
    position: {x: 0, y: 0}
    size: {width: 420, height: 260}
  # triage keeps its own note
  - id: triage
    label: Triage
    description: Route the request.
    allowed_transitions: [done]
  - id: done
    label: Done
    description: Delivered.
`;

const SCRIPTED_FLOW = `name: Scripted flow
initial_column: intake
columns:
  - id: intake
    label: Intake
    description: Receive the request.
    allowed_transitions: [wait]
  - id: wait
    label: Wait
    description: Wait for the run.
    scripted:
      language: bash
      code: |
        echo waiting
      exits: {passed: done}
  - id: done
    label: Done
    description: Delivered.
`;

const COORDINATED = [
  { op: 'set_agent', agent_id: 'triage', name: 'Triage Agent', preset: 'kanban-workflow-operator', model_provider: 'deepseek', model_name: 'reason' },
  { op: 'set_stage_agent', stage_id: 'triage', agent_id: 'triage' },
  { op: 'set_stage_prompt', stage_id: 'triage', prompt: 'Decide where the request goes and declare the next stage.' },
  { op: 'set_stage_routes', stage_id: 'triage', transitions: [{ to: 'done', when: 'the request is delivered.' }] },
];

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A promise whose two ends are returned, for suspending one awaited hook. */
interface Suspension { readonly entered: Promise<void>; readonly gate: Promise<void>; readonly enter: () => void; readonly release: () => void }
function suspended(): Suspension {
  let enter: () => void = () => {};
  let release: () => void = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { entered, gate, enter, release };
}

type F = Awaited<ReturnType<typeof fixture>> & { tools: ToolDefinition[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

function execution(id = 'ordinary-session'): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}
function named(tools: ToolDefinition[], name: string): ToolDefinition {
  const definition = tools.find(candidate => candidate.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

async function setup(options: Parameters<typeof fixture>[0] = {}): Promise<F> {
  const f = await fixture(options);
  const value: F = { ...f, tools: productToolDefinitions(f.app) };
  active.push(value);
  return value;
}

function run(f: F, name: string, args: Record<string, unknown>, session = 'ordinary-session'): Promise<any> {
  return named(f.tools, name).execute(args, execution(session));
}

async function boardWith(f: F, yaml = FLOW): Promise<string> {
  const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Batch ' + Math.random().toString(36).slice(2, 8), workflow_yaml: yaml });
  expect(created.saved).toBe(true);
  return created.id;
}

async function document(f: F, boardId: string): Promise<{ yaml: string; hubRevision: number; boardName: string }> {
  const value = await run(f, 'get_board_yaml', { board_id: boardId });
  const summary = await run(f, 'get_workflow_summary', { board_id: boardId });
  const board = summary.records.find((record: any) => record.kind === 'workflow');
  return { yaml: value.yaml, hubRevision: value.hubRevision, boardName: board.board.name };
}

async function preview(f: F, boardId: string, operations: readonly unknown[], extra: Record<string, unknown> = {}): Promise<any> {
  const current = await document(f, boardId);
  return run(f, 'preview_workflow_batch', { board_id: boardId, expected_revision: current.hubRevision, operations, ...extra });
}

/** One part of a preview, read in order through bounded character pages. */
async function readAll(f: F, previewId: string, part: 'yaml' | 'diff' | 'report' | 'impact', limit = 100000): Promise<{ text: string; pages: number; capped: number }> {
  const pages: string[] = [];
  let offset: number | undefined = 0;
  let capped = 0;
  while (offset !== undefined) {
    const page = await run(f, 'preview_workflow_batch', { preview_id: previewId, part, offset, limit });
    capped = Math.max(capped, page.limit);
    pages.push(part === 'diff' ? page.diff : part === 'yaml' ? page.yaml : page.text);
    offset = page.nextOffset;
  }
  return { text: pages.join(''), pages: pages.length, capped };
}

/** The rendered tool result, exactly as the host presents it. */
function rendered(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

describe('batch preview', () => {
  it('reviews a coordinated specialist change without writing anything', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const before = await document(f, boardId);
    const value = await preview(f, boardId, COORDINATED, { detail: 'full' });
    expect(value.previewed).toBe(true);
    expect(value.previewId).toEqual(expect.any(String));
    expect(value.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(value.baseSha256).toBe(digest(FLOW));
    expect(value.hubRevision).toBe(before.hubRevision);
    expect(value.operations).toBe(4);
    expect(value.appliedOperations.map((entry: any) => entry.operation)).toEqual(['set_agent', 'set_stage_agent', 'set_stage_prompt', 'set_stage_routes']);
    // The exact candidate carries every edit and keeps the unrelated authored text.
    expect(value.yaml).toContain('agent: triage');
    expect(value.yaml).toContain('name: Triage Agent');
    expect(value.yaml).toContain('Decide where the request goes');
    expect(value.yaml).toContain('# triage keeps its own note');
    expect(value.yaml).toContain('size: {width: 420, height: 260}');
    expect(value.diff.startsWith('--- base\n+++ candidate\n')).toBe(true);
    expect(value.report.valid).toBe(true);
    expect(value.report.mode).toBe('full');
    expect(value.impact.changedStages).toContain('triage');
    expect(value.impact.changedAgents).toContain('triage');
    // Preview persists nothing: same bytes, same revision, no arrival of a board write.
    const after = await document(f, boardId);
    expect(after.yaml).toBe(FLOW);
    expect(after.hubRevision).toBe(before.hubRevision);
  });

  it('reviews and applies a coupled flow connection replacement byte for byte', async () => {
    const flowRoot = `{name: Coupled flow, initial_column: intake, columns: [{id: intake, label: Intake}, {id: triage, label: Triage}, {id: done, label: Done}], connections: [{from: intake, to: triage}, {from: triage, to: done}]}`;
    const f = await setup();
    const boardId = await boardWith(f, flowRoot);
    const value = await preview(f, boardId, [{ op: 'set_layout', connections: [
      { from: 'intake', to: 'triage', remove: true },
      { from: 'triage', to: 'done', remove: true },
      { from: 'done', to: 'intake' },
    ] }]);
    expect(value.previewed).toBe(true);
    const expected = flowRoot.replace('[{from: intake, to: triage}, {from: triage, to: done}]', '[ {from: done, to: intake}]');
    expect(value.yaml).toBe(expected);
    const applied = await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 });
    expect(applied.saved).toBe(true);
    const after = await document(f, boardId);
    expect(after.yaml).toBe(expected);
    expect(parseWorkflow(after.yaml).connections).toEqual([{ from: 'done', to: 'intake' }]);
  });

  it('names a failing operation and issues no handle', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, [
      { op: 'set_agent', agent_id: 'triage', name: 'Triage' },
      { op: 'set_stage_agent', stage_id: 'triage', agent_id: 'triage' },
      { op: 'set_stage_routes', stage_id: 'triage', transitions: ['ghost'] },
    ]);
    expect(value.previewed).toBe(false);
    expect(value.previewId).toBeUndefined();
    expect(value.error).toMatchObject({ code: 'INVALID_WORKFLOW', operationIndex: 2, operation: 'set_stage_routes' });
    expect((await document(f, boardId)).yaml).toBe(FLOW);
  });

  it('attributes an invalid layout to its operation with the positioned problems', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, [
      { op: 'set_stage_prompt', stage_id: 'intake', prompt: 'Work.' },
      { op: 'set_layout', sizes: { triage: { width: 1, height: 100 } } },
    ]);
    expect(value.previewed).toBe(false);
    expect(value.previewId).toBeUndefined();
    expect(value.error).toMatchObject({ code: 'INVALID_WORKFLOW', operationIndex: 1, operation: 'set_layout' });
    expect(value.error.message).toContain('Operation 1 (set_layout)');
    expect(value.problems?.[0]?.message).toContain('triage');
    expect(value.report).toMatchObject({ valid: false });
    expect((await document(f, boardId)).yaml).toBe(FLOW);
  });

  it('refuses a batch that quotes a stale Hub revision', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await run(f, 'preview_workflow_batch', { board_id: boardId, expected_revision: 0, operations: COORDINATED });
    expect(value).toMatchObject({ previewed: false, error: { code: 'REVISION_CONFLICT' } });
    expect(value.error.message).toContain('nothing was previewed');
  });

  it('reports an advisory warning for an agent preset the roster does not offer', async () => {
    const offered = await setup({ agentAvailability: async () => ({ presets: ['kanban-workflow-operator'] }) });
    const boardId = await boardWith(offered);
    const warned = await preview(offered, boardId, [{ op: 'set_agent', agent_id: 'triage', name: 'Triage', preset: 'not-shipped' }]);
    expect(warned.previewed).toBe(true);
    expect(warned.report.warnings).toContainEqual({ kind: 'agent-preset-unavailable', agent: 'triage', preset: 'not-shipped' });

    const unknown = await setup();
    const otherBoard = await boardWith(unknown);
    const unwarned = await preview(unknown, otherBoard, [{ op: 'set_agent', agent_id: 'triage', name: 'Triage', preset: 'not-shipped' }]);
    expect(unwarned.previewed).toBe(true);
    expect(unwarned.report.warnings.some((warning: any) => warning.kind === 'agent-preset-unavailable')).toBe(false);
  });

  it('keeps the report and card impacts on the snapshot it quotes while a roster lookup is suspended', async () => {
    const roster = suspended();
    // The create_board review asks the roster too, so only the preview's lookup is held.
    let lookups = 0;
    const f = await setup({ agentAvailability: async () => { lookups += 1; if (lookups === 2) { roster.enter(); await roster.gate; } return undefined; } });
    const boardId = await boardWith(f);
    const before = await document(f, boardId);
    const applying = run(f, 'preview_workflow_batch', { board_id: boardId, expected_revision: before.hubRevision, operations: COORDINATED });
    await roster.entered;
    const late = await f.app.createTask({ projectId: f.project.id, boardId, title: 'Late card', description: '' });
    await f.store.transact(draft => { draft.tasks.find(task => task.id === late.id)!.columnId = 'triage'; });
    expect((await document(f, boardId)).hubRevision).toBeGreaterThan(before.hubRevision);
    roster.release();
    const value = await applying;
    expect(value.previewed).toBe(true);
    expect(value.hubRevision).toBe(before.hubRevision);
    expect(value.impact.changedStages).toContain('triage');
    // The card committed after the snapshot is not attributed to the reviewed candidate.
    expect(value.impact.cards.some((card: any) => card.taskId === late.id)).toBe(false);
  });

  it('separates a newly stale declaration from a blocked placement without any card text', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const declared = await f.app.createTask({ projectId: f.project.id, boardId, title: 'Secret declared card', description: 'Secret description' });
    const admitted = await f.app.createTask({ projectId: f.project.id, boardId, title: 'Secret admitted card', description: 'Hidden description' });
    await f.app.whenSettled();
    await f.store.transact(draft => {
      const first = draft.tasks.find(task => task.id === declared.id)!;
      first.columnId = 'triage';
      first.recordedTransition = { fromColumnId: 'triage', columnId: 'done', at: '2026-11-01T00:00:00.000Z', reason: 'Ready.' };
      const second = draft.tasks.find(task => task.id === admitted.id)!;
      second.columnId = 'triage';
      // A failed advance still holds the destination the engine captured; a waiting one
      // would be applied by the running host before the preview could read it.
      second.pendingTransition = { id: 'pending-1', fromColumnId: 'triage', columnId: 'done', mode: 'move', status: 'failed', error: { code: 'DELIVERY_UNCERTAIN', message: 'The prior prompt admission was interrupted.' } };
    });
    const value = await preview(f, boardId, [{ op: 'set_stage_routes', stage_id: 'triage', transitions: [] }]);
    expect(value.previewed).toBe(true);
    expect(value.impact.cards).toContainEqual({ taskId: declared.id, stage: 'triage', kind: 'route-stale', destination: 'done', advance: 'declared', reason: 'not-allowed' });
    expect(value.impact.cards).toContainEqual({ taskId: admitted.id, stage: 'triage', kind: 'placement-blocked', destination: 'done', advance: 'pending' });
    // Both fields of the one report name both cards, on the same basis.
    expect(value.report.affectedCards).toEqual([
      { taskId: declared.id, stage: 'triage', reason: 'route-removed' },
      { taskId: admitted.id, stage: 'triage', reason: 'route-removed' },
    ]);
    expect(value.impact.counts['route-stale']).toBe(1);
    expect(value.impact.counts['placement-blocked']).toBe(1);
    const serialized = JSON.stringify(value);
    for (const secret of ['Secret declared card', 'Secret description', 'Secret admitted card', 'Hidden description']) {
      expect(serialized).not.toContain(secret);
    }
  });


  it('gives one route answer across the preview report and the impact report', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const overridden = await f.app.createTask({ projectId: f.project.id, boardId, title: 'Overridden route', description: '' });
    await f.app.whenSettled();
    await f.store.transact(draft => {
      const card = draft.tasks.find(task => task.id === overridden.id)!;
      card.columnId = 'triage';
      // Triage permits only done, so intake is an existing restriction; the stored
      // override is what lets the admitted advance place anyway.
      card.pendingTransition = {
        id: 'pending-override', fromColumnId: 'triage', columnId: 'intake', mode: 'move', status: 'failed',
        transitionOverride: true, error: { code: 'DELIVERY_UNCERTAIN', message: 'Interrupted.' },
      };
    });
    const existing = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'triage', prompt: 'Route it.' }]);
    expect(existing.previewed).toBe(true);
    // Neither field blames the card: the restriction predates the edit and the
    // override keeps the placement permitted in both documents.
    expect(existing.report.affectedCards).toEqual([]);
    expect(existing.impact.cards.some((card: any) => ['route-stale', 'placement-blocked', 'admitted-advance'].includes(card.kind))).toBe(false);

    // A card already at its destination keeps its captured advance when the route goes.
    const placed = await f.app.createTask({ projectId: f.project.id, boardId, title: 'Placed card', description: '' });
    await f.app.whenSettled();
    await f.store.transact(draft => {
      const card = draft.tasks.find(task => task.id === placed.id)!;
      card.columnId = 'done';
      card.pendingTransition = {
        id: 'pending-placed', fromColumnId: 'triage', columnId: 'done', mode: 'move', status: 'failed',
        error: { code: 'DELIVERY_UNCERTAIN', message: 'Interrupted.' },
      };
    });
    const captured = await preview(f, boardId, [
      { op: 'set_stage_routes', stage_id: 'triage', transitions: [] },
      { op: 'set_stage_prompt', stage_id: 'done', prompt: 'Delivered.' },
    ]);
    expect(captured.previewed).toBe(true);
    expect(captured.report.affectedCards.some((card: any) => card.taskId === placed.id)).toBe(false);
    expect(captured.impact.cards).toContainEqual({ taskId: placed.id, stage: 'done', kind: 'admitted-advance', destination: 'done', advance: 'pending' });
  });

  it('reports the reviewed script authorization before apply, against the same snapshot', async () => {
    const f = await setup();
    const boardId = await boardWith(f, SCRIPTED_FLOW);
    const seen: any[] = [];
    const boards = new BoardAdministration({
      hubs: f.hubs,
      impact: { async describe(input: any) { seen.push(input); return [{ stage: 'wait', verdict: 'changed' as const, reasons: ['exits' as const] }]; } },
    });
    const tools = batchTools(f.app, boards);
    const before = await document(f, boardId);
    const value = await named(tools, 'preview_workflow_batch').execute({
      board_id: boardId, expected_revision: before.hubRevision,
      operations: [{ op: 'set_stage_routes', stage_id: 'wait', exits: { passed: 'intake' } }],
    }, execution()) as any;
    expect(value.previewed).toBe(true);
    expect(value.scriptAuthorizationInspected).toBe(true);
    expect(value.report.scripts).toEqual([{ stage: 'wait', verdict: 'changed', reasons: ['exits'] }]);
    // The projection saw the same snapshot and the retargeted exit, without running it.
    expect(seen).toHaveLength(1);
    expect(seen[0].hub.revision).toBe(before.hubRevision);
    expect(seen[0].board.workflowYaml).toBe(SCRIPTED_FLOW);
    expect(seen[0].before.columns.find((column: any) => column.id === 'wait').scripted.exits).toEqual({ passed: 'done' });
    expect(seen[0].after.columns.find((column: any) => column.id === 'wait').scripted.exits).toEqual({ passed: 'intake' });
    expect(f.sessions.sent).toEqual([]);
    const after = await document(f, boardId);
    expect(after.yaml).toBe(SCRIPTED_FLOW);
    expect(after.hubRevision).toBe(before.hubRevision);
  });


  it('reports unverifiable script authorization through the normal app port without a runtime', async () => {
    const f = await setup();
    const boardId = await boardWith(f, SCRIPTED_FLOW);
    const before = await document(f, boardId);
    const value = await run(f, 'preview_workflow_batch', {
      board_id: boardId, expected_revision: before.hubRevision,
      operations: [{ op: 'set_stage_routes', stage_id: 'wait', exits: { passed: 'intake' } }],
    });
    expect(value.previewed).toBe(true);
    // The installed port has no scripted runtime, so the preview must not claim it
    // inspected the authorization; each scripted stage is reported as unverifiable.
    expect(value.scriptAuthorizationInspected).toBe(false);
    expect(value.report.scripts).toEqual([
      { stage: 'wait', verdict: 'unverifiable', reasons: ['unresolvable'], detail: expect.stringContaining('not available') },
    ]);
    expect(f.sessions.sent).toEqual([]);
    const after = await document(f, boardId);
    expect(after.yaml).toBe(SCRIPTED_FLOW);
    expect(after.hubRevision).toBe(before.hubRevision);
  });

  it('marks script authorization as not inspected when the host offers no projection', async () => {
    const f = await setup();
    const boardId = await boardWith(f, SCRIPTED_FLOW);
    const boards = new BoardAdministration({ hubs: f.hubs });
    const tools = batchTools(f.app, boards);
    const before = await document(f, boardId);
    const value = await named(tools, 'preview_workflow_batch').execute({
      board_id: boardId, expected_revision: before.hubRevision,
      operations: [{ op: 'set_stage_routes', stage_id: 'wait', exits: { passed: 'intake' } }],
    }, execution()) as any;
    expect(value.previewed).toBe(true);
    expect(value.scriptAuthorizationInspected).toBe(false);
    expect(value.report.scripts).toEqual([]);
  });
});

describe('batch apply', () => {
  it('stores the exact reviewed bytes in one attributed local change', async () => {
    const recorded: any[] = [];
    const f = await setup({ revisions: { async record(input: any) { recorded.push(input); } } });
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, COORDINATED);
    const before = recorded.filter(entry => entry.boardId === boardId).length;

    const applied = await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 });
    expect(applied.saved).toBe(true);
    expect(applied.previewId).toBe(value.previewId);
    expect(applied.sha256).toBe(value.sha256);
    expect(applied.storedSha256).toBe(value.sha256);
    expect(applied.verified).toBe(true);
    expect(applied.committedRevision).toBe(value.hubRevision + 1);
    expect(applied.hubRevision).toBe(value.hubRevision + 1);
    expect(applied.currentHubRevision).toBe(applied.committedRevision);
    expect(applied.sharing).toEqual({ status: 'not-published', reason: 'manual' });

    const stored = await document(f, boardId);
    expect(stored.yaml).toBe(value.yaml);
    expect(digest(stored.yaml)).toBe(value.sha256);
    expect(stored.hubRevision).toBe(applied.hubRevision);

    const written = recorded.filter(entry => entry.boardId === boardId);
    expect(written).toHaveLength(before + 1);
    expect(written.at(-1)!.actor).toEqual({ kind: 'agent', sessionId: 'ordinary-session' });
    expect(written.at(-1)!.origin).toBe('tool');
  });

  it('reports its own commit when a post-commit hook lets another write advance the Hub', async () => {
    const hook = suspended();
    const recorded: any[] = [];
    const f = await setup({ revisions: { async record(input: any) { recorded.push(input); if (recorded.length === 2) { hook.enter(); await hook.gate; } } } });
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, COORDINATED);
    const applying = run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 });
    // The batch transaction has committed when its revision recording starts.
    await hook.entered;
    const ownRevision = (await document(f, boardId)).hubRevision;
    await f.store.transact(draft => { draft.boards[0]!.updatedAt = '2026-11-28T00:00:00.000Z'; });
    const current = (await document(f, boardId)).hubRevision;
    expect(current).toBeGreaterThan(ownRevision);
    hook.release();
    const applied = await applying;
    expect(applied.saved).toBe(true);
    expect(applied.verified).toBe(true);
    expect(applied.storedSha256).toBe(value.sha256);
    expect(applied.committedRevision).toBe(ownRevision);
    expect(applied.hubRevision).toBe(ownRevision);
    expect(applied.currentHubRevision).toBe(current);
  });

  it('refuses a mismatched digest without persisting or renumbering the Hub', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, COORDINATED);
    const before = await document(f, boardId);
    const applied = await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: 'f'.repeat(64) });
    expect(applied).toMatchObject({ saved: false, error: { code: 'EXPECTED_SHA256_MISMATCH' }, expected: 'f'.repeat(64), actual: value.sha256 });
    const after = await document(f, boardId);
    expect(after.yaml).toBe(FLOW);
    expect(after.hubRevision).toBe(before.hubRevision);
  });

  it('refuses an unknown handle, another conversation handle, and an expired handle', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const store = new WorkflowPreviewStore({ ttlMs: 1000, now: () => clock });
    const tools = batchTools(f.app, f.app.boards, store);
    let clock = 1_000_000;
    const previewValue = await named(tools, 'preview_workflow_batch').execute(
      { board_id: boardId, expected_revision: (await document(f, boardId)).hubRevision, operations: COORDINATED },
      execution('session-a'),
    ) as any;
    expect(previewValue.previewed).toBe(true);

    await expect(named(tools, 'apply_workflow_batch').execute({ preview_id: 'missing', expect_sha256: previewValue.sha256 }, execution('session-a')))
      .rejects.toMatchObject({ code: 'PREVIEW_NOT_FOUND' });
    await expect(named(tools, 'apply_workflow_batch').execute({ preview_id: previewValue.previewId, expect_sha256: previewValue.sha256 }, execution('session-b')))
      .rejects.toMatchObject({ code: 'PREVIEW_NOT_OWNED' });
    // The foreign read left the owner's handle in place.
    const stillThere = await named(tools, 'preview_workflow_batch').execute({ preview_id: previewValue.previewId, part: 'yaml' }, execution('session-a')) as any;
    expect(stillThere.previewed).toBe(true);

    clock += 5000;
    await expect(named(tools, 'apply_workflow_batch').execute({ preview_id: previewValue.previewId, expect_sha256: previewValue.sha256 }, execution('session-a')))
      .rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
    expect((await document(f, boardId)).yaml).toBe(FLOW);
  });

  it('refuses a preview whose Hub moved after review and preserves the concurrent change', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, COORDINATED);
    await run(f, 'set_stage_prompt', { board_id: boardId, stage_id: 'intake', prompt: 'Concurrent edit.' });

    const applied = await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 });
    expect(applied).toMatchObject({ saved: false, stalePreview: true, error: { code: 'REVISION_CONFLICT' } });
    const stored = await document(f, boardId);
    expect(stored.yaml).toContain('Concurrent edit.');
    expect(stored.yaml).not.toContain('agent: triage');
  });

  it('refuses when another write moved the Hub revision but left the workflow identical', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, COORDINATED);
    await run(f, 'update_board', { board_id: boardId, name: 'Renamed batch flow' });
    const renamed = await document(f, boardId);
    expect(renamed.yaml).toBe(FLOW);
    expect(renamed.hubRevision).toBeGreaterThan(value.hubRevision);

    const applied = await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 });
    expect(applied).toMatchObject({ saved: false, stalePreview: true });
    const stored = await document(f, boardId);
    expect(stored.yaml).toBe(FLOW);
    expect(stored.boardName).toBe('Renamed batch flow');
  });

  it('does not apply the same handle twice', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, COORDINATED);
    expect((await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 })).saved).toBe(true);
    const stored = await document(f, boardId);
    const second = await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 });
    expect(second).toMatchObject({ saved: false, stalePreview: true });
    expect((await document(f, boardId)).hubRevision).toBe(stored.hubRevision);
  });

  it('refuses both batch calls from a task conversation and its descendant', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, COORDINATED);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Task owned', description: '' });
    const session = task.sessionIds[0]!;
    const child = f.sessions.seedSubagent(session, 'subagent-batch', f.projectPath);
    for (const owner of [session, child]) {
      await expect(run(f, 'preview_workflow_batch', { board_id: boardId, expected_revision: value.hubRevision, operations: COORDINATED }, owner))
        .rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
      await expect(run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 }, owner))
        .rejects.toMatchObject({ code: 'BOARD_ADMIN_REQUIRES_ORDINARY_CHAT' });
    }
    expect((await document(f, boardId)).yaml).toBe(FLOW);
  });
});

describe('bounded review pages', () => {
  const LONG_LIST = Array.from({ length: 460 }, (_, index) => '      line ' + index).join('\n');
  const LONG = 'name: Long\ninitial_column: intake\ncolumns:\n  - id: intake\n    label: Intake\n    description: Take it in.\n    on_enter_prompt: |\n' + LONG_LIST + '\n  - id: done\n    label: Done\n    description: Delivered.\n';

  it('reproduces a large Unicode candidate and diff through bounded character reads', async () => {
    const f = await setup();
    const boardId = await boardWith(f, LONG);
    const value = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'done', prompt: 'São Paulo — ação concluída ✓' }]);
    expect(value.previewed).toBe(true);
    expect(value.yamlTotalCharacters).toBeGreaterThan(4000);
    expect(value.yamlNextOffset).toBeDefined();

    const read = await readAll(f, value.previewId, 'yaml');
    expect(read.pages).toBeGreaterThan(1);
    expect(read.capped).toBeLessThanOrEqual(4000);
    expect(digest(read.text)).toBe(value.sha256);
    expect(read.text).toContain('São Paulo — ação concluída ✓');
    expect(read.text.startsWith('name: Long')).toBe(true);

    const diff = await readAll(f, value.previewId, 'diff');
    expect(diff.text.startsWith('--- base\n+++ candidate\n')).toBe(true);
    expect(diff.text).toContain("+    on_enter_prompt: 'São Paulo — ação concluída ✓'");
  });

  it('recovers one very long escaped line in renderable pages', async () => {
    const f = await setup();
    const longLine = 'ação ' + '"quoted" \\ slash ' + '✓'.repeat(2000);
    const authoredLine = '    on_enter_prompt: ' + JSON.stringify(longLine);
    const yaml = 'name: Long line\ninitial_column: intake\ncolumns:\n  - id: intake\n    label: Intake\n    description: Take it in.\n' + authoredLine + '\n  - id: done\n    label: Done\n    description: Delivered.\n';
    const boardId = await boardWith(f, yaml);
    const value = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'done', prompt: 'Delivered.' }]);
    expect(value.previewed).toBe(true);
    // The rendered initial response, JSON escaping included, stays reviewable.
    expect(JSON.stringify(value).length).toBeLessThan(8192);
    expect(value.yamlNextOffset).toBeDefined();
    expect(value.yaml.length).toBeLessThan(value.yamlTotalCharacters);

    // A requested limit is honoured, and the capped one never runs away.
    const small = await run(f, 'preview_workflow_batch', { preview_id: value.previewId, part: 'yaml', offset: 0, limit: 10 });
    expect(small.yaml.length).toBeLessThanOrEqual(10);
    expect(small.nextOffset).toBe(small.yaml.length);

    const read = await readAll(f, value.previewId, 'yaml', 1);
    expect(read.pages).toBeGreaterThan(1);
    expect(digest(read.text)).toBe(value.sha256);
    expect(read.text).toContain(authoredLine);
    // The page boundary never splits a surrogate pair.
    expect(read.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);

    // A change that removes the long line makes the diff carry it, paged in order.
    const removing = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'intake', prompt: 'Short now.' }]);
    expect(removing.previewed).toBe(true);
    const diff = await readAll(f, removing.previewId, 'diff');
    expect(diff.pages).toBeGreaterThan(1);
    expect(diff.text).toContain('-' + authoredLine);
  });

  it('keeps a full-detail response renderable and recovers the complete report', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const longPrompt = 'Use ' + 'the evidence '.repeat(400) + 'to decide.';
    const value = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'triage', prompt: longPrompt }], { detail: 'full' });
    expect(value.previewed).toBe(true);
    // The rendered tool result, not just the compact JSON, stays under the host budget.
    expect(rendered(value).length).toBeLessThan(8192);
    expect(value.reportTruncated).toBe(true);
    expect(value.reportCharacters).toBeGreaterThan(5000);
    // The trimmed report still surfaces the counts that say what is missing.
    expect(value.report.difference.stages).toEqual([]);
    expect(value.report.differenceOmitted).toBe(1);
    expect(value.report.warningsOmitted).toEqual(expect.any(Number));
    expect(value.report.affectedCardsOmitted).toEqual(expect.any(Number));

    const recovered = JSON.parse((await readAll(f, value.previewId, 'report')).text);
    expect(recovered.mode).toBe('full');
    expect(recovered.valid).toBe(true);
    const triage = recovered.difference.stages.find((stage: any) => stage.stage === 'triage');
    expect(triage.fields.some((field: any) => field.to === longPrompt)).toBe(true);
    expect((await document(f, boardId)).yaml).toBe(FLOW);
  });

  it('trims a large impact with its true counts and recovers it from the preview', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const cards: Array<{ id: string }> = [];
    for (let index = 0; index < 105; index += 1) cards.push(await f.app.createTask({ projectId: f.project.id, boardId, title: 'Card ' + index, description: '' }));
    await f.app.whenSettled();
    await f.store.transact(draft => { for (const card of cards) draft.tasks.find(task => task.id === card.id)!.columnId = 'triage'; });

    const value = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'triage', prompt: 'Route it.' }]);
    expect(value.previewed).toBe(true);
    expect(rendered(value).length).toBeLessThan(8192);
    expect(value.impactTruncated).toBe(true);
    expect(value.impact.counts['stage-changed']).toBe(105);
    expect(value.impact.cards).toEqual([]);
    expect(value.impact.cardsOmitted).toBe(105);
    expect(value.impactCharacters).toBeGreaterThan(8192);

    const recovered = JSON.parse((await readAll(f, value.previewId, 'impact')).text);
    expect(recovered.counts['stage-changed']).toBe(105);
    expect(recovered.cards).toHaveLength(100);
    expect(recovered.cardsOmitted).toBe(5);
    expect((await document(f, boardId)).yaml).toBe(FLOW);
  });

  it('measures the candidate with three synthetic cards per stage without saving it', async () => {
    const f = await setup();
    const boardId = await boardWith(f);
    const value = await preview(f, boardId, [...COORDINATED, { op: 'set_layout', sizes: { triage: { width: 380, height: 240 } } }]);
    expect(value.previewed).toBe(true);
    const candidate = (await readAll(f, value.previewId, 'yaml')).text;
    const cards = Object.fromEntries(parseWorkflow(candidate).columns.map(column => [column.id, 3]));
    const metrics = await run(f, 'layout_metrics', { board_id: boardId, yaml: candidate, cards });
    expect(metrics.cards).toEqual(cards);
    expect(metrics.metrics.crossings).toEqual(expect.any(Number));
    // Measuring a candidate changes nothing.
    expect((await document(f, boardId)).yaml).toBe(FLOW);
  });
});

describe('the triage flow end to end', () => {
  it('previews, measures, applies, and refuses stale or mismatched candidates through the public tools', async () => {
    const f = await setup();
    const boardId = await boardWith(f);

    // 1. Preview the coordinated agent, binding, instruction, and route change.
    const value = await preview(f, boardId, COORDINATED);
    expect(value.previewed).toBe(true);
    expect(value.diff.startsWith('--- base\n+++ candidate\n')).toBe(true);
    expect(value.yaml).toContain('agents:');
    expect(value.yaml).toContain('agent: triage');
    expect(value.yaml).toContain('Decide where the request goes');
    expect(value.impact.changedStages).toContain('triage');
    expect(value.impact.changedAgents).toContain('triage');
    expect(value.report.valid).toBe(true);
    // The normal app port has no scripted runtime, so it reports that the
    // authorization could not be inspected rather than claiming an empty pass.
    expect(value.scriptAuthorizationInspected).toBe(false);

    // 2. Measure the candidate with three synthetic cards per stage.
    const candidate = (await readAll(f, value.previewId, 'yaml')).text;
    const three = Object.fromEntries(parseWorkflow(candidate).columns.map(column => [column.id, 3]));
    const measured = await run(f, 'layout_metrics', { board_id: boardId, yaml: candidate, cards: three });
    expect(measured.cards).toEqual(three);
    expect(measured.metrics.crossings).toEqual(expect.any(Number));

    // 3. Apply the preview and compare the stored bytes with the reviewed ones.
    const applied = await run(f, 'apply_workflow_batch', { preview_id: value.previewId, expect_sha256: value.sha256 });
    expect(applied).toMatchObject({ saved: true, verified: true, storedSha256: value.sha256 });
    expect((await document(f, boardId)).yaml).toBe(candidate);

    // 4. A candidate reviewed before a concurrent write is refused atomically.
    const reviewed = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'done', prompt: 'Delivered.' }]);
    await run(f, 'update_board', { board_id: boardId, name: 'Renamed triage' });
    const stale = await run(f, 'apply_workflow_batch', { preview_id: reviewed.previewId, expect_sha256: reviewed.sha256 });
    expect(stale).toMatchObject({ saved: false, stalePreview: true, error: { code: 'REVISION_CONFLICT' } });
    expect((await document(f, boardId)).yaml).toBe(candidate);

    // 5. A digest that does not match the previewed candidate saves nothing.
    const mismatchedPreview = await preview(f, boardId, [{ op: 'set_stage_prompt', stage_id: 'done', prompt: 'Delivered.' }]);
    const revisionBefore = (await document(f, boardId)).hubRevision;
    const mismatched = await run(f, 'apply_workflow_batch', { preview_id: mismatchedPreview.previewId, expect_sha256: '0'.repeat(64) });
    expect(mismatched).toMatchObject({ saved: false, error: { code: 'EXPECTED_SHA256_MISMATCH' } });
    expect((await document(f, boardId)).hubRevision).toBe(revisionBefore);
  });
});
