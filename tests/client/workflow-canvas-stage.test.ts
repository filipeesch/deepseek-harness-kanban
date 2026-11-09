import { describe, expect, it } from 'vitest';
import { stageSignature, toNode, type CanvasStage } from '../../src/client/workflow-view/canvas-stage.js';

function stage(overrides: Partial<CanvasStage> = {}): CanvasStage {
  return { id: 'one', label: 'One', x: 0, y: 0, width: 260, height: 120, cardIds: ['a'], creatable: true, ...overrides };
}

describe('stage node projection', () => {
  it('carries the creation flag into the node the surface paints', () => {
    expect(toNode(stage(), false).data.creatable).toBe(true);
    expect(toNode(stage({ creatable: false }), false).data.creatable).toBe(false);
  });

  it('re-syncs when any field the node renders changes, including the creation flag', () => {
    const baseline = stageSignature([stage()], false);
    // A rendered field left out of the signature leaves the painted stage stale until
    // some other change forces a re-sync, so each one is pinned here individually.
    const variations: ReadonlyArray<readonly [string, Partial<CanvasStage>]> = [
      ['id', { id: 'other' }],
      ['label', { label: 'Other' }],
      ['x', { x: 1 }],
      ['y', { y: 1 }],
      ['width', { width: 261 }],
      ['height', { height: 121 }],
      ['cardIds', { cardIds: ['b'] }],
      ['creatable', { creatable: false }],
    ];
    for (const [name, override] of variations) {
      expect(stageSignature([stage(override)], false), name).not.toBe(baseline);
    }
    expect(stageSignature([stage()], true)).not.toBe(baseline);
  });

  it('is stable for an unchanged board', () => {
    expect(stageSignature([stage(), stage({ id: 'two', creatable: false })], false))
      .toBe(stageSignature([stage(), stage({ id: 'two', creatable: false })], false));
  });
});
