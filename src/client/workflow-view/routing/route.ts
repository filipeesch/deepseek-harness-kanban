import type { ConnectionAnchor, ConnectionSegmentOffset } from '../../../shared/types.js';
import { automaticPoints, DETOUR_DEPTH } from './automatic.js';
import { anchorPoint, automaticSourcePoint, automaticTargetPoint, returningArrivalPoint, returningDeparturePoint } from './ports.js';
import { buildShape, normalizePolyline, type ConnectionShape, type DiagramPoint, type DiagramRect } from './orthogonal.js';

/** How far a connection travels straight out of a stage before it may turn. */
export const STUB_LENGTH = 24;

/** One adjustable segment of a drawn connection. */
export interface RouteLine {
  /** The segment index inside the drawn polyline. */
  readonly index: number;
  /** The axis whose coordinate the segment's displacement changes. */
  readonly axis: 'x' | 'y';
  /** The automatic coordinate on that axis, before any authored displacement. */
  readonly coordinate: number;
  readonly midpoint: DiagramPoint;
}

export interface ConnectionRoute {
  readonly points: readonly DiagramPoint[];
  readonly shape: ConnectionShape;
  readonly lines: readonly RouteLine[];
}

export interface ConnectionRouteInput {
  readonly from: DiagramRect;
  readonly to: DiagramRect;
  readonly returning: boolean;
  readonly fanOut: number;
  readonly fanOutCount: number;
  /** The lowest stage bottom a returning connection must stay below. */
  readonly clearance?: number;
  readonly source?: ConnectionAnchor;
  readonly target?: ConnectionAnchor;
  readonly segments?: readonly ConnectionSegmentOffset[];
}

function axisOf(from: DiagramPoint, to: DiagramPoint): 'x' | 'y' {
  return Math.abs(from.x - to.x) < 0.01 ? 'x' : 'y';
}

/** The segments between the two anchored stubs, in path order. */
function freeLines(points: readonly DiagramPoint[]): RouteLine[] {
  const lines: RouteLine[] = [];
  for (let index = 1; index <= points.length - 3; index++) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const axis = axisOf(from, to);
    lines.push({
      index,
      axis,
      coordinate: axis === 'x' ? from.x : from.y,
      midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    });
  }
  return lines;
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/**
 * The middle of an anchored route. The stub ends are joined so that the path
 * leaves in the departure direction and arrives from the arrival side: a line
 * between the two stubs is used when it does not reverse either direction, and
 * the route detours around the outside of both stages when it would.
 */
function connector(p1: DiagramPoint, departure: DiagramPoint, p2: DiagramPoint, arrival: DiagramPoint): DiagramPoint[] {
  const horizontalDeparture = departure.x !== 0;
  const horizontalArrival = arrival.x !== 0;
  if (horizontalDeparture && horizontalArrival) {
    const middle = (p1.x + p2.x) / 2;
    const sameHeight = Math.abs(p2.y - p1.y) < 0.01;
    const leavesForward = departure.x > 0 ? middle > p1.x : middle < p1.x;
    const arrivesFromSide = arrival.x > 0 ? middle > p2.x : middle < p2.x;
    if (sameHeight && leavesForward && arrivesFromSide) return [p1, p2];
    if (!sameHeight && leavesForward && arrivesFromSide) return [p1, { x: middle, y: p1.y }, { x: middle, y: p2.y }, p2];
    const gutter = (departure.x > 0 ? Math.max(p1.x, p2.x) : Math.min(p1.x, p2.x)) + departure.x * DETOUR_DEPTH;
    if (!sameHeight && sign(departure.x) === sign(arrival.x)) return [p1, { x: gutter, y: p1.y }, { x: gutter, y: p2.y }, p2];
    const wall = Math.max(p1.y, p2.y) + DETOUR_DEPTH;
    return [p1, { x: gutter, y: p1.y }, { x: gutter, y: wall }, { x: p2.x, y: wall }, p2];
  }
  if (!horizontalDeparture && !horizontalArrival) {
    const middle = (p1.y + p2.y) / 2;
    const sameColumn = Math.abs(p2.x - p1.x) < 0.01;
    const leavesForward = departure.y > 0 ? middle > p1.y : middle < p1.y;
    const arrivesFromSide = arrival.y > 0 ? middle > p2.y : middle < p2.y;
    if (sameColumn && leavesForward && arrivesFromSide) return [p1, p2];
    if (!sameColumn && leavesForward && arrivesFromSide) return [p1, { x: p1.x, y: middle }, { x: p2.x, y: middle }, p2];
    const gutter = (departure.y > 0 ? Math.max(p1.y, p2.y) : Math.min(p1.y, p2.y)) + departure.y * DETOUR_DEPTH;
    if (!sameColumn && sign(departure.y) === sign(arrival.y)) return [p1, { x: p1.x, y: gutter }, { x: p2.x, y: gutter }, p2];
    const wall = Math.max(p1.x, p2.x) + DETOUR_DEPTH;
    return [p1, { x: p1.x, y: gutter }, { x: wall, y: gutter }, { x: wall, y: p2.y }, p2];
  }
  // A departure on one axis and an arrival on the other: turn once, unless the
  // turn would reverse the arrival, in which case the path goes around the
  // outside so the final approach still comes from the arrived side.
  if (horizontalDeparture) {
    const arrivesFromAbove = arrival.y < 0;
    const leavesSideways = Math.abs(p2.x - p1.x) < 0.01 || sign(p2.x - p1.x) === sign(departure.x);
    const valid = leavesSideways && (Math.abs(p2.y - p1.y) < 0.01 || sign(p2.y - p1.y) === (arrivesFromAbove ? 1 : -1));
    if (valid) return [p1, { x: p2.x, y: p1.y }, p2];
    const outer = p2.y + arrival.y * DETOUR_DEPTH;
    const gutter = p1.x + departure.x * DETOUR_DEPTH;
    return [p1, { x: gutter, y: p1.y }, { x: gutter, y: outer }, { x: p2.x, y: outer }, p2];
  }
  const arrivesFromLeft = arrival.x < 0;
  const leavesDown = Math.abs(p2.y - p1.y) < 0.01 || sign(p2.y - p1.y) === sign(departure.y);
  const valid = leavesDown && (Math.abs(p2.x - p1.x) < 0.01 || sign(p2.x - p1.x) === (arrivesFromLeft ? 1 : -1));
  if (valid) return [p1, { x: p1.x, y: p2.y }, p2];
  const outer = p2.x + arrival.x * DETOUR_DEPTH;
  const gutter = p1.y + departure.y * DETOUR_DEPTH;
  return [p1, { x: p1.x, y: gutter }, { x: outer, y: gutter }, { x: outer, y: p2.y }, p2];
}

/**
 * The route of a connection that authors at least one end: it leaves and enters
 * through the sides those ends name, straight out of the stage before turning.
 * An end that is not authored keeps the automatic departure.
 */
function anchoredPoints(input: ConnectionRouteInput): DiagramPoint[] {
  const source = input.source === undefined ? null : anchorPoint(input.from, input.source);
  const target = input.target === undefined ? null : anchorPoint(input.to, input.target);
  const start = source !== null
    ? source.point
    : input.returning
      ? returningDeparturePoint(input.from, input.fanOut, input.fanOutCount)
      : automaticSourcePoint(input.from, input.fanOut, input.fanOutCount);
  const departure = source !== null ? source.normal : input.returning ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const end = target !== null
    ? target.point
    : input.returning
      ? returningArrivalPoint(input.to)
      : automaticTargetPoint(input.to);
  const arrival = target !== null ? target.normal : input.returning ? { x: 0, y: 1 } : { x: -1, y: 0 };
  const p1 = { x: start.x + departure.x * STUB_LENGTH, y: start.y + departure.y * STUB_LENGTH };
  const p2 = { x: end.x + arrival.x * STUB_LENGTH, y: end.y + arrival.y * STUB_LENGTH };
  return [start, ...connector(p1, departure, p2, arrival), end];
}

interface MutablePoint { x: number; y: number }

/**
 * Apply the authored displacements. A displacement belongs to the free line of
 * its axis at the same position along the path; one the current shape does not
 * produce is left alone, so it applies again if the shape returns.
 */
function applyOffsets(points: readonly DiagramPoint[], offsets: readonly ConnectionSegmentOffset[] | undefined): DiagramPoint[] {
  const result: MutablePoint[] = points.map(point => ({ x: point.x, y: point.y }));
  if (offsets === undefined || offsets.length === 0) return result;
  const lines = freeLines(result);
  const byAxis: Record<'x' | 'y', RouteLine[]> = { x: [], y: [] };
  for (const line of lines) byAxis[line.axis].push(line);
  const used: Record<'x' | 'y', number> = { x: 0, y: 0 };
  for (const offset of offsets) {
    const line = byAxis[offset.axis][used[offset.axis]++];
    if (line === undefined) continue;
    const value = line.coordinate + offset.offset;
    const first = result[line.index];
    const second = result[line.index + 1];
    if (first === undefined || second === undefined) continue;
    if (offset.axis === 'x') { first.x = value; second.x = value; } else { first.y = value; second.y = value; }
  }
  return result;
}

/**
 * The drawn route of one connection: the automatic geometry when neither end is
 * authored, the anchored geometry when one is, plus the authored displacements.
 * The same function feeds the live drawing and the committed travel path.
 */
export function connectionRoute(input: ConnectionRouteInput): ConnectionRoute {
  const automatic = input.source === undefined && input.target === undefined;
  const points = normalizePolyline(automatic ? automaticPoints(input.from, input.to, input) : anchoredPoints(input));
  const shifted = applyOffsets(points, input.segments);
  return { points: shifted, shape: buildShape(shifted), lines: freeLines(shifted) };
}
