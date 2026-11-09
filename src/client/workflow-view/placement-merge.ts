import type { StagePosition } from '../../shared/types.js';
import { samePosition } from '../../domain/stage-position.js';

export type StagePlacements = Readonly<Record<string, StagePosition>>;

/** Manual overrides win over stored positions, which win over automatic placement. */
export function mergePlacements(automatic: StagePlacements, stored: StagePlacements, overrides: StagePlacements = {}): Map<string, StagePosition> {
  const merged = new Map<string, StagePosition>();
  for (const [id, position] of Object.entries(automatic)) merged.set(id, position);
  for (const [id, position] of Object.entries(stored)) merged.set(id, position);
  for (const [id, position] of Object.entries(overrides)) merged.set(id, position);
  return merged;
}

export function samePlacements(left: StagePlacements, right: StagePlacements): boolean {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const id of ids) if (!samePosition(left[id], right[id])) return false;
  return true;
}
