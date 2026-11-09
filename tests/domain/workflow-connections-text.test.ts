import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { setConnections } from '../../src/domain/workflow-connections.js';

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const base = ['name: Flow', 'columns:', '  - id: one', '    label: One', '  - id: two', '    label: Two', ''].join(NL);
const layout = { from: 'one', to: 'two', source: { side: 'top' as const, at: 1 } };

describe('authored connection text editing', () => {
  it('leaves an empty flow list and its comment untouched', () => {
    const yaml = base + 'connections: []  # no arrows yet' + NL;
    expect(setConnections(yaml, {})).toBe(yaml);
  });

  it('rewrites a flow list in place and keeps its comment', () => {
    const yaml = base + 'connections: [{from: one, to: two, source: {side: left, at: 1}}]  # arrows' + NL;
    const next = setConnections(yaml, { 'one->two': layout });
    expect(parseWorkflow(next).connections).toEqual([layout]);
    expect(next).toContain('# arrows');
  });

  it('removes the key with the comment written on its own line', () => {
    const yaml = base + 'connections:  # arrows' + NL + '  - from: one' + NL + '    to: two' + NL;
    const next = setConnections(yaml, {});
    expect(parseWorkflow(next).connections).toBeUndefined();
    expect(next).not.toContain('# arrows');
  });

  it('appends a second entry to a block list that ends without a newline', () => {
    const yaml = base + 'connections:' + NL + '  - from: one' + NL + '    to: two';
    const next = setConnections(yaml, { 'one->two': { from: 'one', to: 'two' }, 'two->one': { from: 'two', to: 'one' } });
    expect(parseWorkflow(next).connections).toHaveLength(2);
    expect(next).toContain('    to: two' + NL + '  - from: two');
    expect(next).not.toContain('to: two  - from: two');
  });

  it('edits one flow entry and leaves its neighbour and the comment between them alone', () => {
    const yaml = base + [
      'connections: [',
      '  {from: one, to: two, source: {side: top, at: 0}},',
      '  # retain the return path note',
      '  {from: two, to: one, source: {side: bottom, at: 1}}',
      ']',
      '',
    ].join(NL);
    const next = setConnections(yaml, {
      'one->two': { from: 'one', to: 'two', source: { side: 'top', at: 2 } },
      'two->one': { from: 'two', to: 'one', source: { side: 'bottom', at: 1 } },
    });
    expect(next).toContain('# retain the return path note');
    expect(next).toContain('{from: two, to: one, source: {side: bottom, at: 1}}');
    expect(next).toContain('{from: one, to: two, source: {side: top, at: 2}}');
    expect(next).not.toContain('at: 0');
  });

  it('leaves a flow list byte for byte alone when nothing changed', () => {
    const yaml = base + 'connections: [{from: one, to: two, source: {side: top, at: 0}}]  # arrows' + NL;
    const layouts = { 'one->two': { from: 'one', to: 'two', source: { side: 'top' as const, at: 0 } } };
    expect(setConnections(yaml, layouts)).toBe(yaml);
  });

  it('writes with the line endings the document already uses', () => {
    const yaml = base.split(NL).join(CRLF) + 'connections:' + CRLF + '  - from: one' + CRLF + '    to: two' + CRLF;
    const next = setConnections(yaml, { 'one->two': layout });
    expect(parseWorkflow(next).connections).toEqual([layout]);
    expect(next.includes(String.fromCharCode(13) + NL + '  - from:')).toBe(true);
    // Every line ending in the document is the same one, with no lone newlines.
    expect(next.split(String.fromCharCode(13) + NL).every(part => !part.includes(NL))).toBe(true);
  });

  it('appends a block to a document that ends without a newline', () => {
    const yaml = base + 'connections:' + NL + '  - from: one' + NL + '    to: two';
    const next = setConnections(yaml, { 'one->two': layout });
    expect(parseWorkflow(next).connections).toEqual([layout]);
  });

  it('keeps a comment between two entries when one is removed', () => {
    const yaml = base + 'connections:' + NL + '  - from: one' + NL + '    to: two' + NL + '  # keep me' + NL + '  - from: two' + NL + '    to: one' + NL;
    const next = setConnections(yaml, { 'two->one': { from: 'two', to: 'one' } });
    expect(next).toContain('# keep me');
    expect(next).not.toContain('from: one');
  });

  it('keeps a numeric-looking identifier quoted so it stays a string', () => {
    const yaml = base + 'connections:' + NL + "  - from: '1'" + NL + '    to: two' + NL;
    const next = setConnections(yaml, { '1->two': { from: '1', to: 'two', target: { side: 'left', at: 0 } } });
    expect(parseWorkflow(next).connections).toEqual([{ from: '1', to: 'two', target: { side: 'left', at: 0 } }]);
  });

  it('leaves an entry that authors nothing exactly as written', () => {
    const yaml = base + 'connections:' + NL + '  - from: one' + NL + '    to: two' + NL;
    const next = setConnections(yaml, { 'one->two': { from: 'one', to: 'two' } });
    expect(next).toBe(yaml);
  });

  it('appends an entry before a trailing comment', () => {
    const yaml = base + 'connections:' + NL + '  - from: one' + NL + '    to: two' + NL + '# trailing' + NL;
    const next = setConnections(yaml, { 'one->two': { from: 'one', to: 'two' }, 'two->one': { from: 'two', to: 'one' } });
    expect(parseWorkflow(next).connections).toHaveLength(2);
    expect(next).toContain('# trailing');
  });
});
describe('flow collection documents', () => {
  const root = '{columns: [{id: one, label: One}, {id: two, label: Two}], connections: [{from: one, to: two}]}';

  it('updates the entry without touching the rest of a one-line flow document', () => {
    const next = setConnections(root, { 'one->two': layout });
    expect(parseWorkflow(next).columns.map(column => column.name)).toEqual(['One', 'Two']);
    expect(parseWorkflow(next).connections).toEqual([layout]);
    expect(next.startsWith('{columns: [{id: one, label: One}, {id: two, label: Two}], connections: [')).toBe(true);
    expect(next.trimEnd().endsWith('}')).toBe(true);
  });

  it('removes the key from a flow document when the last entry goes', () => {
    const next = setConnections(root, {});
    expect(parseWorkflow(next).columns).toHaveLength(2);
    expect(parseWorkflow(next).connections).toBeUndefined();
    expect(next).not.toContain('connections');
  });

  it('removes the key from a flow document when it is written first', () => {
    const next = setConnections('{connections: [{from: one, to: two}], columns: [{id: one, label: One}]}', {});
    expect(next).toBe('{columns: [{id: one, label: One}]}');
    expect(parseWorkflow(next).columns).toHaveLength(1);
  });

  it('adds the key inside a flow document that has none', () => {
    const next = setConnections('{columns: [{id: one, label: One}, {id: two, label: Two}]}', { 'one->two': layout });
    expect(parseWorkflow(next).columns).toHaveLength(2);
    expect(parseWorkflow(next).connections).toEqual([layout]);
  });

  it('adds the key to an empty flow root', () => {
    const next = setConnections('{}', { 'one->two': layout });
    expect(next.startsWith('{connections: [')).toBe(true);
  });

  it('keeps a block document with a flow connections list byte for byte outside the value', () => {
    const yaml = base + 'connections: [{from: one, to: two}]  # arrows' + NL;
    const next = setConnections(yaml, { 'one->two': layout });
    expect(next.slice(0, base.length)).toBe(base);
    expect(next.trimEnd().endsWith('# arrows')).toBe(true);
    expect(parseWorkflow(next).connections).toEqual([layout]);
  });
});
