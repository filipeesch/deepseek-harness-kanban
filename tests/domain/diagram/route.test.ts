import { describe, expect, it } from 'vitest';
import { connectionRoute, type ConnectionRouteInput } from '../../../src/domain/diagram/route.js';
import { anchorPoint } from '../../../src/domain/diagram/ports.js';

const from = { x: 0, y: 0, width: 200, height: 100 };
const to = { x: 400, y: 40, width: 200, height: 100 };

function route(overrides: Partial<ConnectionRouteInput> = {}) {
  return connectionRoute({ from, to, returning: false, fanOut: 0, fanOutCount: 1, ...overrides });
}

describe('connection route geometry', () => {
  it('draws a forward connection from the right edge into the left edge', () => {
    const result = route();
    expect(result.points).toEqual([
      { x: 200, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 90 },
      { x: 400, y: 90 },
    ]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ index: 1, axis: 'x', coordinate: 300 });
    expect(result.shape.path.startsWith('M 200 50 L ')).toBe(true);
    expect(result.shape.path).toContain('Q 300 50, 300 62');
    expect(result.shape.tipAngle).toBeCloseTo(0, 5);
    expect(result.shape.points[0]).toEqual({ x: 200, y: 50 });
    expect(result.shape.points[result.shape.points.length - 1]).toEqual({ x: 400, y: 90 });
  });

  it('runs a returning connection below both stages', () => {
    const result = connectionRoute({
      from: { x: 500, y: 0, width: 200, height: 100 },
      to: { x: 0, y: 40, width: 200, height: 100 },
      returning: true, fanOut: 0, fanOutCount: 1,
    });
    expect(result.points[0]).toEqual({ x: 600, y: 100 });
    expect(result.points[result.points.length - 1]).toEqual({ x: 100, y: 140 });
    const floor = Math.max(...result.points.map(point => point.y));
    expect(floor).toBe(140 + 72);
    expect(result.points.filter(point => point.y === floor)).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ axis: 'y', coordinate: floor });
  });

  it('leaves and enters through the sides an anchor authors', () => {
    const source = { side: 'top' as const, at: 2 };
    const target = { side: 'bottom' as const, at: 2 };
    const result = route({ source, target });
    expect(result.points[0]).toEqual(anchorPoint(from, source).point);
    expect(result.points[result.points.length - 1]).toEqual(anchorPoint(to, target).point);
    // The first leg leaves perpendicular to the authored side.
    expect(result.points[1]!.x).toBe(result.points[0]!.x);
    expect(result.points[1]!.y).toBeLessThan(result.points[0]!.y);
    for (let index = 1; index < result.points.length; index++) {
      const previous = result.points[index - 1]!;
      const current = result.points[index]!;
      expect(previous.x === current.x || previous.y === current.y).toBe(true);
    }
  });
});
