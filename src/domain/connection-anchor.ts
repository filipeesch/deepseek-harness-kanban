import type { ConnectionAnchor, ConnectionAxis, ConnectionLayout, ConnectionSegmentOffset, StageSide } from '../shared/types.js';

/**
 * How many anchor points each stage side offers, and where they sit along it.
 * Corners are deliberately absent: an anchor always belongs to exactly one side,
 * which is what lets a departure be perpendicular without ambiguity.
 */
export const ANCHOR_POINTS_PER_SIDE = 5;
export const ANCHOR_FRACTIONS: readonly number[] = [0.1, 0.3, 0.5, 0.7, 0.9];

export const STAGE_SIDES: readonly StageSide[] = ['top', 'right', 'bottom', 'left'];
export const CONNECTION_AXES: readonly ConnectionAxis[] = ['x', 'y'];

/** The largest accepted absolute displacement of one adjustable segment. */
export const CONNECTION_OFFSET_LIMIT = 1_000_000;

/** The separator of the source and target pair that identifies one connection. */
const KEY_SEPARATOR = '->';

export function isStageSide(value: unknown): value is StageSide {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

/** True when the value is one of the five accepted points along a side. */
export function isAcceptedAnchorPoint(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < ANCHOR_POINTS_PER_SIDE;
}

/** True when the value is an accepted segment displacement. */
export function isAcceptedOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= CONNECTION_OFFSET_LIMIT;
}

/** The fraction along a side where an accepted anchor point sits. */
export function anchorFraction(at: number): number {
  return ANCHOR_FRACTIONS[at] ?? ANCHOR_FRACTIONS[Math.floor(ANCHOR_POINTS_PER_SIDE / 2)]!;
}

/**
 * The key that identifies one connection. A stage identifier cannot contain '>',
 * so the pair is unambiguous, and the authored sequence uses the same identity.
 */
export function connectionKey(from: string, to: string): string {
  return from + KEY_SEPARATOR + to;
}

export function sameAnchor(left: ConnectionAnchor | undefined, right: ConnectionAnchor | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.side === right.side && left.at === right.at;
}

function sameOffsets(left: readonly ConnectionSegmentOffset[] | undefined, right: readonly ConnectionSegmentOffset[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  return a.every((value, index) => value.axis === b[index]!.axis && value.offset === b[index]!.offset);
}

/** True when two authored layouts describe the same connection drawn the same way. */
export function sameConnectionLayout(left: ConnectionLayout | undefined, right: ConnectionLayout | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.from === right.from && left.to === right.to
    && sameAnchor(left.source, right.source)
    && sameAnchor(left.target, right.target)
    && sameOffsets(left.segments, right.segments);
}
