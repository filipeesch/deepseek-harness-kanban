import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { materialize, materializeIdentities, stageIdentifier } from '../../src/domain/journal/materialize.js';

const NL = String.fromCharCode(10);
const AUTHORED = [
  '# Authored by hand.',
  'name: Delivery Flow',
  'initial_column: backlog',
  'default_view: workflow',
  'columns:',
  '  - id: backlog',
  '    key: s1',
  '    label: Backlog',
  '    # Starts everything.',
  '  - id: plan',
  '    key: s2',
  '    label: Plan',
  '    allowed_transitions:',
  '      - to: backlog',
  'groups:',
  '  - id: g1',
  '    label: Delivery',
  '    columns: [backlog, plan]',
  'connections:',
  '  - from: backlog',
  '    to: plan',
  '',
].join(NL);

function ids(text: string): string[] { return parseWorkflow(text).columns.map(column => column.id); }

describe('board change materialization', () => {
  it('replaces the whole workflow', () => {
    const replacement = 'name: Replaced' + NL + 'columns:' + NL + '  - id: only' + NL + '    label: Only' + NL;
    expect(parseWorkflow(materialize(AUTHORED, { kind: 'workflow.replaced', text: replacement })).name).toBe('Replaced');
  });

  it('changes one workflow field and keeps every other character', () => {
    const text = materialize(AUTHORED, { kind: 'workflow.field-changed', field: 'name', value: 'Renamed Flow' });
    expect(parseWorkflow(text).name).toBe('Renamed Flow');
    expect(text).toContain('# Authored by hand.');
    expect(text).toContain('    # Starts everything.');
    const cleared = materialize(AUTHORED, { kind: 'workflow.field-changed', field: 'defaultView', value: null });
    expect(parseWorkflow(cleared).defaultView).toBeUndefined();
  });

  it('changes the initial stage', () => {
    expect(parseWorkflow(materialize(AUTHORED, { kind: 'workflow.initial-changed', columnId: 'plan' })).initialColumnId).toBe('plan');
  });

  it('creates a stage with its identity, instruction, transitions, and layout', () => {
    const text = materialize(AUTHORED, {
      kind: 'stage.created',
      stage: { id: 'review', key: 's3', name: 'Review', onEnterPrompt: 'Read it.' + NL + 'Then decide.', allowedTransitions: [{ to: 'plan' }, { to: 'backlog', when: 'again' }], position: { x: 10, y: 20 }, size: { width: 300, height: 200 } },
    });
    const column = parseWorkflow(text).columns[2]!;
    expect(column).toMatchObject({ id: 'review', key: 's3', name: 'Review', position: { x: 10, y: 20 }, size: { width: 300, height: 200 } });
    expect(column.onEnterPrompt).toBe('Read it.' + NL + 'Then decide.');
    expect(column.allowedTransitions).toEqual([{ to: 'plan' }, { to: 'backlog', when: 'again' }]);
    expect(text).toContain('# Authored by hand.');
  });

  it('adds a stage to a workflow whose columns are authored in flow style', () => {
    const flow = 'columns: [{id: one, key: s1, label: One}, {id: two, key: s2, label: Two}]' + NL;
    const text = materialize(flow, { kind: 'stage.created', stage: { id: 'three', key: 's3', name: 'Three', onEnterPrompt: 'Line one' + NL + 'line two', allowedTransitions: [{ to: 'one' }] } });
    const workflow = parseWorkflow(text);
    expect(workflow.columns.map(column => column.id)).toEqual(['one', 'two', 'three']);
    expect(workflow.columns[2]?.key).toBe('s3');
    expect(workflow.columns[2]?.onEnterPrompt).toBe('Line one' + NL + 'line two');
    expect(workflow.columns[2]?.allowedTransitions).toEqual([{ to: 'one' }]);
    expect(text).toContain('{id: one, key: s1, label: One}');
  });

  it('changes one stage field of each kind', () => {
    const renamed = materialize(AUTHORED, { kind: 'stage.field-changed', key: 's2', field: 'name', value: 'Planning' });
    expect(parseWorkflow(renamed).columns[1]?.name).toBe('Planning');
    const instructed = materialize(AUTHORED, { kind: 'stage.field-changed', key: 's1', field: 'onEnterPrompt', value: 'Start.' });
    expect(parseWorkflow(instructed).columns[0]?.onEnterPrompt).toBe('Start.');
    const cleared = materialize(instructed, { kind: 'stage.field-changed', key: 's1', field: 'onEnterPrompt', value: null });
    expect(parseWorkflow(cleared).columns[0]?.onEnterPrompt).toBeUndefined();
    const restricted = materialize(AUTHORED, { kind: 'stage.field-changed', key: 's2', field: 'allowedTransitions', value: [{ to: 'backlog', when: 'only' }] });
    expect(parseWorkflow(restricted).columns[1]?.allowedTransitions).toEqual([{ to: 'backlog', when: 'only' }]);
    const opened = materialize(restricted, { kind: 'stage.field-changed', key: 's2', field: 'allowedTransitions', value: null });
    expect(parseWorkflow(opened).columns[1]?.allowedTransitions).toBeUndefined();
  });

  it('writes an explicitly empty transition list', () => {
    const text = materialize(AUTHORED, { kind: 'stage.field-changed', key: 's2', field: 'allowedTransitions', value: [] });
    expect(parseWorkflow(text).columns[1]?.allowedTransitions).toEqual([]);
    const reopened = materialize(text, { kind: 'stage.field-changed', key: 's2', field: 'allowedTransitions', value: null });
    expect(parseWorkflow(reopened).columns[1]?.allowedTransitions).toBeUndefined();
  });

  it('renames a stage identifier and keeps its identity and references', () => {
    const text = materialize(AUTHORED, { kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' });
    const workflow = parseWorkflow(text);
    expect(workflow.columns.map(column => [column.id, column.key])).toEqual([['inbox', 's1'], ['plan', 's2']]);
    expect(workflow.initialColumnId).toBe('inbox');
    expect(workflow.columns[1]?.allowedTransitions).toEqual([{ to: 'inbox' }]);
    expect(workflow.groups[0]?.columnIds).toEqual(['inbox', 'plan']);
    expect(workflow.connections).toEqual([{ from: 'inbox', to: 'plan' }]);
    expect(text).toContain('# Starts everything.');
  });

  it('removes a stage together with every authored reference to it', () => {
    const text = materialize(AUTHORED, { kind: 'stage.removed', key: 's1' });
    const workflow = parseWorkflow(text);
    expect(workflow.columns.map(column => column.id)).toEqual(['plan']);
    expect(workflow.initialColumnId).toBe('plan');
    expect(workflow.columns[0]?.allowedTransitions).toBeUndefined();
    expect(workflow.groups[0]?.columnIds).toEqual(['plan']);
    expect(workflow.connections).toBeUndefined();
    expect(text).toContain('# Authored by hand.');
  });

  it('removes a group left empty by a stage removal', () => {
    const single = AUTHORED.replace('columns: [backlog, plan]', 'columns: [plan]');
    const text = materialize(single, { kind: 'stage.removed', key: 's2' });
    expect(parseWorkflow(text).groups).toEqual([]);
  });

  it('sets and clears one stage layout', () => {
    const placed = materialize(AUTHORED, { kind: 'stage.layout-set', key: 's2', position: { x: 5, y: 6 }, size: { width: 320, height: 240 } });
    expect(parseWorkflow(placed).columns[1]?.position).toEqual({ x: 5, y: 6 });
    expect(parseWorkflow(placed).columns[1]?.size).toEqual({ width: 320, height: 240 });
    const cleared = materialize(placed, { kind: 'stage.layout-set', key: 's2', position: null, size: null });
    expect(parseWorkflow(cleared).columns[1]?.position).toBeUndefined();
    expect(parseWorkflow(cleared).columns[1]?.size).toBeUndefined();
    expect(parseWorkflow(cleared).columns[0]?.key).toBe('s1');
  });

  it('creates, renames, and removes a group', () => {
    const ungrouped = AUTHORED.slice(0, AUTHORED.indexOf('groups:')) + AUTHORED.slice(AUTHORED.indexOf('connections:'));
    const created = materialize(ungrouped, { kind: 'group.created', group: { id: 'g1', name: 'Later', columnIds: ['plan'] } });
    expect(parseWorkflow(created).groups.map(group => group.id)).toEqual(['g1']);
    const renamed = materialize(AUTHORED, { kind: 'group.field-changed', id: 'g1', field: 'name', value: 'Flow' });
    expect(parseWorkflow(renamed).groups[0]?.name).toBe('Flow');
    const removed = materialize(AUTHORED, { kind: 'group.removed', id: 'g1' });
    expect(parseWorkflow(removed).groups).toEqual([]);
  });

  it('sets and removes one connection layout', () => {
    const set = materialize(AUTHORED, { kind: 'connection.set', layout: { from: 'plan', to: 'backlog', source: { side: 'right', at: 2 } } });
    expect(parseWorkflow(set).connections?.map(layout => layout.from + '>' + layout.to)).toEqual(['backlog>plan', 'plan>backlog']);
    const removed = materialize(set, { kind: 'connection.removed', from: 'backlog', to: 'plan' });
    expect(parseWorkflow(removed).connections).toEqual([{ from: 'plan', to: 'backlog', source: { side: 'right', at: 2 } }]);
  });

  it('rejects a change that addresses a stage the board does not have', () => {
    expect(() => materialize(AUTHORED, { kind: 'stage.id-changed', key: 'missing', from: 'a', id: 'other' })).toThrow(expect.objectContaining({ code: 'JOURNAL_STAGE_MISSING' }));
    expect(() => materialize(AUTHORED, { kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'plan' })).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
    expect(() => materialize(AUTHORED, { kind: 'stage.id-changed', key: 's1', from: 'elsewhere', id: 'inbox' })).toThrow(expect.objectContaining({ code: 'JOURNAL_IDENTITY_CONFLICT' }));
  });

  it('resolves the authored identifier of a stable identity', () => {
    expect(stageIdentifier(parseWorkflow(AUTHORED), 's2')).toBe('plan');
  });

  it('writes the identity of every stage into the authored text', () => {
    const keyless = ['columns:', '  - id: one', '    label: One', '  - id: two', '    label: Two', ''].join(NL);
    const text = materializeIdentities(keyless);
    expect(parseWorkflow(text).columns.map(column => column.key)).toEqual(['one', 'two']);
    expect(materializeIdentities(text)).toBe(text);
  });
});
