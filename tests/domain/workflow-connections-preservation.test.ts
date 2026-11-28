import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { setConnections } from '../../src/domain/workflow-connections.js';

/**
 * Exact-byte preservation for the shared connection editor.
 *
 * Each fixture is a complete valid workflow. The expected document is written out
 * in full (or as the exact untouched document minus the chosen bytes), so a change
 * to an untouched entry, comment, or stage dimension fails the test rather than
 * passing a semantic check.
 */

const COLUMNS = `columns:
  - id: alpha
    label: Alpha
    size: {width: 380, height: 240}
  - id: beta
    label: Beta
  - id: gamma
    label: Gamma
  - id: delta
    label: Delta`;

describe('flow connection removal and insertion', () => {
  it('drops the only connection of a flow root without deleting the comment before columns', () => {
    const yaml = `{name: Legacy, initial_column: alpha, connections: [{from: alpha, to: beta}], # the columns below
 columns: [{id: alpha, label: Alpha}, {id: beta, label: Beta}]}`;
    const expected = `{name: Legacy, initial_column: alpha,  # the columns below
 columns: [{id: alpha, label: Alpha}, {id: beta, label: Beta}]}`;
    const next = setConnections(yaml, {});
    expect(next).toBe(expected);
    const workflow = parseWorkflow(next);
    expect(workflow.connections).toBeUndefined();
    expect(workflow.columns.map(column => column.id)).toEqual(['alpha', 'beta']);
  });

  it('replaces the sole connection of a block-root flow list in one call', () => {
    const yaml = `name: Sole
initial_column: alpha
${COLUMNS}
connections: [{from: alpha, to: beta}]
`;
    const expected = yaml.replace('[{from: alpha, to: beta}]', '[{from: alpha, to: gamma}]');
    const next = setConnections(yaml, { 'alpha->gamma': { from: 'alpha', to: 'gamma' } });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([{ from: 'alpha', to: 'gamma' }]);
    expect(next).toContain('size: {width: 380, height: 240}');
  });

  it('replaces the sole connection of a flow root in one call', () => {
    const yaml = `{name: Sole root, initial_column: alpha, columns: [{id: alpha, label: Alpha}, {id: beta, label: Beta}, {id: gamma, label: Gamma}], connections: [{from: alpha, to: beta}]}`;
    const expected = yaml.replace('[{from: alpha, to: beta}]', '[{from: alpha, to: gamma}]');
    const next = setConnections(yaml, { 'alpha->gamma': { from: 'alpha', to: 'gamma' } });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([{ from: 'alpha', to: 'gamma' }]);
  });

  it('removes every old connection and adds one in the same call', () => {
    const yaml = `name: Replace
initial_column: alpha
${COLUMNS}
connections: [{from: alpha, to: beta}, {from: beta, to: gamma}]
`;
    const expected = yaml.replace('[{from: alpha, to: beta}, {from: beta, to: gamma}]', '[ {from: gamma, to: alpha}]');
    const next = setConnections(yaml, { 'gamma->alpha': { from: 'gamma', to: 'alpha' } });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([{ from: 'gamma', to: 'alpha' }]);
    expect(next).toContain('size: {width: 380, height: 240}');
  });

  it('removes every old connection of a flow root and adds one in the same call', () => {
    const yaml = `{name: Replace root, initial_column: alpha, columns: [{id: alpha, label: Alpha}, {id: beta, label: Beta}, {id: gamma, label: Gamma}], connections: [{from: alpha, to: beta}, {from: beta, to: gamma}]}`;
    const expected = yaml.replace('[{from: alpha, to: beta}, {from: beta, to: gamma}]', '[ {from: gamma, to: alpha}]');
    const next = setConnections(yaml, { 'gamma->alpha': { from: 'gamma', to: 'alpha' } });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([{ from: 'gamma', to: 'alpha' }]);
  });

  it('appends after a legal trailing comma without adding another one', () => {
    const yaml = `name: Trailing
initial_column: alpha
${COLUMNS}
connections: [{from: alpha, to: beta}, # keep this note
  ]
`;
    // The existing indentation before the closing bracket stays, so the appended
    // entry lands on its own indented line after the surviving comment.
    const expected = yaml.replace('\n  ]', '\n  {from: beta, to: gamma}]');
    const next = setConnections(yaml, {
      'alpha->beta': { from: 'alpha', to: 'beta' },
      'beta->gamma': { from: 'beta', to: 'gamma' },
    });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([
      { from: 'alpha', to: 'beta' },
      { from: 'beta', to: 'gamma' },
    ]);
    expect(next).toContain('# keep this note');
  });

  it('appends after a legal trailing comma in a flow root without adding another one', () => {
    const yaml = `{name: Trailing root, initial_column: alpha, columns: [{id: alpha, label: Alpha}, {id: beta, label: Beta}], connections: [{from: alpha, to: beta}, # keep this note
]}`;
    const expected = yaml.replace('\n]}', '\n{from: beta, to: alpha}]}');
    const next = setConnections(yaml, {
      'alpha->beta': { from: 'alpha', to: 'beta' },
      'beta->alpha': { from: 'beta', to: 'alpha' },
    });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([
      { from: 'alpha', to: 'beta' },
      { from: 'beta', to: 'alpha' },
    ]);
  });
});

describe('flow connection removal positions', () => {
  const MATRIX = `name: Matrix
initial_column: alpha
${COLUMNS}
connections: [{from: alpha, to: beta}, # keep beta
  {from: 'beta', to: gamma}, {from: gamma, to: delta}, {from: alpha, to: gamma}]
`;
  const KEPT = [
    { from: 'alpha', to: 'beta' },
    { from: 'beta', to: 'gamma' },
    { from: 'gamma', to: 'delta' },
    { from: 'alpha', to: 'gamma' },
  ];

  it('removes the first entry and keeps the comment and the quoted neighbour', () => {
    const expected = MATRIX.replace('{from: alpha, to: beta},', '');
    const next = setConnections(MATRIX, { 'beta->gamma': KEPT[1]!, 'gamma->delta': KEPT[2]!, 'alpha->gamma': KEPT[3]! });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([KEPT[1]!, KEPT[2]!, KEPT[3]!]);
    expect(next).toContain('# keep beta');
    expect(next).toContain("{from: 'beta', to: gamma}");
    expect(next).toContain('size: {width: 380, height: 240}');
  });

  it('removes a middle entry and keeps the quoted neighbours and the comment', () => {
    const expected = MATRIX.replace("{from: 'beta', to: gamma},", '');
    const next = setConnections(MATRIX, { 'alpha->beta': KEPT[0]!, 'gamma->delta': KEPT[2]!, 'alpha->gamma': KEPT[3]! });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([KEPT[0]!, KEPT[2]!, KEPT[3]!]);
    expect(next).toContain('# keep beta');
    expect(next).toContain('{from: alpha, to: beta}');
    expect(next).toContain('size: {width: 380, height: 240}');
  });

  it('removes the last entry and keeps the comma space before the close', () => {
    const expected = MATRIX.replace(', {from: alpha, to: gamma}', ' ');
    const next = setConnections(MATRIX, { 'alpha->beta': KEPT[0]!, 'beta->gamma': KEPT[1]!, 'gamma->delta': KEPT[2]! });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([KEPT[0]!, KEPT[1]!, KEPT[2]!]);
    expect(next).toContain('size: {width: 380, height: 240}');
  });

  it('removes two adjacent entries and keeps the surviving quoted entry and comment', () => {
    const expected = MATRIX.replace('{from: alpha, to: beta},', '').replace("{from: 'beta', to: gamma},", '');
    const next = setConnections(MATRIX, { 'gamma->delta': KEPT[2]!, 'alpha->gamma': KEPT[3]! });
    expect(next).toBe(expected);
    expect(parseWorkflow(next).connections).toEqual([KEPT[2]!, KEPT[3]!]);
    expect(next).toContain('# keep beta');
    expect(next).toContain('{from: gamma, to: delta}');
    expect(next).toContain('size: {width: 380, height: 240}');
  });
});
