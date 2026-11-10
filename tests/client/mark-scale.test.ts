import { describe, expect, it } from 'vitest';
import { MARK_SCALE_LIMIT, markScale } from '../../src/client/workflow-view/gestures/viewport-policy.js';

describe('attention mark scale', () => {
  it('keeps the authored size at and above the bound', () => {
    expect(markScale(1)).toBe(1);
    expect(markScale(2.5)).toBe(1);
    expect(markScale(0.5)).toBe(2);
  });

  it('bounds the growth at the minimum zoom', () => {
    expect(MARK_SCALE_LIMIT).toBe(3.5);
    expect(markScale(0.2)).toBe(3.5);
    expect(markScale(0.1)).toBe(3.5);
  });

  it('stays constant on screen down to the bound', () => {
    // The on-screen size is authored size times scale times zoom; above the bound it is constant.
    for (const zoom of [1, 0.8, 0.5, 0.3]) expect(markScale(zoom) * zoom).toBeCloseTo(1, 5);
  });

  it('treats an unusable zoom as 1', () => {
    expect(markScale(0)).toBe(1);
    expect(markScale(-2)).toBe(1);
    expect(markScale(Number.NaN)).toBe(1);
    expect(markScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
