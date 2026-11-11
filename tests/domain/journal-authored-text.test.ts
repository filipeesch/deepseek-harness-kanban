import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { appendSequenceItem, removeSequenceItem, replaceSequenceItem } from '../../src/domain/journal/authored-text.js';

const NL = String.fromCharCode(10);
const AUTHORED = [
  '# The delivery flow, authored by hand.',
  'name: Delivery Flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    # This stage starts everything.',
  '  - id: done',
  '    label: Done',
  '',
].join(NL);

describe('authored workflow structural edits', () => {
  it('appends a column and keeps every authored character', () => {
    const text = appendSequenceItem({ text: AUTHORED, sequenceKey: 'columns', item: ['id: review', 'key: s-review', 'label: Review'] });
    const workflow = parseWorkflow(text);
    expect(workflow.columns.map(column => column.id)).toEqual(['backlog', 'done', 'review']);
    expect(workflow.columns[2]?.key).toBe('s-review');
    expect(text).toContain('# The delivery flow, authored by hand.');
    expect(text).toContain('    # This stage starts everything.');
  });

  it('creates the sequence when the document omits it', () => {
    const bare = 'name: Bare' + NL + 'columns:' + NL + '  - id: one' + NL + '    label: One' + NL;
    const text = appendSequenceItem({ text: bare, sequenceKey: 'groups', item: ['id: g1', 'label: Group', 'columns: [one]'] });
    expect(parseWorkflow(text).groups).toEqual([{ id: 'g1', name: 'Group', columnIds: ['one'] }]);
  });

  it('appends to a block sequence whose stage authors an empty flow list', () => {
    const flow = 'columns:' + NL + '  - id: one' + NL + '    label: One' + NL + '    allowed_transitions: []' + NL;
    const text = appendSequenceItem({ text: flow, sequenceKey: 'columns', item: ['id: two', 'label: Two'] });
    expect(parseWorkflow(text).columns.map(column => column.id)).toEqual(['one', 'two']);
  });

  it('appends to an empty flow sequence instead of beside it', () => {
    const empty = 'name: Bare' + NL + 'columns:' + NL + '  - id: one' + NL + '    label: One' + NL + 'groups: []' + NL;
    const text = appendSequenceItem({ text: empty, sequenceKey: 'groups', item: ['id: g1', 'label: Group', 'columns: [one]'] });
    expect(parseWorkflow(text).groups).toEqual([{ id: 'g1', name: 'Group', columnIds: ['one'] }]);
  });

  it('removes one entry from a flow sequence and keeps the others authored text', () => {
    const flow = 'columns:' + NL + '  - id: one' + NL + '    label: One' + NL + '  - id: two' + NL + '    label: Two' + NL + 'groups: [{id: g1, label: First, columns: [one]}, {id: g2, label: Second, columns: [two]}]' + NL;
    const text = removeSequenceItem({ text: flow, sequenceKey: 'groups', fields: { id: 'g1' } });
    expect(parseWorkflow(text).groups).toEqual([{ id: 'g2', name: 'Second', columnIds: ['two'] }]);
    expect(text).toContain('label: Second');
  });

  it('replaces one entry of a flow sequence in place', () => {
    const flow = 'columns:' + NL + '  - id: one' + NL + '    label: One' + NL + '  - id: two' + NL + '    label: Two' + NL + 'groups: [{id: g1, label: First, columns: [one, two]}]' + NL;
    const text = replaceSequenceItem({ text: flow, sequenceKey: 'groups', fields: { id: 'g1' }, item: ['id: g1', 'label: First', 'columns: [one]'], flowItem: '{id: g1, label: First, columns: [one]}' });
    expect(parseWorkflow(text).groups).toEqual([{ id: 'g1', name: 'First', columnIds: ['one'] }]);
  });

  it('removes one item and keeps the neighbouring items intact', () => {
    const text = removeSequenceItem({ text: AUTHORED, sequenceKey: 'columns', fields: { id: 'done' } });
    expect(parseWorkflow(text).columns.map(column => column.id)).toEqual(['backlog']);
    expect(text).toContain('# This stage starts everything.');
    expect(text).toContain('name: Delivery Flow');
  });

  it('removes an item addressed by position, for a sequence whose entries may omit an id', () => {
    const grouped = AUTHORED + 'groups:' + NL + '  - label: First' + NL + '    columns: [backlog]' + NL + '  - label: Second' + NL + '    columns: [done]' + NL;
    const text = removeSequenceItem({ text: grouped, sequenceKey: 'groups', index: 0 });
    expect(parseWorkflow(text).groups.map(group => group.name)).toEqual(['Second']);
  });

  it('replaces one item without touching another', () => {
    const connected = AUTHORED + 'connections:' + NL + '  - from: backlog' + NL + '    to: done' + NL + '  - from: done' + NL + '    to: backlog' + NL;
    const text = replaceSequenceItem({ text: connected, sequenceKey: 'connections', fields: { from: 'done', to: 'backlog' }, item: ['from: done', 'to: done'] });
    expect(parseWorkflow(text).connections).toEqual([{ from: 'backlog', to: 'done' }, { from: 'done', to: 'done' }]);
    expect(text).toContain('  - from: backlog');
  });
});
