import type { StagePosition, StageSize } from '../../../shared/types.js';
import { STAGE_MIN_SIZE } from '../../../domain/stage-size.js';

/** The lattice every layout edit settles on, in diagram units. */
export const GRID_STEP = 8;

/** How a gesture turns a raw pointer value into the value it settles on. */
export interface SnapPolicy {
  /** The position the diagram shows for a raw stage position. */
  position(position: StagePosition): StagePosition;
  /** The size a resize shows for a raw stage size. */
  size(size: StageSize): StageSize;
  /** The coordinate a moved route segment sits on. */
  coordinate(value: number): number;
}

/** The nearest multiple of the step, with a normalized zero. */
function nearestMultiple(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  const settled = Math.round(value / step) * step;
  return settled === 0 ? 0 : settled;
}

/** The smallest lattice point at or above a floor. */
function latticeCeiling(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * The accepted minimum is a floor, not a lattice point: a 140 height sits
 * between 136 and 144, so a settled size starts at the first lattice point that
 * is not below the minimum.
 */
function snapSizeTo(size: StageSize, step: number): StageSize {
  return {
    width: Math.max(latticeCeiling(STAGE_MIN_SIZE.width, step), nearestMultiple(size.width, step)),
    height: Math.max(latticeCeiling(STAGE_MIN_SIZE.height, step), nearestMultiple(size.height, step)),
  };
}

/** Round every layout edit to the lattice of the given step. */
export function gridSnapPolicy(step: number = GRID_STEP): SnapPolicy {
  const resolved = Number.isFinite(step) && step > 0 ? step : GRID_STEP;
  return {
    position: position => ({ x: nearestMultiple(position.x, resolved), y: nearestMultiple(position.y, resolved) }),
    size: size => snapSizeTo(size, resolved),
    coordinate: value => nearestMultiple(value, resolved),
  };
}

/**
 * The permissive policy: a position or size settles exactly where the pointer
 * is, and only a segment keeps the whole-unit rounding the diagram has always
 * applied.
 */
export const noSnap: SnapPolicy = {
  position: position => ({ x: position.x, y: position.y }),
  size: size => ({ width: size.width, height: size.height }),
  coordinate: value => Math.round(value),
};

/** The displacement that puts a moved route segment on the policy's line. */
export function segmentOffset(snap: SnapPolicy, coordinate: number, line: number): number {
  return snap.coordinate(coordinate) - line;
}
