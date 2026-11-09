import { automaticSourcePoint, automaticTargetPoint, returningArrivalPoint, returningDeparturePoint } from './ports.js';
import type { DiagramPoint, DiagramRect } from './orthogonal.js';

/** How far a returning connection runs below the stages it passes. */
export const RETURNING_DEPTH = 72;

/** How far a connection detours outside the stages when the two ends face away from each other. */
export const DETOUR_DEPTH = RETURNING_DEPTH;

export interface AutomaticRouteOptions {
  readonly returning: boolean;
  readonly fanOut: number;
  readonly fanOutCount: number;
  /** The lowest stage bottom the connection must stay below. */
  readonly clearance?: number;
}

function rangesOverlap(from: DiagramRect, to: DiagramRect): { readonly x: boolean; readonly y: boolean } {
  return {
    x: from.x < to.x + to.width && to.x < from.x + from.width,
    y: from.y < to.y + to.height && to.y < from.y + from.height,
  };
}

/** True when a vertical leg at x passes through the interior of the rectangle. */
function verticalCrosses(x: number, top: number, bottom: number, rect: DiagramRect): boolean {
  const low = Math.min(top, bottom);
  const high = Math.max(top, bottom);
  return x > rect.x && x < rect.x + rect.width && high > rect.y && low < rect.y + rect.height;
}

/** The side gutter that keeps a detour beside both stages rather than through one. */
function sideGutter(from: DiagramRect, to: DiagramRect, start: DiagramPoint): number {
  const left = Math.min(from.x, to.x) - RETURNING_DEPTH;
  const right = Math.max(from.x + from.width, to.x + to.width) + RETURNING_DEPTH;
  return Math.abs(start.x - left) <= Math.abs(start.x - right) ? left : right;
}

/**
 * Both edges leave and enter through the bottom, below every stage. When the
 * target sits below the source, the direct legs would run through it, so the
 * route steps aside before it descends and comes back below the target.
 */
function bottomPoints(from: DiagramRect, to: DiagramRect, options: AutomaticRouteOptions): DiagramPoint[] {
  const start = returningDeparturePoint(from, options.fanOut, options.fanOutCount);
  const end = returningArrivalPoint(to);
  const floor = Math.max(start.y, end.y, options.clearance ?? 0) + RETURNING_DEPTH;
  const blocksTarget = verticalCrosses(start.x, start.y, floor, to);
  const blocksSource = verticalCrosses(end.x, end.y, floor, from);
  if (blocksTarget || blocksSource) {
    // The two stages share a column, so the direct legs would run through one of
    // them. Step aside, travel outside both, and come back through the free
    // corridor between them.
    const targetBelow = to.y > from.y;
    const mid = targetBelow ? (from.y + from.height + to.y) / 2 : (to.y + to.height + from.y) / 2;
    const gutter = sideGutter(from, to, start);
    return targetBelow
      ? [start, { x: start.x, y: mid }, { x: gutter, y: mid }, { x: gutter, y: floor }, { x: end.x, y: floor }, end]
      : [start, { x: start.x, y: floor }, { x: gutter, y: floor }, { x: gutter, y: mid }, { x: end.x, y: mid }, end];
  }
  return [start, { x: start.x, y: floor }, { x: end.x, y: floor }, end];
}

/** The route that leaves and enters through the right edges, outside both stages. */
function sidePoints(start: DiagramPoint, end: DiagramPoint): DiagramPoint[] {
  const gutter = Math.max(start.x, end.x) + RETURNING_DEPTH;
  return [start, { x: gutter, y: start.y }, { x: gutter, y: end.y }, end];
}

/**
 * The route of a connection whose ends are not authored: a forward connection
 * leaves the source's right edge and enters the target's left edge, a returning
 * connection runs below every stage, and a pair that was rearranged so the
 * target sits before the source is routed around the outside.
 */
export function automaticPoints(from: DiagramRect, to: DiagramRect, options: AutomaticRouteOptions): DiagramPoint[] {
  if (options.returning) return bottomPoints(from, to, options);
  const start = automaticSourcePoint(from, options.fanOut, options.fanOutCount);
  const end = automaticTargetPoint(to);
  if (end.x <= start.x) {
    const overlap = rangesOverlap(from, to);
    const sideEnd = { x: to.x + to.width, y: to.y + to.height / 2 };
    return overlap.x && !overlap.y ? sidePoints(start, sideEnd) : bottomPoints(from, to, options);
  }
  if (Math.abs(end.y - start.y) < 1) return [start, end];
  const middle = (start.x + end.x) / 2;
  return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
}
