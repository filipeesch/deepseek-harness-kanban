import { describe, expect, it } from 'vitest';
import { GRID_STEP, gridSnapPolicy, noSnap, segmentOffset } from '../../src/client/workflow-view/gestures/grid-snap.js';

const snap = gridSnapPolicy();

describe('grid snap policy', () => {
  it('settles a position on the nearest lattice point on both axes', () => {
    expect(snap.position({ x: 11, y: 13 })).toEqual({ x: 8, y: 16 });
    expect(snap.position({ x: 12, y: 4 })).toEqual({ x: 16, y: 8 });
  });

  it('settles an absolute value rather than a delta from where it started', () => {
    // 100 is already on the lattice; the same raw pointer settles there whatever
    // the gesture's starting point was.
    expect(snap.position({ x: 100, y: 100 })).toEqual({ x: 104, y: 104 });
    expect(snap.position({ x: 96, y: 96 })).toEqual({ x: 96, y: 96 });
  });

  it('settles negative coordinates and normalizes zero', () => {
    expect(snap.position({ x: -3, y: -9 })).toEqual({ x: 0, y: -8 });
    expect(Object.is(snap.coordinate(-1), 0)).toBe(true);
  });

  it('settles a negative tie toward the higher lattice point', () => {
    expect(snap.coordinate(-4)).toBe(0);
    expect(snap.coordinate(-12)).toBe(-8);
    expect(snap.coordinate(-20)).toBe(-16);
  });

  it('uses eight diagram units by default and accepts a different step', () => {
    expect(GRID_STEP).toBe(8);
    expect(gridSnapPolicy(16).position({ x: 20, y: 20 })).toEqual({ x: 16, y: 16 });
    expect(gridSnapPolicy(0).position({ x: 9, y: 9 })).toEqual({ x: 8, y: 8 });
  });

  it('raises a snapped size to the smallest lattice point above the minimum', () => {
    // The accepted minimum is 264x140; 264 is already on the lattice and 140 sits
    // between 136 and 144, so the smallest settled height is 144.
    expect(snap.size({ width: 264, height: 140 })).toEqual({ width: 264, height: 144 });
    expect(snap.size({ width: 130, height: 100 })).toEqual({ width: 264, height: 144 });
    expect(snap.size({ width: 401, height: 260 })).toEqual({ width: 400, height: 264 });
  });

  it('leaves a position and a size untouched with the permissive policy', () => {
    const position = { x: 12.4, y: -3.6 };
    const size = { width: 301.2, height: 140 };
    expect(noSnap.position(position)).toEqual(position);
    expect(noSnap.size(size)).toEqual(size);
    expect(noSnap.position(position)).not.toBe(position);
  });

  it('keeps whole-unit rounding for a segment with the permissive policy', () => {
    expect(noSnap.coordinate(12.4)).toBe(12);
    expect(noSnap.coordinate(-12.6)).toBe(-13);
  });

  it('places a moved segment line on the nearest lattice coordinate', () => {
    expect(snap.coordinate(713)).toBe(712);
    expect(snap.coordinate(717)).toBe(720);
    // The offset is relative to the automatic line, so the settled line is the
    // lattice coordinate and not the offset itself.
    expect(segmentOffset(snap, 713, 500)).toBe(212);
    expect(segmentOffset(snap, 713, 712)).toBe(0);
    expect(segmentOffset(noSnap, 713.4, 500)).toBe(213);
  });
});
