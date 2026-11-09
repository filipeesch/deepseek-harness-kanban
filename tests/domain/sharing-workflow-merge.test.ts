import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { readStagePositions } from '../../src/domain/workflow-positions.js';
import { readStageSizes } from '../../src/domain/workflow-sizes.js';
import { readConnections } from '../../src/domain/workflow-connections.js';
import { mergeWorkflowPlacements } from '../../src/domain/sharing/workflow-merge.js';
import type { WorkflowVersion } from '../../src/domain/sharing/workflow-merge.js';

const nl = String.fromCharCode(10);
type ColumnSpec = readonly [id: string, label: string, position?: readonly [number, number], size?: readonly [number, number]];

function yaml(columns: readonly ColumnSpec[], leading: readonly string[] = []): string {
  const lines = [...leading, 'columns:'];
  for (const [id, label, position, size] of columns) {
    lines.push('  - id: ' + id);
    lines.push('    label: ' + label);
    if (position !== undefined) lines.push('    position: {x: ' + position[0] + ', y: ' + position[1] + '}');
    if (size !== undefined) lines.push('    size: {width: ' + size[0] + ', height: ' + size[1] + '}');
  }
  lines.push('');
  return lines.join(nl);
}

const baseColumns: readonly ColumnSpec[] = [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']];
const base: WorkflowVersion = { name: 'Delivery', workflow: yaml(baseColumns) };

function version(name: string, columns: readonly ColumnSpec[], leading: readonly string[] = []): WorkflowVersion {
  return { name, workflow: yaml(columns, leading) };
}

function positionsOf(value: string): Record<string, unknown> {
  return readStagePositions(parseWorkflow(value));
}

function sizesOf(value: string): Record<string, unknown> {
  return readStageSizes(parseWorkflow(value));
}

describe('workflow placement merge', () => {
  it('returns the local version when every side is identical', () => {
    const result = mergeWorkflowPlacements({ base, local: base, published: base });
    expect(result?.workflow).toBe(base.workflow);
    expect(result?.name).toBe('Delivery');
  });

  it('merges a placement-only difference from both sides', () => {
    const local = version('Delivery', [['todo', 'To do', [50, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [260, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result).not.toBeNull();
    expect(positionsOf(result!.workflow)).toEqual({ todo: { x: 50, y: 0 }, doing: { x: 260, y: 0 } });
  });

  it('keeps the local placement when both sides moved the same stage', () => {
    const local = version('Delivery', [['todo', 'To do', [50, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do', [90, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(positionsOf(result!.workflow).todo).toEqual({ x: 50, y: 0 });
  });

  it('keeps the local placement beside a published meaning change', () => {
    const local = version('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [300, 0]], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do', [10, 10]], ['doing', 'Active', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result).not.toBeNull();
    expect(result!.workflow).toContain('label: Active');
    expect(positionsOf(result!.workflow)).toEqual({ todo: { x: 10, y: 10 }, doing: { x: 300, y: 0 } });
  });

  it('keeps the local meaning and applies a published placement move', () => {
    const local = version('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Finished']]);
    const published = version('Delivery', [['todo', 'To do', [70, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result!.workflow).toContain('label: Finished');
    expect(positionsOf(result!.workflow).todo).toEqual({ x: 70, y: 0 });
  });

  it('refuses two different meaning changes', () => {
    const local = version('Delivery', [['todo', 'Todo'], ['doing', 'Doing'], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Finished']]);
    expect(mergeWorkflowPlacements({ base, local, published })).toBeNull();
  });

  it('accepts the same meaning change on both sides', () => {
    const shared: readonly ColumnSpec[] = [['todo', 'Todo'], ['doing', 'Doing'], ['done', 'Done']];
    const result = mergeWorkflowPlacements({ base, local: version('Delivery', shared), published: version('Delivery', shared) });
    expect(result?.workflow).toContain('label: Todo');
  });

  it('keeps the local authored text and comments when the local meaning wins', () => {
    const local = version('Delivery', [['todo', 'Todo', [0, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']], ['# Local comment']);
    const published = version('Delivery', [['todo', 'To do'], ['doing', 'Doing', [90, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result!.workflow).toContain('# Local comment');
    expect(positionsOf(result!.workflow).doing).toEqual({ x: 90, y: 0 });
  });

  it('takes the published authored text when the published meaning wins', () => {
    const local = version('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']], ['# Local comment']);
    const published = version('Delivery', [['todo', 'To do'], ['doing', 'Doing', [55, 0]], ['done', 'Finished']], ['# Team comment']);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result!.workflow).toContain('# Team comment');
    expect(result!.workflow).not.toContain('# Local comment');
  });

  it('refuses two different renames', () => {
    const local = version('Local name', baseColumns);
    const published = version('Team name', baseColumns);
    expect(mergeWorkflowPlacements({ base, local, published })).toBeNull();
  });

  it('keeps a local-only rename beside a published placement move', () => {
    const local = version('Local name', baseColumns);
    const published = version('Delivery', [['todo', 'To do', [5, 5]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result?.name).toBe('Local name');
    expect(positionsOf(result!.workflow).todo).toEqual({ x: 5, y: 5 });
  });

  it('merges a size-only difference from both sides', () => {
    const local = version('Delivery', [['todo', 'To do', [0, 0], [400, 300]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do', [0, 0], [300, 200]], ['doing', 'Doing', [200, 0], [500, 400]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result).not.toBeNull();
    expect(sizesOf(result!.workflow)).toEqual({ todo: { width: 400, height: 300 }, doing: { width: 500, height: 400 } });
  });

  it('keeps the local size when both sides resized the same stage', () => {
    const local = version('Delivery', [['todo', 'To do', [0, 0], [400, 300]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do', [0, 0], [320, 220]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(sizesOf(result!.workflow).todo).toEqual({ width: 400, height: 300 });
  });

  it('merges a local move with a published resize', () => {
    const local = version('Delivery', [['todo', 'To do', [50, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do', [0, 0], [400, 300]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(positionsOf(result!.workflow).todo).toEqual({ x: 50, y: 0 });
    expect(sizesOf(result!.workflow).todo).toEqual({ width: 400, height: 300 });
  });

  it('treats a size difference as layout rather than a meaning conflict', () => {
    const local = version('Delivery', [['todo', 'To do', [0, 0], [400, 300]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const published = version('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0], [500, 400]], ['done', 'Done']]);
    expect(mergeWorkflowPlacements({ base, local, published })).not.toBeNull();
  });

  it('drops a size of a stage the winning meaning no longer defines', () => {
    const local = version('Delivery', [['todo', 'To do', [0, 0], [400, 300]], ['doing', 'Doing', [200, 0], [300, 200]]]);
    const published = version('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base, local, published });
    expect(result!.workflow).not.toContain('id: done');
    expect(sizesOf(result!.workflow).done).toBeUndefined();
  });

  it('drops a placement of a stage the winning meaning no longer defines', () => {
    const published = version('Delivery', [['todo', 'To do', [0, 0]], ['doing', 'Doing', [200, 0]]]);
    const result = mergeWorkflowPlacements({ base, local: base, published });
    expect(result!.workflow).not.toContain('id: done');
    expect(positionsOf(result!.workflow).done).toBeUndefined();
  });
});

function withConnections(columns: readonly ColumnSpec[], entries: readonly (readonly string[])[]): string {
  const lines = [yaml(columns).trimEnd()];
  if (entries.length > 0) {
    lines.push('connections:');
    for (const entry of entries) {
      entry.forEach((line, index) => lines.push(index === 0 ? '  - ' + line : '    ' + line));
    }
  }
  lines.push('');
  return lines.join(nl);
}

function versionWithConnections(columns: readonly ColumnSpec[], entries: readonly (readonly string[])[]): WorkflowVersion {
  return { name: 'Delivery', workflow: withConnections(columns, entries) };
}

function connectionsOf(value: string): Record<string, unknown> {
  return readConnections(parseWorkflow(value));
}

describe('workflow connection layout merge', () => {
  const plain = versionWithConnections(baseColumns, []);
  const forward: readonly string[] = ['from: todo', 'to: doing', 'source: {side: right, at: 4}'];
  const other: readonly string[] = ['from: doing', 'to: done', 'source: {side: bottom, at: 1}'];

  it('applies a team-only connection adjustment', () => {
    const published = versionWithConnections(baseColumns, [forward]);
    const result = mergeWorkflowPlacements({ base: plain, local: plain, published });
    expect(result).not.toBeNull();
    expect(connectionsOf(result!.workflow)['todo->doing']).toEqual({ from: 'todo', to: 'doing', source: { side: 'right', at: 4 } });
  });

  it('keeps a local-only connection adjustment', () => {
    const local = versionWithConnections(baseColumns, [forward]);
    const result = mergeWorkflowPlacements({ base: plain, local, published: plain });
    expect(connectionsOf(result!.workflow)['todo->doing']).toEqual({ from: 'todo', to: 'doing', source: { side: 'right', at: 4 } });
  });

  it('keeps the local adjustment when both sides adjusted the same connection', () => {
    const local = versionWithConnections(baseColumns, [['from: todo', 'to: doing', 'source: {side: right, at: 0}']]);
    const published = versionWithConnections(baseColumns, [['from: todo', 'to: doing', 'source: {side: right, at: 3}']]);
    const result = mergeWorkflowPlacements({ base: plain, local, published });
    expect(connectionsOf(result!.workflow)['todo->doing']).toEqual({ from: 'todo', to: 'doing', source: { side: 'right', at: 0 } });
  });

  it('keeps both sides when each adjusted a different connection', () => {
    const local = versionWithConnections(baseColumns, [forward]);
    const published = versionWithConnections(baseColumns, [other]);
    const result = mergeWorkflowPlacements({ base: plain, local, published });
    expect(connectionsOf(result!.workflow)['todo->doing']).toEqual({ from: 'todo', to: 'doing', source: { side: 'right', at: 4 } });
    expect(connectionsOf(result!.workflow)['doing->done']).toEqual({ from: 'doing', to: 'done', source: { side: 'bottom', at: 1 } });
  });

  it('keeps a local connection adjustment beside a published meaning change', () => {
    const local = versionWithConnections(baseColumns, [forward]);
    const published = version('Delivery 2', [['todo', 'To do', [0, 0]], ['doing', 'In progress', [200, 0]], ['done', 'Done']]);
    const result = mergeWorkflowPlacements({ base: plain, local, published });
    expect(result).not.toBeNull();
    expect(parseWorkflow(result!.workflow).columns[1]!.name).toBe('In progress');
    expect(connectionsOf(result!.workflow)['todo->doing']).toEqual({ from: 'todo', to: 'doing', source: { side: 'right', at: 4 } });
  });

  it('does not treat a connection adjustment as a meaning change', () => {
    const local = versionWithConnections(baseColumns, [forward]);
    const published = versionWithConnections(baseColumns, [other]);
    const result = mergeWorkflowPlacements({ base: plain, local, published });
    expect(result).not.toBeNull();
  });
});
