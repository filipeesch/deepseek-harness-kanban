import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { readConnections, setConnections } from '../../src/domain/workflow-connections.js';

const NL = String.fromCharCode(10);

const authored = [
  '# Delivery flow',
  'name: Delivery',
  'initial_column: one',
  'columns:',
  '  - id: one            # the start',
  '    label: One',
  '    position: {x: 0, y: 0}',
  '  - id: two',
  '    label: Two',
  '',
].join(NL);

function layouts(yaml: string) {
  return readConnections(parseWorkflow(yaml));
}

describe('authored connection layout', () => {
  it('reads no layout for a document that authors none', () => {
    expect(layouts(authored)).toEqual({});
  });

  it('reads the authored anchors and displacements, keyed by source and target', () => {
    const yaml = authored + [
      'connections:',
      '  - from: one',
      '    to: two',
      '    source: {side: bottom, at: 4}',
      '    segments: [{axis: y, offset: 40}]',
      '',
    ].join(NL);
    expect(layouts(yaml)['one->two']).toEqual({ from: 'one', to: 'two', source: { side: 'bottom', at: 4 }, segments: [{ axis: 'y', offset: 40 }] });
  });

  it('adds the key at the end and keeps the authored document intact', () => {
    const next = setConnections(authored, { 'one->two': { from: 'one', to: 'two', source: { side: 'top', at: 1 } } });
    expect(next.startsWith(authored)).toBe(true);
    expect(next.slice(authored.length)).toBe([
      'connections:',
      '  - from: one',
      '    to: two',
      '    source: {side: top, at: 1}',
      '',
    ].join(NL));
    expect(layouts(next)['one->two']).toEqual({ from: 'one', to: 'two', source: { side: 'top', at: 1 } });
    expect(parseWorkflow(next).columns[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('rewrites only the edited entry and keeps a neighbouring entry and its comment', () => {
    const withTwo = authored + [
      'connections:',
      '  - from: one',
      '    to: two',
      '    target: {side: left, at: 1}',
      '  # the return path',
      '  - from: two',
      '    to: one',
      '    source: {side: bottom, at: 2}',
      '',
    ].join(NL);
    const next = setConnections(withTwo, {
      'one->two': { from: 'one', to: 'two', target: { side: 'left', at: 3 } },
      'two->one': { from: 'two', to: 'one', source: { side: 'bottom', at: 2 } },
    });
    expect(next).toContain('  # the return path' + NL + '  - from: two' + NL + '    to: one' + NL + '    source: {side: bottom, at: 2}');
    expect(next).toContain('  - from: one' + NL + '    to: two' + NL + '    target: {side: left, at: 3}');
    expect(next).not.toContain('at: 1}');
    expect(next.slice(0, authored.length)).toBe(authored);
  });

  it('leaves an unchanged entry exactly as the author wrote it', () => {
    const withEntry = authored + [
      'connections:',
      '  # keep this comment',
      '  - from: one',
      '    to: two',
      '    source: {side: right, at: 2}',
      '',
    ].join(NL);
    const next = setConnections(withEntry, layouts(withEntry));
    expect(next).toBe(withEntry);
  });

  it('removes an entry and drops the key with the last one', () => {
    const withTwo = authored + [
      'connections:',
      '  - from: one',
      '    to: two',
      '    source: {side: right, at: 0}',
      '  - from: two',
      '    to: one',
      '    source: {side: bottom, at: 4}',
      '',
    ].join(NL);
    const withoutOne = setConnections(withTwo, { 'two->one': { from: 'two', to: 'one', source: { side: 'bottom', at: 4 } } });
    expect(withoutOne).not.toContain('from: one');
    expect(layouts(withoutOne)['two->one']).toEqual({ from: 'two', to: 'one', source: { side: 'bottom', at: 4 } });
    const withoutKey = setConnections(withTwo, {});
    expect(withoutKey).toBe(authored);
  });

  it('quotes a stage identifier YAML would read as a number', () => {
    const yaml = authored + 'connections:' + NL + "  - from: '1'" + NL + '    to: two' + NL;
    const next = setConnections(yaml, { '1->two': { from: '1', to: 'two', target: { side: 'top', at: 4 } } });
    expect(next).toContain("'1'");
    expect(layouts(next)['1->two']).toEqual({ from: '1', to: 'two', target: { side: 'top', at: 4 } });
  });

  it('round-trips a layout with both anchors and several displacements', () => {
    const layout = { from: 'one', to: 'two', source: { side: 'right' as const, at: 0 }, target: { side: 'top' as const, at: 4 }, segments: [{ axis: 'x' as const, offset: 64 }, { axis: 'y' as const, offset: -20 }] };
    const next = setConnections(authored, { 'one->two': layout });
    expect(layouts(next)['one->two']).toEqual(layout);
    expect(layouts(setConnections(next, { 'one->two': layout }))['one->two']).toEqual(layout);
  });
});
