import type { StageSize } from '../shared/types.js';

/**
 * The smallest size a stage renders at. This is also the default stage size the
 * diagram has always used, so an authored size can only grow a stage.
 */
export const STAGE_MIN_SIZE: StageSize = { width: 264, height: 140 };

/** The largest accepted authored width or height of a stage. */
export const STAGE_SIZE_LIMIT = 10_000;

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

/** The size a stage renders at before its content is measured. */
export function effectiveStageSize(stored: StageSize | undefined): StageSize {
  return {
    width: clamp(stored?.width ?? STAGE_MIN_SIZE.width, STAGE_MIN_SIZE.width, STAGE_SIZE_LIMIT),
    height: clamp(stored?.height ?? STAGE_MIN_SIZE.height, STAGE_MIN_SIZE.height, STAGE_SIZE_LIMIT),
  };
}

/** The stored size a finished resize authors: always inside the accepted bounds. */
export function clampStageSize(size: StageSize): StageSize {
  return {
    width: Math.round(clamp(size.width, STAGE_MIN_SIZE.width, STAGE_SIZE_LIMIT)),
    height: Math.round(clamp(size.height, STAGE_MIN_SIZE.height, STAGE_SIZE_LIMIT)),
  };
}

/** True when the value is a size the diagram can accept as an authored minimum. */
export function isAcceptedStageSize(size: StageSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width >= STAGE_MIN_SIZE.width && size.height >= STAGE_MIN_SIZE.height
    && size.width <= STAGE_SIZE_LIMIT && size.height <= STAGE_SIZE_LIMIT;
}

export function sameStageSize(left: StageSize | undefined, right: StageSize | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.width === right.width && left.height === right.height;
}
