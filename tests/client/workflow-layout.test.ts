import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE_SIZE, STAGE_COLUMN_GAP, placeStages, placementBounds } from '../../src/client/workflow-view/layout.js';
import type { LayoutConnection, LayoutNode } from '../../src/client/workflow-view/layout.js';

const nodes: LayoutNode[] = [
  { id: 'one', index: 0 },
  { id: 'two', index: 1 },
  { id: 'three', index: 2 },
  { id: 'four', index: 3 },
];

const positions = (connections: readonly LayoutConnection[]) => {
  const layout = placeStages({ nodes, connections });
  return Object.fromEntries([...layout.placements].map(([id, position]) => [id, position]));
};

describe('layered stage layout', () => {
  it('places a chain in successive columns', () => {
    const values = positions([{ from: 'one', to: 'two', returning: false }, { from: 'two', to: 'three', returning: false }]);
    expect(values['one']).toEqual({ x: 0, y: 0 });
    expect(values['two']!.x).toBe(DEFAULT_STAGE_SIZE.width + STAGE_COLUMN_GAP);
    expect(values['three']!.x).toBe((DEFAULT_STAGE_SIZE.width + STAGE_COLUMN_GAP) * 2);
  });

  it('puts two targets of one stage in the same column', () => {
    const values = positions([{ from: 'one', to: 'two', returning: false }, { from: 'one', to: 'four', returning: false }]);
    expect(values['two']!.x).toBe(values['four']!.x);
    expect(values['two']!.y).not.toBe(values['four']!.y);
  });

  it('keeps the target of a returning connection in its own layer', () => {
    const values = positions([{ from: 'one', to: 'two', returning: false }, { from: 'three', to: 'one', returning: true }]);
    expect(values['one']!.x).toBe(0);
    expect(values['three']!.x).toBe(0);
    expect(values['three']!.y).toBeGreaterThan(values['one']!.y);
  });

  it('orders a column by workflow order and keeps a group together', () => {
    const grouped: LayoutNode[] = [
      { id: 'a', index: 0 },
      { id: 'b', index: 1, groupId: 'g' },
      { id: 'c', index: 2, groupId: 'g' },
      { id: 'd', index: 3 },
    ];
    const layout = placeStages({ nodes: grouped, connections: [] });
    const order = [...layout.placements.entries()].sort((left, right) => left[1].y - right[1].y).map(([id]) => id);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('uses measured sizes for columns and bounds', () => {
    const layout = placeStages({
      nodes: [{ id: 'one', index: 0 }, { id: 'two', index: 1 }],
      connections: [{ from: 'one', to: 'two', returning: false }],
      sizes: new Map([['one', { width: 400, height: 200 }], ['two', { width: 300, height: 100 }]]),
    });
    expect(layout.placements.get('two')!.x).toBe(400 + STAGE_COLUMN_GAP);
    expect(layout.bounds).toEqual({ width: 400 + STAGE_COLUMN_GAP + 300, height: 200 });
  });

  it('reports the extent of the placed stages', () => {
    const bounds = placementBounds(new Map([['one', { x: 10, y: 20 }]]), new Map([['one', { width: 100, height: 50 }]]));
    expect(bounds).toEqual({ width: 110, height: 70 });
  });

  it('places a single stage at the origin', () => {
    const layout = placeStages({ nodes: [{ id: 'only', index: 0 }], connections: [] });
    expect(layout.placements.get('only')).toEqual({ x: 0, y: 0 });
    expect(layout.bounds).toEqual({ width: DEFAULT_STAGE_SIZE.width, height: DEFAULT_STAGE_SIZE.height });
  });
});
