import { describe, expect, it } from 'vitest';
import { deriveBoardChanges, deriveChanges } from '../../src/domain/journal/derive.js';
import { materialize } from '../../src/domain/journal/materialize.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const NL = String.fromCharCode(10);
function text(lines: string[]): string { return lines.join(NL) + NL; }

const BEFORE = text([
  'name: Delivery',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    key: s1',
  '    label: Backlog',
  '  - id: plan',
  '    key: s2',
  '    label: Plan',
  'groups:',
  '  - id: g1',
  '    label: Delivery',
  '    columns: [backlog, plan]',
  'connections:',
  '  - from: backlog',
  '    to: plan',
]);

describe('board change derivation', () => {
  it('derives nothing for an unchanged board', () => {
    expect(deriveChanges({ text: BEFORE }, { text: BEFORE })).toEqual([]);
  });

  it('publishes a board with no published state whole', () => {
    expect(deriveChanges(null, { text: BEFORE })).toEqual([{ kind: 'workflow.replaced', text: BEFORE }]);
  });

  it('keeps the identity of every stage when a whole-workflow replacement drops the authored identities', () => {
    const replaced = BEFORE.split(NL).filter(line => !line.trim().startsWith('key:')).join(NL);
    expect(replaced).not.toBe(BEFORE);
    expect(deriveChanges({ text: BEFORE }, { text: replaced }, { allocate: () => 'allocated-1' })).toEqual([]);
  });

  it('allocates an identity only for a stage the published board never had', () => {
    const replaced = BEFORE.split(NL).filter(line => !line.trim().startsWith('key:')).join(NL).replace('groups:', '  - id: review' + NL + '    label: Review' + NL + 'groups:');
    const changes = deriveChanges({ text: BEFORE }, { text: replaced }, { allocate: () => 'allocated-1' });
    expect(changes).toEqual([{ kind: 'stage.created', stage: { id: 'review', key: 'allocated-1', name: 'Review' } }]);
  });

  it('derives a removal before a creation that reuses the freed identifier', () => {
    const after = text([
      'name: Delivery',
      'initial_column: backlog',
      'columns:',
      '  - id: backlog',
      '    key: s1',
      '    label: Backlog',
      '  - id: plan',
      '    key: s3',
      '    label: A new stage that reuses the identifier plan',
    ]);
    const changes = deriveChanges({ text: BEFORE }, { text: after }, { allocate: () => 'x' });
    const kinds = changes.map(change => change.kind);
    expect(kinds.indexOf('stage.removed')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('stage.removed')).toBeLessThan(kinds.indexOf('stage.created'));
    let applied = BEFORE;
    for (const change of changes) applied = materialize(applied, change);
    expect(parseWorkflow(applied).columns.map(column => column.key)).toEqual(['s1', 's3']);
  });

  it('resolves an identity for a published workflow that keys only some stages', () => {
    const partiallyKeyed = text([
      'name: Delivery',
      'initial_column: backlog',
      'columns:',
      '  - id: backlog',
      '    key: s1',
      '    label: Backlog',
      '  - id: plan',
      '    label: Plan',
    ]);
    const local = partiallyKeyed.replace('    label: Plan', '    label: Planning');
    const changes = deriveChanges({ text: partiallyKeyed }, { text: local }, { allocate: () => 'allocated-1' });
    expect(changes).toEqual([{ kind: 'stage.field-changed', key: 'plan', field: 'name', value: 'Planning' }]);
    for (const change of changes) expect(JSON.stringify(change)).not.toContain('undefined');
  });

  it('derives one identifier event for a rename', () => {
    const after = BEFORE.replace('initial_column: backlog', 'initial_column: inbox').replace('  - id: backlog', '  - id: inbox').replace('columns: [backlog, plan]', 'columns: [inbox, plan]').replace('from: backlog', 'from: inbox');
    const changes = deriveChanges({ text: BEFORE }, { text: after });
    expect(changes.filter(change => change.kind === 'stage.id-changed')).toEqual([{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }]);
    expect(changes).toHaveLength(1);
  });

  it('derives one coalesced layout event for a move and a resize', () => {
    const after = BEFORE.replace('    label: Plan', '    label: Plan' + NL + '    position: {x: 10, y: 20}' + NL + '    size: {width: 300, height: 200}');
    expect(deriveChanges({ text: BEFORE }, { text: after })).toEqual([
      { kind: 'stage.layout-set', key: 's2', position: { x: 10, y: 20 }, size: { width: 300, height: 200 } },
    ]);
  });

  it('derives a creation and a removal', () => {
    const grown = BEFORE.replace('groups:', '  - id: review' + NL + '    key: s3' + NL + '    label: Review' + NL + 'groups:');
    expect(deriveChanges({ text: BEFORE }, { text: grown })).toEqual([
      { kind: 'stage.created', stage: { id: 'review', key: 's3', name: 'Review' } },
    ]);
    const shrunk = text([
      'name: Delivery',
      'initial_column: backlog',
      'columns:',
      '  - id: backlog',
      '    key: s1',
      '    label: Backlog',
    ]);
    const changes = deriveChanges({ text: BEFORE }, { text: shrunk });
    expect(changes.filter(change => change.kind === 'stage.removed')).toEqual([{ kind: 'stage.removed', key: 's2' }]);
    expect(changes.filter(change => change.kind === 'group.removed')).toEqual([{ kind: 'group.removed', id: 'g1' }]);
    expect(changes.filter(change => change.kind === 'connection.removed')).toEqual([{ kind: 'connection.removed', from: 'backlog', to: 'plan' }]);
  });

  it('derives one field event per changed field', () => {
    const after = text([
      'name: Delivery',
      'initial_column: backlog',
      'default_view: workflow',
      'columns:',
      '  - id: backlog',
      '    key: s1',
      '    label: Inbox',
      '    on_enter_prompt: Start here.',
      '  - id: plan',
      '    key: s2',
      '    label: Plan',
      '    allowed_transitions:',
      '      - to: backlog',
      'groups:',
      '  - id: g1',
      '    label: Flow',
      '    columns: [backlog, plan]',
      'connections:',
      '  - from: backlog',
      '    to: plan',
    ]);
    const changes = deriveChanges({ text: BEFORE }, { text: after });
    expect(changes).toContainEqual({ kind: 'workflow.field-changed', field: 'defaultView', value: 'workflow' });
    expect(changes).toContainEqual({ kind: 'stage.field-changed', key: 's1', field: 'name', value: 'Inbox' });
    expect(changes).toContainEqual({ kind: 'stage.field-changed', key: 's1', field: 'onEnterPrompt', value: 'Start here.' });
    expect(changes).toContainEqual({ kind: 'stage.field-changed', key: 's2', field: 'allowedTransitions', value: [{ to: 'backlog' }] });
    expect(changes).toContainEqual({ kind: 'group.field-changed', id: 'g1', field: 'name', value: 'Flow' });
  });

  it('derives a connection layout change', () => {
    const after = BEFORE.replace('    to: plan', '    to: plan' + NL + '    source: {side: right, at: 2}');
    expect(deriveChanges({ text: BEFORE }, { text: after })).toEqual([
      { kind: 'connection.set', layout: { from: 'backlog', to: 'plan', source: { side: 'right', at: 2 } } },
    ]);
  });

  it('derives an initial stage change', () => {
    const after = BEFORE.replace('initial_column: backlog', 'initial_column: plan');
    expect(deriveChanges({ text: BEFORE }, { text: after })).toEqual([{ kind: 'workflow.initial-changed', columnId: 'plan' }]);
  });

  it('reproduces the published state when the changes are applied', () => {
    const after = text([
      'name: Delivery',
      'initial_column: plan',
      'columns:',
      '  - id: inbox',
      '    key: s1',
      '    label: Inbox',
      '    position: {x: 3, y: 4}',
      '  - id: plan',
      '    key: s2',
      '    label: Planning',
      '  - id: review',
      '    key: s3',
      '    label: Review',
      'groups:',
      '  - id: g1',
      '    label: Flow',
      '    columns: [inbox, plan]',
      'connections:',
      '  - from: plan',
      '    to: review',
    ]);
    const changes = deriveChanges({ text: BEFORE }, { text: after });
    let applied = BEFORE;
    for (const change of changes) applied = materialize(applied, change);
    const produced = parseWorkflow(applied);
    const wanted = parseWorkflow(after);
    expect(produced.columns.map(column => [column.id, column.key, column.name])).toEqual(wanted.columns.map(column => [column.id, column.key, column.name]));
    expect(produced.initialColumnId).toBe(wanted.initialColumnId);
    expect(produced.groups).toEqual(wanted.groups);
    expect(produced.connections).toEqual(wanted.connections);
    expect(produced.columns[0]?.position).toEqual({ x: 3, y: 4 });
  });
});

describe('board identity derivation', () => {
  const local = { workflow: BEFORE, name: 'Delivery', projectKeys: null as string[] | null, rank: 'i' };

  it('publishes a board with no published state whole, identity included', () => {
    const changes = deriveBoardChanges(null, local);
    expect(changes.map(change => change.kind)).toEqual(['workflow.replaced', 'board.renamed', 'board.scope-changed', 'board.rank-changed']);
  });

  it('derives a rename alone', () => {
    expect(deriveBoardChanges({ workflow: BEFORE, name: 'Delivery', projectKeys: null, rank: 'i' }, { ...local, name: 'Renamed' })).toEqual([{ kind: 'board.renamed', name: 'Renamed' }]);
  });

  it('derives a project scope change alone', () => {
    expect(deriveBoardChanges({ workflow: BEFORE, name: 'Delivery', projectKeys: null, rank: 'i' }, { ...local, projectKeys: ['app'] })).toEqual([{ kind: 'board.scope-changed', projectKeys: ['app'] }]);
    expect(deriveBoardChanges({ workflow: BEFORE, name: 'Delivery', projectKeys: ['app'], rank: 'i' }, { ...local, projectKeys: null })).toEqual([{ kind: 'board.scope-changed', projectKeys: null }]);
  });

  it('derives a position change alone', () => {
    expect(deriveBoardChanges({ workflow: BEFORE, name: 'Delivery', projectKeys: null, rank: 'i' }, { ...local, rank: 'n' })).toEqual([{ kind: 'board.rank-changed', rank: 'n' }]);
  });

  it('derives nothing when everything matches', () => {
    expect(deriveBoardChanges({ workflow: BEFORE, name: 'Delivery', projectKeys: null, rank: 'i' }, local)).toEqual([]);
  });

  it('mixes workflow and identity changes in one batch', () => {
    const changes = deriveBoardChanges(
      { workflow: BEFORE, name: 'Delivery', projectKeys: null, rank: 'i' },
      { ...local, name: 'Renamed', projectKeys: ['app'], rank: 'n', workflow: BEFORE.replace('label: Plan', 'label: Planning') },
    );
    expect(changes.map(change => change.kind)).toEqual(['stage.field-changed', 'board.renamed', 'board.scope-changed', 'board.rank-changed']);
  });
});
