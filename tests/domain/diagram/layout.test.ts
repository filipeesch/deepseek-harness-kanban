import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE_SIZE, STAGE_COLUMN_GAP, STAGE_ROW_GAP, placeStages } from '../../../src/domain/diagram/layout.js';
import type { LayoutNode } from '../../../src/domain/diagram/layout.js';

const nodes: LayoutNode[] = [
  { id: 'one', index: 0 },
  { id: 'two', index: 1 },
  { id: 'three', index: 2 },
];

describe('layered stage placement', () => {
  it('layers a forward path into successive columns', () => {
    const layout = placeStages({ nodes, connections: [{ from: 'one', to: 'two', returning: false }, { from: 'two', to: 'three', returning: false }] });
    expect(layout.placements.get('one')).toEqual({ x: 0, y: 0 });
    expect(layout.placements.get('two')).toEqual({ x: DEFAULT_STAGE_SIZE.width + STAGE_COLUMN_GAP, y: 0 });
    expect(layout.placements.get('three')!.x).toBe(2 * (DEFAULT_STAGE_SIZE.width + STAGE_COLUMN_GAP));
    expect(layout.bounds).toEqual({ width: layout.placements.get('three')!.x + DEFAULT_STAGE_SIZE.width, height: DEFAULT_STAGE_SIZE.height });
  });

  it('stacks the targets of one stage in the same column', () => {
    const layout = placeStages({ nodes, connections: [{ from: 'one', to: 'two', returning: false }, { from: 'one', to: 'three', returning: false }] });
    expect(layout.placements.get('two')!.x).toBe(layout.placements.get('three')!.x);
    expect(layout.placements.get('two')!.y).toBe(0);
    expect(layout.placements.get('three')!.y).toBe(DEFAULT_STAGE_SIZE.height + STAGE_ROW_GAP);
  });

  it('keeps a returning target in its own layer instead of moving it back', () => {
    const layout = placeStages({ nodes, connections: [{ from: 'one', to: 'two', returning: false }, { from: 'three', to: 'one', returning: true }] });
    expect(layout.placements.get('one')!.x).toBe(0);
    expect(layout.placements.get('three')!.x).toBe(0);
    expect(layout.placements.get('three')!.y).toBeGreaterThan(layout.placements.get('one')!.y);
  });
});
