import type { StagePosition } from '../shared/types.js';

/** True when two authored stage positions describe the same point. */
export function samePosition(left: StagePosition | undefined, right: StagePosition | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.x === right.x && left.y === right.y;
}
