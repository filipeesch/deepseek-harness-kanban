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

function returning(from: DiagramRect, to: DiagramRect, stages?: readonly DiagramRect[]) {
  return connectionRoute({ from, to, returning: true, fanOut: 0, fanOutCount: 1, ...(stages === undefined ? {} : { clearanceStages: stages }) });
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

describe('corridor clearance', () => {
  const stages: readonly LiveStageRect[] = [
    { id: 'a', x: 0, y: 0, width: 200, height: 100 },
    { id: 'b', x: 400, y: 0, width: 200, height: 100 },
    { id: 'obstacle', x: 0, y: 600, width: 200, height: 100 },
    { id: 'far', x: 1400, y: 0, width: 200, height: 100 },
  ];
  const connection: LiveConnectionDescriptor = { id: 'a->b:0', from: 'a', to: 'b', kind: 'explicit', returning: true, fanOut: 0, fanOutCount: 1 };

  function floorOf(route: { readonly lines: readonly { readonly axis: 'x' | 'y'; readonly coordinate: number }[] }): number {
    return Math.max(...route.lines.filter(line => line.axis === 'y').map(line => line.coordinate));
  }

  it('keeps the drag baseline on the line the diagram draws', () => {
    const drawn = connectionRouteFor(stages, connection, true)!;
    const baseline = connectionRouteFor(stages, connection, false)!;
    expect(baseline.lines).toEqual(drawn.lines);
    expect(floorOf(baseline)).toBeGreaterThan(700);
  });

  it('clears the stage its own corridor crosses and ignores the one it does not', () => {
    const route = connectionRouteFor(stages, connection, true)!;
    // The obstacle below the corridor raises the run; the far stage does not.
    expect(floorOf(route)).toBeGreaterThan(600);
    expect(floorOf(route)).toBeLessThan(1400);
  });

  it('does not move when a stage outside the corridor moves', () => {
    const before = connectionRouteFor(stages, connection, true)!;
    const moved = stages.map(stage => stage.id === 'far' ? { ...stage, y: 2000 } : stage);
    expect(connectionRouteFor(moved, connection, true)!.points).toEqual(before.points);
  });

  it('does not move when a stage outside the corridor is added or resized', () => {
    const before = connectionRouteFor(stages, connection, true)!;
    const added = [...stages, { id: 'added', x: 1400, y: 0, width: 200, height: 900 }];
    expect(connectionRouteFor(added, connection, true)!.points).toEqual(before.points);
    const resized = stages.map(stage => stage.id === 'far' ? { ...stage, height: 900 } : stage);
    expect(connectionRouteFor(resized, connection, true)!.points).toEqual(before.points);
  });

  it('keeps an authored displacement when an unrelated stage moves', () => {
    const authored: LiveConnectionDescriptor = { ...connection, segments: [{ axis: 'y', offset: 40 }] };
    const before = connectionRouteFor(stages, authored, true)!;
    const moved = stages.map(stage => stage.id === 'far' ? { ...stage, y: 2000 } : stage);
    expect(connectionRouteFor(moved, authored, true)!.points).toEqual(before.points);
  });

  it('raises the run when a stage inside the corridor moves down', () => {
    const before = connectionRouteFor(stages, connection, true)!;
    const moved = stages.map(stage => stage.id === 'obstacle' ? { ...stage, y: 900 } : stage);
    const after = connectionRouteFor(moved, connection, true)!;
    expect(floorOf(after)).toBe(floorOf(before) + 300);
  });
});
