import { describe, expect, it } from 'vitest';
import { AFFORDANCE, MIN_POINTER_TARGET, affordanceScale, diagramBox, markSize, screenSizeOf } from '../../src/client/workflow-view/affordance-geometry.js';
import { FLOW_ZOOM } from '../../src/client/workflow-view/gestures/viewport-policy.js';

const zooms = [FLOW_ZOOM.min, 1, FLOW_ZOOM.max] as const;

describe('affordance geometry', () => {
  it('keeps a mark at its authored screen size at every zoom level', () => {
    for (const zoom of zooms) {
      expect(screenSizeOf(markSize(AFFORDANCE.mark, zoom), zoom)).toBeCloseTo(AFFORDANCE.mark, 5);
      expect(screenSizeOf(markSize(AFFORDANCE.grip, zoom), zoom)).toBeCloseTo(AFFORDANCE.grip, 5);
    }
  });

  it('keeps a pointer target at the minimum at every zoom level', () => {
    for (const zoom of zooms) {
      expect(screenSizeOf(markSize(MIN_POINTER_TARGET, zoom), zoom)).toBeCloseTo(MIN_POINTER_TARGET, 5);
    }
  });

  it('never authors a target below the minimum', () => {
    expect(AFFORDANCE.target).toBeGreaterThanOrEqual(MIN_POINTER_TARGET);
  });

  it('falls back for a zoom the surface has not measured', () => {
    expect(affordanceScale(0)).toBe(1);
    expect(affordanceScale(Number.NaN)).toBe(1);
    expect(affordanceScale(-1)).toBe(1);
    expect(affordanceScale(2)).toBe(0.5);
  });
});
describe('diagram box', () => {
  it('pads a straight route by the requested amount', () => {
    expect(diagramBox([{ x: 10, y: 20 }, { x: 110, y: 20 }], 16)).toEqual({ x: -6, y: 4, width: 132, height: 32 });
  });

  it('covers both axes of a returning route', () => {
    expect(diagramBox([{ x: 100, y: 50 }, { x: 100, y: 150 }, { x: 20, y: 150 }], 8)).toEqual({ x: 12, y: 42, width: 96, height: 116 });
  });

  it('keeps a box of its own padding for an empty route', () => {
    expect(diagramBox([], 12)).toEqual({ x: -12, y: -12, width: 24, height: 24 });
  });
});
