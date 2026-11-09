import { describe, expect, it } from 'vitest';
import { CONNECTION_SAMPLES, connectionShape, directShape } from '../../src/client/workflow-view/connections.js';

const from = { x: 0, y: 0, width: 200, height: 100 };
const to = { x: 400, y: 40, width: 200, height: 100 };

describe('connection geometry', () => {
  it('leaves the source right edge and enters the target left edge', () => {
    const shape = connectionShape(from, to, { returning: false, fanOut: 0, fanOutCount: 1 });
    expect(shape.points[0]).toEqual({ x: 200, y: 50 });
    expect(shape.points[shape.points.length - 1]).toEqual({ x: 400, y: 90 });
    expect(shape.points).toHaveLength(CONNECTION_SAMPLES + 1);
  });

  it('draws an orthogonal path with rounded corners', () => {
    const shape = connectionShape(from, to, { returning: false, fanOut: 0, fanOutCount: 1 });
    expect(shape.path.startsWith('M 200 50')).toBe(true);
    expect(shape.path).toContain(' Q ');
    expect(shape.path).not.toContain(' C ');
    // The route departs horizontally, crosses once vertically, then enters horizontally.
    const start = shape.points[0]!;
    const near = shape.points[1]!;
    expect(near.y).toBeCloseTo(start.y, 1);
    const end = shape.points[shape.points.length - 1]!;
    const before = shape.points[shape.points.length - 2]!;
    expect(before.y).toBeCloseTo(end.y, 0);
  });

  it('leaves multiple connections from distinct anchors', () => {
    const first = connectionShape(from, to, { returning: false, fanOut: 0, fanOutCount: 2 });
    const second = connectionShape(from, to, { returning: false, fanOut: 1, fanOutCount: 2 });
    expect(first.points[0]!.y).not.toBe(second.points[0]!.y);
    expect(first.points[0]!.x).toBe(200);
  });

  it('runs a returning connection below both stages', () => {
    const shape = connectionShape({ ...from, x: 500 }, { ...to, x: 0 }, { returning: true, fanOut: 0, fanOutCount: 1 });
    const lowest = Math.max(...shape.points.map(point => point.y));
    expect(shape.points[0]).toEqual({ x: 600, y: 100 });
    expect(shape.points[shape.points.length - 1]).toEqual({ x: 100, y: 140 });
    expect(lowest).toBeGreaterThan(140 + 40);
  });

  it('keeps fan-out anchors inside a short stage', () => {
    const short = { x: 0, y: 0, width: 200, height: 40 };
    const shape = connectionShape(short, to, { returning: false, fanOut: 7, fanOutCount: 8 });
    expect(shape.points[0]!.y).toBeGreaterThanOrEqual(0);
    expect(shape.points[0]!.y).toBeLessThanOrEqual(40);
  });

  it('gives multiple returning connections distinct departures', () => {
    const first = connectionShape(from, to, { returning: true, fanOut: 0, fanOutCount: 2 });
    const second = connectionShape(from, to, { returning: true, fanOut: 1, fanOutCount: 2 });
    expect(first.points[0]!.x).not.toBe(second.points[0]!.x);
  });

  it('routes a returning connection below the required clearance', () => {
    const shape = connectionShape(from, to, { returning: true, fanOut: 0, fanOutCount: 1, clearance: 900 });
    expect(Math.max(...shape.points.map(point => point.y))).toBeGreaterThan(900);
  });

  it('routes a physically reversed forward connection below the stages', () => {
    // The stages were rearranged so the target sits before the source.
    const source = { x: 400, y: 0, width: 264, height: 140 };
    const target = { x: 0, y: 0, width: 264, height: 140 };
    const shape = connectionShape(source, target, { returning: false, fanOut: 0, fanOutCount: 1, clearance: 140 });
    const lowest = Math.max(...shape.points.map(point => point.y));
    expect(lowest).toBeGreaterThan(140);
    // Nothing crosses either stage interior.
    for (const point of shape.points) {
      const insideSource = point.x > source.x && point.x < source.x + source.width && point.y > source.y && point.y < source.y + source.height;
      const insideTarget = point.x > target.x && point.x < target.x + target.width && point.y > target.y && point.y < target.y + target.height;
      expect(insideSource || insideTarget).toBe(false);
    }
    expect(shape.tipAngle).toBeCloseTo(-90, 0);
  });

  it('routes a reversed connection around the side when the stages are stacked', () => {
    // The target sits directly below the source, so a bottom gutter would run
    // straight through the lower stage.
    const source = { x: 0, y: 0, width: 264, height: 140 };
    const target = { x: 0, y: 300, width: 264, height: 140 };
    const shape = connectionShape(source, target, { returning: false, fanOut: 0, fanOutCount: 1, clearance: 440 });
    for (const point of shape.points) {
      const insideSource = point.x > source.x && point.x < source.x + source.width && point.y > source.y && point.y < source.y + source.height;
      const insideTarget = point.x > target.x && point.x < target.x + target.width && point.y > target.y && point.y < target.y + target.height;
      expect(insideSource || insideTarget).toBe(false);
    }
    expect(shape.points[0]).toEqual({ x: 264, y: 70 });
    expect(shape.tipAngle).toBeCloseTo(180, 0);
  });

  it('points the arrow along the final orthogonal segment', () => {
    const horizontal = connectionShape(from, to, { returning: false, fanOut: 0, fanOutCount: 1 });
    expect(horizontal.tipAngle).toBeCloseTo(0, 0);
    const returning = connectionShape({ ...from, x: 500 }, { ...to, x: 0 }, { returning: true, fanOut: 0, fanOutCount: 1 });
    expect(returning.tipAngle).toBeCloseTo(-90, 0);
    expect(directShape(from, to).tipAngle).toBeCloseTo(Math.atan2(40, 200) * (180 / Math.PI), 0);
  });

  it('draws a direct fallback path between the same edges', () => {
    const shape = directShape(from, to);
    expect(shape.points[0]).toEqual({ x: 200, y: 50 });
    expect(shape.points[shape.points.length - 1]).toEqual({ x: 400, y: 90 });
    expect(shape.path.startsWith('M 200 50')).toBe(true);
  });
});
