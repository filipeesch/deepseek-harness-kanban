import { describe, expect, it } from 'vitest';
import { perimeterAnchors, stepAnchor } from '../../src/client/workflow-view/connection-interaction.js';

describe('keyboard anchor order', () => {
  it('walks the perimeter from the top-left corner around the stage', () => {
    const points = perimeterAnchors();
    expect(points).toHaveLength(20);
    expect(points[0]).toEqual({ side: 'top', at: 0 });
    expect(points[4]).toEqual({ side: 'top', at: 4 });
    expect(points[5]).toEqual({ side: 'right', at: 0 });
    expect(points[10]).toEqual({ side: 'bottom', at: 4 });
    expect(points[19]).toEqual({ side: 'left', at: 0 });
  });

  it('turns the corner in both directions', () => {
    expect(stepAnchor({ side: 'top', at: 4 }, 'next')).toEqual({ side: 'right', at: 0 });
    expect(stepAnchor({ side: 'right', at: 0 }, 'previous')).toEqual({ side: 'top', at: 4 });
    expect(stepAnchor({ side: 'left', at: 0 }, 'next')).toEqual({ side: 'top', at: 0 });
    expect(stepAnchor({ side: 'top', at: 0 }, 'previous')).toEqual({ side: 'left', at: 0 });
  });

  it('returns to the start after a full turn', () => {
    let anchor = { side: 'right' as const, at: 3 };
    for (let step = 0; step < 20; step++) anchor = stepAnchor(anchor, 'next') as typeof anchor;
    expect(anchor).toEqual({ side: 'right', at: 3 });
  });

  it('falls back to the first point for an unknown anchor', () => {
    expect(stepAnchor({ side: 'top', at: 9 }, 'next')).toEqual({ side: 'top', at: 0 });
  });
});
