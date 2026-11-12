import { describe, expect, it } from 'vitest';
import { anchorPoint, automaticSourcePoint, fanOutOffset, nearestAnchor, returningDeparturePoint } from '../../src/domain/diagram/ports.js';

const rect = { x: 100, y: 200, width: 200, height: 100 };

describe('anchor points', () => {
  it('resolves the first and last point of each side', () => {
    expect(anchorPoint(rect, { side: 'top', at: 0 })).toEqual({ point: { x: 120, y: 200 }, normal: { x: 0, y: -1 } });
    expect(anchorPoint(rect, { side: 'top', at: 4 })).toEqual({ point: { x: 280, y: 200 }, normal: { x: 0, y: -1 } });
    expect(anchorPoint(rect, { side: 'bottom', at: 2 })).toEqual({ point: { x: 200, y: 300 }, normal: { x: 0, y: 1 } });
    expect(anchorPoint(rect, { side: 'left', at: 1 })).toEqual({ point: { x: 100, y: 230 }, normal: { x: -1, y: 0 } });
    expect(anchorPoint(rect, { side: 'right', at: 3 })).toEqual({ point: { x: 300, y: 270 }, normal: { x: 1, y: 0 } });
  });

  it('points the normal away from the stage on every side', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const placement = anchorPoint(rect, { side, at: 2 });
      const outside = { x: placement.point.x + placement.normal.x, y: placement.point.y + placement.normal.y };
      const inside = outside.x > rect.x && outside.x < rect.x + rect.width && outside.y > rect.y && outside.y < rect.y + rect.height;
      expect(inside).toBe(false);
    }
  });

  it('places every one of the twenty points on its own side, facing out', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      for (let at = 0; at < 5; at++) {
        const placement = anchorPoint(rect, { side, at });
        const fraction = [0.1, 0.3, 0.5, 0.7, 0.9][at]!;
        if (side === 'top' || side === 'bottom') {
          expect(placement.point.x).toBeCloseTo(rect.x + rect.width * fraction, 6);
          expect(placement.point.y).toBe(side === 'top' ? rect.y : rect.y + rect.height);
        } else {
          expect(placement.point.y).toBeCloseTo(rect.y + rect.height * fraction, 6);
          expect(placement.point.x).toBe(side === 'left' ? rect.x : rect.x + rect.width);
        }
        expect(Math.abs(placement.normal.x) + Math.abs(placement.normal.y)).toBe(1);
        const outside = { x: placement.point.x + placement.normal.x, y: placement.point.y + placement.normal.y };
        const inside = outside.x > rect.x && outside.x < rect.x + rect.width && outside.y > rect.y && outside.y < rect.y + rect.height;
        expect(inside).toBe(false);
      }
    }
  });

  it('spreads a fan-out evenly around the middle', () => {
    expect(fanOutOffset(0, 1, 140)).toBe(0);
    expect([0, 1, 2].map(fanOut => fanOutOffset(fanOut, 3, 140))).toEqual([-20, 0, 20]);
    expect(fanOutOffset(7, 8, 40)).toBeLessThanOrEqual(20);
  });

  it('keeps an automatic departure on the right edge', () => {
    expect(automaticSourcePoint(rect, 0, 1)).toEqual({ x: 300, y: 250 });
    expect(returningDeparturePoint(rect, 0, 2).y).toBe(300);
  });
});

describe('nearest anchor', () => {
  it('picks the nearest side for a point outside the stage', () => {
    expect(nearestAnchor(rect, { x: 60, y: 250 }).side).toBe('left');
    expect(nearestAnchor(rect, { x: 340, y: 250 }).side).toBe('right');
    expect(nearestAnchor(rect, { x: 200, y: 150 }).side).toBe('top');
    expect(nearestAnchor(rect, { x: 200, y: 360 }).side).toBe('bottom');
  });

  it('picks the nearest side for a point inside the stage', () => {
    expect(nearestAnchor(rect, { x: 200, y: 210 }).side).toBe('top');
    expect(nearestAnchor(rect, { x: 290, y: 250 }).side).toBe('right');
    expect(nearestAnchor(rect, { x: 200, y: 290 }).side).toBe('bottom');
    expect(nearestAnchor(rect, { x: 110, y: 250 }).side).toBe('left');
  });

  it('settles on the closest of the five points of that side', () => {
    expect(nearestAnchor(rect, { x: 110, y: 150 }).at).toBe(0);
    expect(nearestAnchor(rect, { x: 143, y: 150 }).at).toBe(1);
    expect(nearestAnchor(rect, { x: 200, y: 150 }).at).toBe(2);
    expect(nearestAnchor(rect, { x: 257, y: 150 }).at).toBe(3);
    expect(nearestAnchor(rect, { x: 295, y: 150 }).at).toBe(4);
  });

  it('settles a release outside a corner on the nearer of the two sides', () => {
    expect(nearestAnchor(rect, { x: 95, y: 195 }).side).toBe('left');
    expect(nearestAnchor(rect, { x: 305, y: 305 }).side).toBe('right');
  });

  it('resolves a release on an anchor exactly to that anchor', () => {
    for (let at = 0; at < 5; at++) {
      const x = rect.x + rect.width * [0.1, 0.3, 0.5, 0.7, 0.9][at]!;
      expect(nearestAnchor(rect, { x, y: rect.y - 5 })).toEqual({ side: 'top', at });
    }
  });

  it('never leaves the stage boundary', () => {
    for (const point of [{ x: -500, y: -500 }, { x: 900, y: 900 }, { x: 0, y: 0 }]) {
      const anchor = nearestAnchor(rect, point);
      const placement = anchorPoint(rect, anchor).point;
      const onBoundary = placement.x === rect.x || placement.x === rect.x + rect.width || placement.y === rect.y || placement.y === rect.y + rect.height;
      expect(onBoundary).toBe(true);
    }
  });
});
