import { describe, expect, it } from 'vitest';
import { connectionRoute } from '../../src/client/workflow-view/routing/route.js';
import { connectionRouteFor, type LiveConnectionDescriptor, type LiveStageRect } from '../../src/client/workflow-view/edge-model.js';
import type { DiagramPoint, DiagramRect } from '../../src/client/workflow-view/routing/orthogonal.js';

/** True when any segment of the polyline runs through the rectangle's interior. */
function crossesInterior(points: readonly DiagramPoint[], rect: DiagramRect): boolean {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (maxX > rect.x && minX < rect.x + rect.width && maxY > rect.y && minY < rect.y + rect.height) return true;
  }
  return false;
}

const upper: DiagramRect = { x: 0, y: 0, width: 200, height: 100 };
const lower: DiagramRect = { x: 0, y: 300, width: 200, height: 100 };

function returning(from: DiagramRect, to: DiagramRect, clearance?: number) {
  return connectionRoute({ from, to, returning: true, fanOut: 0, fanOutCount: 1, ...(clearance === undefined ? {} : { clearance }) });
}

describe('stacked returning connections', () => {
  it('steps aside when the target sits below the source', () => {
    const route = returning(upper, lower);
    expect(crossesInterior(route.points, upper)).toBe(false);
    expect(crossesInterior(route.points, lower)).toBe(false);
    const end = route.points[route.points.length - 1]!;
    const before = route.points[route.points.length - 2]!;
    expect(before.x).toBe(end.x);
    expect(before.y).toBeGreaterThan(end.y);
  });

  it('steps aside when the target sits above the source', () => {
    const route = returning(lower, upper);
    expect(crossesInterior(route.points, upper)).toBe(false);
    expect(crossesInterior(route.points, lower)).toBe(false);
    const end = route.points[route.points.length - 1]!;
    const before = route.points[route.points.length - 2]!;
    expect(before.x).toBe(end.x);
    expect(before.y).toBeGreaterThan(end.y);
  });

  it('still runs below both stages when they sit side by side', () => {
    const right = { ...upper, x: 400 };
    const route = returning(upper, right);
    expect(crossesInterior(route.points, upper)).toBe(false);
    expect(crossesInterior(route.points, right)).toBe(false);
    expect(Math.max(...route.points.map(point => point.y))).toBeGreaterThan(100 + 40);
  });
});

describe('shared clearance', () => {
  const stages: readonly LiveStageRect[] = [
    { id: 'a', x: 0, y: 0, width: 200, height: 100 },
    { id: 'b', x: 400, y: 0, width: 200, height: 100 },
    { id: 'obstacle', x: 0, y: 600, width: 200, height: 100 },
  ];
  const connection: LiveConnectionDescriptor = { id: 'a->b:0', from: 'a', to: 'b', kind: 'explicit', returning: true, fanOut: 0, fanOutCount: 1 };

  it('keeps the drag baseline on the line the diagram draws', () => {
    const drawn = connectionRouteFor(stages, connection, true)!;
    const baseline = connectionRouteFor(stages, connection, false)!;
    expect(baseline.lines).toEqual(drawn.lines);
    expect(Math.min(...baseline.lines.map(line => line.coordinate))).toBeGreaterThan(700);
  });
});
