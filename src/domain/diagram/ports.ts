import type { ConnectionAnchor, StageSide } from '../../shared/types.js';
import { ANCHOR_FRACTIONS, anchorFraction } from '../connection-anchor.js';
import type { DiagramPoint, DiagramRect } from './orthogonal.js';

/** A point on a stage boundary and the direction that leaves the stage there. */
export interface AnchorPlacement { readonly point: DiagramPoint; readonly normal: DiagramPoint }

/** How far apart multiple connections leave the same stage edge. */
export const FAN_OUT_SPACING = 20;

const SIDE_NORMALS: Readonly<Record<StageSide, DiagramPoint>> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Where an authored anchor sits on a stage boundary, and the outward direction there. */
export function anchorPoint(rect: DiagramRect, anchor: ConnectionAnchor): AnchorPlacement {
  const fraction = anchorFraction(anchor.at);
  const normal = SIDE_NORMALS[anchor.side];
  switch (anchor.side) {
    case 'top': return { point: { x: rect.x + rect.width * fraction, y: rect.y }, normal };
    case 'bottom': return { point: { x: rect.x + rect.width * fraction, y: rect.y + rect.height }, normal };
    case 'left': return { point: { x: rect.x, y: rect.y + rect.height * fraction }, normal };
    default: return { point: { x: rect.x + rect.width, y: rect.y + rect.height * fraction }, normal };
  }
}

/** The vertical spread of one connection among the connections leaving the same edge. */
export function fanOutOffset(fanOut: number, fanOutCount: number, height: number): number {
  const spread = Math.max(0, height - 16);
  const spacing = fanOutCount > 1 ? Math.min(FAN_OUT_SPACING, spread / (fanOutCount - 1)) : 0;
  return fanOutCount > 1 ? (fanOut - (fanOutCount - 1) / 2) * spacing : 0;
}

/** The right-edge departure of a connection whose source end is not authored. */
export function automaticSourcePoint(rect: DiagramRect, fanOut: number, fanOutCount: number): DiagramPoint {
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2 + fanOutOffset(fanOut, fanOutCount, rect.height) };
}

/** The left-edge arrival of a connection whose target end is not authored. */
export function automaticTargetPoint(rect: DiagramRect): DiagramPoint {
  return { x: rect.x, y: rect.y + rect.height / 2 };
}

/** The bottom-edge departure of a returning connection whose source end is not authored. */
export function returningDeparturePoint(rect: DiagramRect, fanOut: number, fanOutCount: number): DiagramPoint {
  const step = rect.width / (fanOutCount + 1);
  return { x: rect.x + step * (fanOut + 1), y: rect.y + rect.height };
}

/** The bottom-edge arrival of a returning connection whose target end is not authored. */
export function returningArrivalPoint(rect: DiagramRect): DiagramPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function nearestPointIndex(rect: DiagramRect, side: StageSide, x: number, y: number): number {
  const extent = side === 'top' || side === 'bottom' ? rect.width : rect.height;
  const origin = side === 'top' || side === 'bottom' ? rect.x : rect.y;
  const position = side === 'top' || side === 'bottom' ? x : y;
  const fraction = extent === 0 ? 0.5 : Math.min(1, Math.max(0, (position - origin) / extent));
  let best = 0;
  let distance = Infinity;
  for (let index = 0; index < ANCHOR_FRACTIONS.length; index++) {
    const candidate = Math.abs(ANCHOR_FRACTIONS[index]! - fraction);
    if (candidate < distance) { distance = candidate; best = index; }
  }
  return best;
}

function anchorOnSide(rect: DiagramRect, side: StageSide, x: number, y: number): ConnectionAnchor {
  return { side, at: nearestPointIndex(rect, side, x, y) };
}

/**
 * The nearest anchor point to a diagram position. The position is projected onto
 * the stage rectangle first, so a release anywhere around the stage settles on a
 * point of its boundary rather than on a diagonal offset.
 */
export function nearestAnchor(rect: DiagramRect, point: DiagramPoint): ConnectionAnchor {
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const x = Math.min(Math.max(point.x, minX), maxX);
  const y = Math.min(Math.max(point.y, minY), maxY);
  const insideX = point.x >= minX && point.x <= maxX;
  const insideY = point.y >= minY && point.y <= maxY;
  if (!insideX && !insideY) {
    const horizontal = Math.min(Math.abs(point.x - minX), Math.abs(point.x - maxX));
    const vertical = Math.min(Math.abs(point.y - minY), Math.abs(point.y - maxY));
    return horizontal <= vertical
      ? anchorOnSide(rect, point.x < minX ? 'left' : 'right', x, y)
      : anchorOnSide(rect, point.y < minY ? 'top' : 'bottom', x, y);
  }
  if (!insideX) return anchorOnSide(rect, point.x < minX ? 'left' : 'right', x, y);
  if (!insideY) return anchorOnSide(rect, point.y < minY ? 'top' : 'bottom', x, y);
  const candidates: ReadonlyArray<readonly [StageSide, number]> = [
    ['top', point.y - minY],
    ['right', maxX - point.x],
    ['bottom', maxY - point.y],
    ['left', point.x - minX],
  ];
  let side: StageSide = 'top';
  let distance = Infinity;
  for (const [candidate, value] of candidates) {
    if (value < distance) { distance = value; side = candidate; }
  }
  return anchorOnSide(rect, side, x, y);
}
