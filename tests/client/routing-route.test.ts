import { describe, expect, it } from 'vitest';
import { connectionRoute, type ConnectionRouteInput } from '../../src/client/workflow-view/routing/route.js';
import { anchorPoint } from '../../src/client/workflow-view/routing/ports.js';

const from = { x: 0, y: 0, width: 200, height: 100 };
const to = { x: 400, y: 40, width: 200, height: 100 };

function route(overrides: Partial<ConnectionRouteInput> = {}) {
  return connectionRoute({ from, to, returning: false, fanOut: 0, fanOutCount: 1, ...overrides });
}

describe('connection route', () => {
  it('keeps the automatic geometry when neither end is authored', () => {
    const shape = route().shape;
    expect(shape.points[0]).toEqual({ x: 200, y: 50 });
    expect(shape.points[shape.points.length - 1]).toEqual({ x: 400, y: 90 });
    expect(route().lines).toHaveLength(1);
    expect(route().lines[0]).toMatchObject({ axis: 'x', coordinate: 300 });
  });

  it('leaves through the authored side, perpendicular to it', () => {
    const result = route({ source: { side: 'top', at: 2 } });
    expect(result.points[0]).toEqual({ x: 100, y: 0 });
    expect(result.points[1]!.x).toBe(100);
    expect(result.points[1]!.y).toBeLessThan(0);
  });

  it('enters through an authored bottom edge from below', () => {
    const result = route({ target: { side: 'bottom', at: 2 } });
    const end = result.points[result.points.length - 1]!;
    const before = result.points[result.points.length - 2]!;
    expect(end.x).toBe(500);
    expect(end.y).toBe(140);
    expect(before.y).toBeGreaterThan(end.y);
  });

  it('routes between two authored sides that face away from each other', () => {
    const result = route({ source: { side: 'right', at: 2 }, target: { side: 'right', at: 2 } });
    const highest = Math.max(...result.points.map(point => point.x));
    expect(highest).toBeGreaterThan(600);
    expect(result.points[result.points.length - 1]).toEqual({ x: 600, y: 90 });
  });

  it('bends once when a horizontal departure meets a reachable vertical arrival', () => {
    const below = { x: 400, y: 240, width: 200, height: 100 };
    const result = connectionRoute({ from, to: below, returning: false, fanOut: 0, fanOutCount: 1, target: { side: 'top', at: 2 } });
    expect(result.points).toHaveLength(3);
    expect(result.lines).toHaveLength(0);
    expect(result.points[result.points.length - 1]).toEqual({ x: 500, y: 240 });
  });

  it('goes around the outside when the turn would reverse the arrival', () => {
    const result = route({ target: { side: 'top', at: 2 } });
    expect(result.lines.length).toBeGreaterThan(0);
    const end = result.points[result.points.length - 1]!;
    const approach = result.points[result.points.length - 2]!;
    expect(approach.x).toBe(end.x);
    expect(approach.y).toBeLessThan(end.y);
  });

  it('moves the free line of the same axis and keeps the path orthogonal', () => {
    const result = route({ segments: [{ axis: 'x', offset: 60 }] });
    expect(result.lines[0]!.coordinate).toBe(360);
    for (let index = 1; index < result.points.length; index++) {
      const previous = result.points[index - 1]!;
      const current = result.points[index]!;
      expect(previous.x === current.x || previous.y === current.y).toBe(true);
    }
  });

  it('moves the horizontal floor of a returning route', () => {
    const returning = { from: { ...from, x: 500 }, to: { ...to, x: 0 }, returning: true };
    const plain = connectionRoute({ ...returning, fanOut: 0, fanOutCount: 1 });
    const pushed = connectionRoute({ ...returning, fanOut: 0, fanOutCount: 1, segments: [{ axis: 'y', offset: 40 }] });
    const lowest = (points: readonly { y: number }[]) => Math.max(...points.map(point => point.y));
    expect(lowest(pushed.points)).toBe(lowest(plain.points) + 40);
    expect(pushed.lines[0]!.axis).toBe('y');
  });

  it('clears the corridor the displaced route really occupies', () => {
    const source = { x: 0, y: 0, width: 200, height: 100 };
    const target = { x: 0, y: 300, width: 200, height: 100 };
    // A stage beside the automatic gutter, which the displaced route no longer reaches.
    const third = { x: -50, y: 600, width: 30, height: 100 };
    const input: ConnectionRouteInput = {
      from: source, to: target, returning: true, fanOut: 0, fanOutCount: 1,
      clearanceStages: [source, target, third], segments: [{ axis: 'x', offset: 372 }],
    };
    const drawn = connectionRoute(input);
    const xs = drawn.points.map(point => point.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...xs)).toBe(300);
    const moved = connectionRoute({ ...input, clearanceStages: [source, target, { ...third, y: 900 }] });
    expect(moved.points).toEqual(drawn.points);
  });

  it('applies each displacement to the line of its own axis in path order', () => {
    const input: ConnectionRouteInput = {
      from: { x: 400, y: 0, width: 200, height: 100 }, to: { x: 0, y: 0, width: 200, height: 100 },
      returning: false, fanOut: 0, fanOutCount: 1, source: { side: 'right', at: 2 }, target: { side: 'right', at: 2 },
    };
    const auto = connectionRoute(input);
    for (const axis of ['x', 'y'] as const) {
      const lines = auto.lines.filter(line => line.axis === axis);
      if (lines.length === 0) continue;
      const shifted = connectionRoute({ ...input, segments: lines.map((_, index) => ({ axis, offset: (index + 1) * 10 })) });
      const moved = shifted.lines.filter(line => line.axis === axis);
      lines.forEach((line, index) => { expect(moved[index]!.coordinate).toBe(line.coordinate + (index + 1) * 10); });
    }
    expect(auto.lines.length).toBeGreaterThan(0);
  });

  it('leaves a displacement dormant when the route has no line for it', () => {
    const below = { x: 400, y: 240, width: 200, height: 100 };
    const input: ConnectionRouteInput = { from, to: below, returning: false, fanOut: 0, fanOutCount: 1, source: { side: 'right', at: 2 }, target: { side: 'top', at: 2 } };
    const plain = connectionRoute(input);
    const surplus = connectionRoute({ ...input, segments: [{ axis: 'x', offset: 50 }, { axis: 'y', offset: 50 }] });
    expect(plain.lines).toHaveLength(0);
    expect(surplus.points).toEqual(plain.points);
  });

  it('starts from the authored touch point exactly where the anchor sits', () => {
    const result = route({ source: { side: 'right', at: 0 } });
    expect(result.shape.points[0]).toEqual({ x: 200, y: 10 });
    expect(result.shape.tipAngle).toBeCloseTo(0, 0);
  });

  it('marks the touch points the connection really uses', () => {
    const result = route({ source: { side: 'bottom', at: 4 }, target: { side: 'bottom', at: 0 } });
    expect(result.shape.points[0]).toEqual({ x: 180, y: 100 });
    expect(result.shape.points[result.shape.points.length - 1]).toEqual({ x: 420, y: 140 });
  });
});
describe('every authored side pair', () => {
  const sides = ['top', 'right', 'bottom', 'left'] as const;

  it('leaves and enters through the named side, orthogonal and finite', () => {
    for (const sourceSide of sides) {
      for (const targetSide of sides) {
        const source = { side: sourceSide, at: 2 };
        const target = { side: targetSide, at: 2 };
        const result = connectionRoute({ from, to, returning: false, fanOut: 0, fanOutCount: 1, source, target });
        const first = result.points[0]!;
        const last = result.points[result.points.length - 1]!;
        expect(first).toEqual(anchorPoint(from, source).point);
        expect(last).toEqual(anchorPoint(to, target).point);
        for (let index = 1; index < result.points.length; index++) {
          const a = result.points[index - 1]!;
          const b = result.points[index]!;
          expect(a.x === b.x || a.y === b.y).toBe(true);
          expect(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        }
        // The final segment travels straight into the target, against its normal.
        const normal = anchorPoint(to, target).normal;
        const before = result.points[result.points.length - 2]!;
        expect(Math.sign(last.x - before.x) + Math.sign(normal.x)).toBe(0);
        expect(Math.sign(last.y - before.y) + Math.sign(normal.y)).toBe(0);
      }
    }
  });
});
