import { describe, expect, it } from 'vitest';
import { composeWorkflowBatch, MAX_BATCH_OPERATIONS } from '../../src/domain/workflow-batch.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { declaredAgents } from '../../src/domain/agents.js';
import { workflowImpact } from '../../src/domain/workflow-impact.js';
import { orphanedStageReferences } from '../../src/domain/workflow-orphans.js';
import { unifiedLineDiff } from '../../src/domain/workflow-diff-text.js';

/**
 * A fixture with the authored detail a batch must not touch: a leading comment, a
 * comment beside one stage, two agents of which only one is edited, and layout
 * values in a nondefault shape.
 */
const BOARD = `# Triage board, kept exactly as authored
name: Triage
initial_column: intake
columns:
  - id: intake
    label: Intake
    description: Receive the request.
    on_enter_prompt: Read the request.
    allowed_transitions: [triage]
    position: {x: 0, y: 0}
    size: {width: 420, height: 260}
  # the triage stage keeps its own note
  - id: triage
    label: Triage
    allowed_transitions: [done]
  - id: done
    label: Done
agents:
  # the researcher is not part of this change
  - id: researcher
    name: Researcher
    preset: kanban-project-planner
  - id: writer
    name: Writer
`;

function compose(operations: readonly unknown[]): string {
  return composeWorkflowBatch({ text: BOARD, operations }).text;
}

describe('ordered workflow batch composition', () => {
  it('creates an agent, binds it, and edits the instruction and routes in one order', () => {
    const text = compose([
      { op: 'set_agent', agent_id: 'triage', name: 'Triage Agent', preset: 'kanban-workflow-operator', model_provider: 'deepseek', model_name: 'reason' },
      { op: 'set_stage_agent', stage_id: 'triage', agent_id: 'triage' },
      { op: 'set_stage_prompt', stage_id: 'triage', prompt: 'Decide where the request goes.' },
      { op: 'set_stage_routes', stage_id: 'triage', transitions: [{ to: 'done', when: 'the request is delivered.' }] },
    ]);
    const workflow = parseWorkflow(text);
    expect(workflow.agents).toContainEqual({ id: 'triage', name: 'Triage Agent', preset: 'kanban-workflow-operator', model: { provider: 'deepseek', model: 'reason' } });
    expect(workflow.columns.find(column => column.id === 'triage')).toMatchObject({
      agent: 'triage',
      onEnterPrompt: 'Decide where the request goes.',
      allowedTransitions: [{ to: 'done', when: 'the request is delivered.' }],
    });
    // The unrelated agents, stage note, layout, and leading comment are untouched.
    expect(text).toContain('# the researcher is not part of this change');
    expect(text).toContain('  - id: researcher\n    name: Researcher\n    preset: kanban-project-planner');
    expect(text).toContain('# the triage stage keeps its own note');
    expect(text).toContain('size: {width: 420, height: 260}');
    expect(text.startsWith('# Triage board, kept exactly as authored\n')).toBe(true);
  });

  it('clears a binding before the agent it names is removed', () => {
    const text = compose([
      { op: 'set_stage_agent', stage_id: 'triage', agent_id: 'writer' },
      { op: 'set_stage_agent', stage_id: 'triage', agent_id: '' },
      { op: 'remove_agent', agent_id: 'writer' },
    ]);
    expect(declaredAgents(parseWorkflow(text)).map(agent => agent.id)).toEqual(['researcher']);
    expect(parseWorkflow(text).columns.find(column => column.id === 'triage')?.agent).toBeUndefined();
    expect(text).toContain('# the researcher is not part of this change');
  });

  it('removes the whole agents section with its last entry', () => {
    const text = compose([{ op: 'remove_agent', agent_id: 'writer' }, { op: 'remove_agent', agent_id: 'researcher' }]);
    expect(text).not.toContain('agents:');
    expect(declaredAgents(parseWorkflow(text))).toEqual([]);
    expect(text).toContain('# the triage stage keeps its own note');
    expect(text.trimEnd().endsWith('    label: Done')).toBe(true);
  });

  it('refuses an operation whose earlier step was not applied and names its index', () => {
    let failure: unknown;
    try {
      compose([{ op: 'set_stage_agent', stage_id: 'triage', agent_id: 'writer' }, { op: 'remove_agent', agent_id: 'writer' }]);
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'INVALID_INPUT' });
    expect((failure as Error).message).toContain('Operation 1 (remove_agent)');
    expect((failure as Error).message).toContain('A stage still names that agent');
    expect((failure as { details?: { index?: number } }).details?.index).toBe(1);
  });

  it('refuses a late unknown reference and yields no candidate', () => {
    let failure: unknown;
    try {
      compose([
        { op: 'set_agent', agent_id: 'triage', name: 'Triage' },
        { op: 'set_stage_agent', stage_id: 'triage', agent_id: 'triage' },
        { op: 'set_stage_routes', stage_id: 'triage', transitions: ['ghost'] },
      ]);
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'INVALID_WORKFLOW' });
    expect((failure as Error).message).toContain('Operation 2 (set_stage_routes)');
    expect((failure as Error).message).toContain('ghost');
  });

  it('refuses an unknown operation name and an empty batch', () => {
    expect(() => compose([{ op: 'set_everything' }])).toThrow(/Operation 0 must name one of/);
    expect(() => compose([])).toThrow(/at least one operation/);
  });

  it('bounds the number of operations', () => {
    const operations = Array.from({ length: MAX_BATCH_OPERATIONS + 1 }, () => ({ op: 'set_stage_prompt', stage_id: 'triage', prompt: 'Work.' }));
    expect(() => compose(operations)).toThrow(new RegExp('at most ' + MAX_BATCH_OPERATIONS));
  });

  it('keeps every layout value the batch does not name', () => {
    const text = compose([{ op: 'set_layout', sizes: { done: { width: 320, height: 200 } } }]);
    expect(text).toContain('size: {width: 420, height: 260}');
    expect(text).toContain('position: {x: 0, y: 0}');
    expect(text).toContain('size: {width: 320, height: 200}');
    const workflow = parseWorkflow(text);
    expect(workflow.columns.find(column => column.id === 'intake')?.size).toEqual({ width: 420, height: 260 });
    expect(workflow.columns.find(column => column.id === 'done')?.size).toEqual({ width: 320, height: 200 });
  });

  it('keeps the authored line endings when it appends an agent', () => {
    const crlf = BOARD.replace(/\n/g, '\r\n');
    const text = composeWorkflowBatch({ text: crlf, operations: [{ op: 'set_agent', agent_id: 'triage', name: 'Triage' }] }).text;
    expect(text.slice(0, 400)).toBe(crlf.slice(0, 400));
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text).toContain('\r\n  - id: triage\r\n    name: Triage\r\n');
  });

  it('reports the operations it applied in order', () => {
    const composition = composeWorkflowBatch({ text: BOARD, operations: [
      { op: 'set_stage_prompt', stage_id: 'done', prompt: 'Delivered.' },
      { op: 'remove_agent', agent_id: 'writer' },
    ] });
    expect(composition.operations).toEqual([
      { index: 0, operation: 'set_stage_prompt' },
      { index: 1, operation: 'remove_agent' },
    ]);
  });
});

describe('textual candidate diff', () => {
  it('reports the changed lines and the exact side labels', () => {
    const candidate = compose([{ op: 'set_stage_prompt', stage_id: 'triage', prompt: 'Decide.' }]);
    const diff = unifiedLineDiff(BOARD, candidate);
    expect(diff.startsWith('--- base\n+++ candidate\n@@ ')).toBe(true);
    // A context line keeps the document's text behind the one-space unified prefix.
    expect(diff).toContain('\n   - id: triage\n');
    expect(diff).toContain('+    on_enter_prompt: Decide.');
  });

  it('is empty for the same bytes and for a document reversed back', () => {
    expect(unifiedLineDiff(BOARD, BOARD)).toBe('');
    const candidate = compose([{ op: 'set_stage_prompt', stage_id: 'done', prompt: 'Done.' }]);
    const reversed = composeWorkflowBatch({ text: candidate, operations: [{ op: 'set_stage_prompt', stage_id: 'done', prompt: null }] }).text;
    // The prompt line is removed again, so the bytes return to the base document.
    expect(reversed).toBe(BOARD);
    expect(unifiedLineDiff(BOARD, reversed)).toBe('');
  });
});

describe('card impact projection', () => {
  const before = parseWorkflow(BOARD);
  const after = parseWorkflow(compose([{ op: 'set_stage_routes', stage_id: 'triage', transitions: [] }]));

  it('distinguishes a stale declaration from an admitted advance', () => {
    const impact = workflowImpact(before, after, [
      { id: 'card-declared', columnId: 'triage', recordedTransition: { fromColumnId: 'triage', columnId: 'done' } },
      { id: 'card-pending', columnId: 'triage', pendingTransition: { fromColumnId: 'triage', columnId: 'done' } },
    ]);
    expect(impact.changedStages).toEqual(['triage']);
    expect(impact.changedAgents).toEqual([]);
    expect(impact.cards).toContainEqual({ taskId: 'card-declared', stage: 'triage', kind: 'route-stale', destination: 'done', advance: 'declared', reason: 'not-allowed' });
    // The admitted advance captured its destination, but placement still checks the
    // route permission, so the candidate would block it before the card moves.
    expect(impact.cards).toContainEqual({ taskId: 'card-pending', stage: 'triage', kind: 'placement-blocked', destination: 'done', advance: 'pending' });
    expect(impact.counts['route-stale']).toBe(1);
    expect(impact.counts['placement-blocked']).toBe(1);
    expect(impact.counts['admitted-advance']).toBe(0);
  });

  it('names the cards at a changed stage and the agent whose definition changed', () => {
    const withAgent = parseWorkflow(compose([
      { op: 'set_agent', agent_id: 'triage', name: 'Triage' },
      { op: 'set_stage_agent', stage_id: 'triage', agent_id: 'triage' },
    ]));
    const impact = workflowImpact(before, withAgent, [{ id: 'card-a', columnId: 'triage' }, { id: 'card-b', columnId: 'intake' }]);
    expect(impact.changedAgents).toEqual(['triage']);
    expect(impact.changedStages).toContain('triage');
    expect(impact.cards).toContainEqual({ taskId: 'card-a', stage: 'triage', kind: 'stage-changed' });
    expect(impact.cards).toContainEqual({ taskId: 'card-a', stage: 'triage', kind: 'agent-changed' });
    expect(impact.cards.some(card => card.taskId === 'card-b')).toBe(false);
  });

  it('reports no impact without a previous document and never a card text field', () => {
    expect(workflowImpact(null, after, [{ id: 'card', columnId: 'triage' }]).compared).toBe(false);
    const impact = workflowImpact(before, after, [{ id: 'card', columnId: 'triage', recordedTransition: { fromColumnId: 'triage', columnId: 'done' } }]);
    const stale = impact.cards.find(card => card.kind === 'route-stale');
    expect(stale).toBeDefined();
    expect(Object.keys(stale!).sort()).toEqual(['advance', 'destination', 'kind', 'reason', 'stage', 'taskId']);
  });

  it('counts a card that a candidate would strand in a removed stage', () => {
    const withoutDone = parseWorkflow(`name: Triage
initial_column: intake
columns:
  - id: intake
    label: Intake
  - id: triage
    label: Triage
`);
    const impact = workflowImpact(before, withoutDone, [{ id: 'card', columnId: 'done' }]);
    expect(impact.cards).toContainEqual({ taskId: 'card', stage: 'done', kind: 'stage-removed' });
  });
});

describe('the orphan guard a preview applies', () => {
  it('names a stage a task or its admitted advance still references', () => {
    const workflow = parseWorkflow(BOARD);
    expect(orphanedStageReferences(workflow, [{ columnId: 'done' }])).toEqual([]);
    expect(orphanedStageReferences(workflow, [{ columnId: 'ghost' }])).toEqual(['ghost']);
    expect(orphanedStageReferences(workflow, [{ columnId: 'triage', pendingTransition: { fromColumnId: 'ghost', columnId: 'done' } }])).toEqual(['ghost']);
  });
});
/** Compose a batch onto any authored document, so a fixture can vary its style. */
function composeOn(text: string, operations: readonly unknown[]): string {
  return composeWorkflowBatch({ text, operations }).text;
}

const FLOW_LIST = `name: Flow list
initial_column: intake
columns:
  - id: intake
    label: Intake
  - id: done
    label: Done
agents: [{id: researcher, name: 'Researcher', preset: planner}, {id: writer, name: Writer}]
`;

const FLOW_ROOT = `{name: Flow root, initial_column: intake, columns: [{id: intake, label: Intake}, {id: done, label: Done}], agents: [{id: researcher, name: 'Researcher', preset: planner}, {id: writer, name: Writer}]}`;

describe('flow-style agent lists', () => {
  it('replaces one entry of a block-root flow list and keeps the other text exactly', () => {
    const next = composeOn(FLOW_LIST, [{ op: 'set_agent', agent_id: 'writer', name: 'Writer Two' }]);
    expect(next).toBe(FLOW_LIST.replace('{id: writer, name: Writer}', '{id: writer, name: Writer Two}'));
  });

  it('appends and removes entries of a block-root flow list without rewriting the rest', () => {
    const added = composeOn(FLOW_LIST, [{ op: 'set_agent', agent_id: 'triage', name: 'Triage' }]);
    expect(added).toBe(FLOW_LIST.replace('{id: writer, name: Writer}]', '{id: writer, name: Writer}, {id: triage, name: Triage}]'));
    const removed = composeOn(FLOW_LIST, [{ op: 'remove_agent', agent_id: 'writer' }]);
    expect(removed).toBe(FLOW_LIST.replace("{id: researcher, name: 'Researcher', preset: planner}, {id: writer, name: Writer}", "{id: researcher, name: 'Researcher', preset: planner}"));
  });

  it('patches one entry of a flow root without touching the mapping around it', () => {
    const replaced = composeOn(FLOW_ROOT, [{ op: 'set_agent', agent_id: 'writer', name: 'Writer Two' }]);
    expect(replaced).toBe(FLOW_ROOT.replace('{id: writer, name: Writer}', '{id: writer, name: Writer Two}'));

    const added = composeOn(FLOW_ROOT, [{ op: 'set_agent', agent_id: 'triage', name: 'Triage' }]);
    expect(added).toContain("agents: [{id: researcher, name: 'Researcher', preset: planner}, {id: writer, name: Writer}, {id: triage, name: Triage}]");

    const removed = composeOn(FLOW_ROOT, [{ op: 'remove_agent', agent_id: 'researcher' }]);
    expect(removed).toBe(FLOW_ROOT.replace("{id: researcher, name: 'Researcher', preset: planner}, ", ''));
  });

  it('keeps a comment between flow entries when another entry is replaced', () => {
    const commented = `name: Commented
initial_column: intake
columns: [{id: intake, label: Intake}, {id: done, label: Done}]
agents: [{id: researcher, name: 'Researcher'}, # the researcher stays
  {id: writer, name: Writer}]
`;
    const replaced = composeOn(commented, [{ op: 'set_agent', agent_id: 'writer', name: 'Writer Two' }]);
    expect(replaced).toBe(commented.replace('{id: writer, name: Writer}', '{id: writer, name: Writer Two}'));
    const removed = composeOn(commented, [{ op: 'remove_agent', agent_id: 'researcher' }]);
    expect(removed).toContain('# the researcher stays');
    expect(removed).toContain("{id: writer, name: Writer}]");
  });

  it('removes the agents key when its last flow entry goes', () => {
    const single = `{name: Single, initial_column: intake, columns: [{id: intake, label: Intake}], agents: [{id: writer, name: Writer}]}`;
    const next = composeOn(single, [{ op: 'remove_agent', agent_id: 'writer' }]);
    expect(next).toBe('{name: Single, initial_column: intake, columns: [{id: intake, label: Intake}]}');
  });
});

describe('route impact fidelity', () => {
  const before = parseWorkflow(BOARD);

  it('treats a removed configured list as newly stale even when manual moves become unrestricted', () => {
    const after = parseWorkflow(compose([{ op: 'set_stage_routes', stage_id: 'triage', permit_any: true }]));
    const impact = workflowImpact(before, after, [{ id: 'card', columnId: 'triage', recordedTransition: { fromColumnId: 'triage', columnId: 'done' } }]);
    expect(impact.cards).toContainEqual({ taskId: 'card', stage: 'triage', kind: 'route-stale', destination: 'done', advance: 'declared', reason: 'not-configured' });
  });

  it('never blames the candidate for a declaration that was already stale, exceptional, or scripted', () => {
    const after = parseWorkflow(compose([{ op: 'set_stage_routes', stage_id: 'triage', transitions: [] }]));
    const alreadyStale = workflowImpact(before, after, [{ id: 'stale', columnId: 'triage', recordedTransition: { fromColumnId: 'triage', columnId: 'intake' } }]);
    expect(alreadyStale.cards.some(card => card.kind === 'route-stale')).toBe(false);
    const exceptional = workflowImpact(before, after, [{ id: 'exception', columnId: 'triage', recordedTransition: { fromColumnId: 'triage', columnId: 'done', exception: true } }]);
    expect(exceptional.cards.some(card => card.kind === 'route-stale')).toBe(false);
    const scripted = workflowImpact(before, after, [{ id: 'scripted', columnId: 'triage', recordedTransition: { fromColumnId: 'triage', columnId: 'done' }, scriptedEntry: true }]);
    expect(scripted.cards.some(card => card.kind === 'route-stale')).toBe(false);
  });

  it('distinguishes an override and an already placed advance from a newly blocked placement', () => {
    const after = parseWorkflow(compose([{ op: 'set_stage_routes', stage_id: 'triage', transitions: [] }]));
    const overridden = workflowImpact(before, after, [{ id: 'over', columnId: 'triage', pendingTransition: { fromColumnId: 'triage', columnId: 'done', transitionOverride: true } }]);
    expect(overridden.cards.some(card => card.kind === 'placement-blocked' || card.kind === 'admitted-advance')).toBe(false);

    const placedAfter = parseWorkflow(compose([
      { op: 'set_stage_routes', stage_id: 'triage', transitions: [] },
      { op: 'set_stage_prompt', stage_id: 'done', prompt: 'Delivered.' },
    ]));
    const placed = workflowImpact(before, placedAfter, [{ id: 'placed', columnId: 'done', pendingTransition: { fromColumnId: 'triage', columnId: 'done' } }]);
    expect(placed.cards).toContainEqual({ taskId: 'placed', stage: 'done', kind: 'admitted-advance', destination: 'done', advance: 'pending' });
  });

  it('reports a captured advance whose destination changes as admitted, and a removed destination as blocked', () => {
    const capturedAfter = parseWorkflow(compose([{ op: 'set_stage_prompt', stage_id: 'done', prompt: 'Delivered.' }]));
    const captured = workflowImpact(before, capturedAfter, [{ id: 'captured', columnId: 'triage', pendingTransition: { fromColumnId: 'triage', columnId: 'done' } }]);
    expect(captured.cards).toContainEqual({ taskId: 'captured', stage: 'triage', kind: 'admitted-advance', destination: 'done', advance: 'pending' });

    const withoutDone = parseWorkflow(`name: Triage
initial_column: intake
columns:
  - id: intake
    label: Intake
  - id: triage
    label: Triage
`);
    const blocked = workflowImpact(before, withoutDone, [{ id: 'blocked', columnId: 'triage', pendingTransition: { fromColumnId: 'triage', columnId: 'done' } }]);
    expect(blocked.cards).toContainEqual({ taskId: 'blocked', stage: 'triage', kind: 'placement-blocked', destination: 'done', advance: 'pending' });
  });
});

describe('indexed configuration errors', () => {
  it('attributes an invalid layout to the operation that introduced it', () => {
    let failure: unknown;
    try {
      compose([
        { op: 'set_stage_prompt', stage_id: 'intake', prompt: 'Work.' },
        { op: 'set_layout', sizes: { triage: { width: 1, height: 100 } } },
      ]);
    } catch (error) { failure = error; }
    const value = failure as { code?: string; message: string; details?: { index?: number; operation?: string; problems?: Array<{ message: string }> } };
    expect(value.code).toBe('INVALID_WORKFLOW');
    expect(value.details?.index).toBe(1);
    expect(value.details?.operation).toBe('set_layout');
    expect(value.message).toContain('Operation 1 (set_layout)');
    expect(value.details?.problems?.[0]?.message).toContain('triage');
  });

  it('attributes the same error when the invalid layout is the first operation', () => {
    let failure: unknown;
    try {
      compose([
        { op: 'set_layout', sizes: { triage: { width: 1, height: 100 } } },
        { op: 'set_stage_prompt', stage_id: 'intake', prompt: 'Later.' },
      ]);
    } catch (error) { failure = error; }
    expect((failure as { details?: { index?: number } }).details?.index).toBe(0);
  });
});
describe('flow connection composition', () => {
  const ROOT = `{name: Coupled flow, initial_column: intake, columns: [{id: intake, label: Intake}, {id: triage, label: Triage}, {id: done, label: Done}], connections: [{from: intake, to: triage}, {from: triage, to: done}]}`;

  it('replaces every connection and adds one in a single layout operation', () => {
    const { text } = composeWorkflowBatch({
      text: ROOT,
      operations: [{ op: 'set_layout', connections: [
        { from: 'intake', to: 'triage', remove: true },
        { from: 'triage', to: 'done', remove: true },
        { from: 'done', to: 'intake' },
      ] }],
    });
    expect(text).toBe(ROOT.replace('[{from: intake, to: triage}, {from: triage, to: done}]', '[ {from: done, to: intake}]'));
    expect(parseWorkflow(text).connections).toEqual([{ from: 'done', to: 'intake' }]);
  });

  it('drops the only connection without deleting the comment before columns', () => {
    const text = `{name: Legacy, initial_column: intake, connections: [{from: intake, to: triage}], # the columns below
 columns: [{id: intake, label: Intake}, {id: triage, label: Triage}]}`;
    const { text: composed } = composeWorkflowBatch({
      text,
      operations: [{ op: 'set_layout', connections: [{ from: 'intake', to: 'triage', remove: true }] }],
    });
    expect(composed).toBe(text.replace('connections: [{from: intake, to: triage}],', ''));
    expect(parseWorkflow(composed).connections).toBeUndefined();
  });
});

describe('flow-style connection layouts', () => {
  const LINKED = `name: Linked
initial_column: intake
columns:
  - id: intake
    label: Intake
    allowed_transitions: [triage, done]
  - id: triage
    label: Triage
  - id: done
    label: Done
    size: {width: 380, height: 240}
connections: [{from: intake, to: triage, source: {side: right, at: 2}}, # keep this note
  {from: 'intake', to: done, source: {side: right, at: 4}}, {from: triage, to: done}]
`;

  it('removes one flow connection and keeps its quoted, commented neighbour byte for byte', () => {
    const next = composeOn(LINKED, [{ op: 'set_layout', connections: [{ from: 'intake', to: 'triage', remove: true }] }]);
    expect(next).toBe(LINKED.replace("{from: intake, to: triage, source: {side: right, at: 2}},", ''));
    expect(next).toContain('# keep this note');
    expect(next).toContain("{from: 'intake', to: done, source: {side: right, at: 4}}");
    // The authored stage dimension outside the connection list is untouched.
    expect(next).toContain('size: {width: 380, height: 240}');
  });

  it('removes a flow connection from a flow root without re-emitting the others', () => {
    const root = `{name: Root, initial_column: intake, columns: [{id: intake, label: Intake}, {id: done, label: Done}], connections: [{from: intake, to: done}, {from: 'done', to: intake, source: {side: left, at: 1}}]}`;
    const next = composeOn(root, [{ op: 'set_layout', connections: [{ from: 'intake', to: 'done', remove: true }] }]);
    expect(next).toBe(root.replace('{from: intake, to: done},', ''));
    expect(next).toContain("{from: 'done', to: intake, source: {side: left, at: 1}}");
  });
});
