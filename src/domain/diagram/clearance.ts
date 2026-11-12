import type { DiagramPoint, DiagramRect } from './orthogonal.js';

/** The horizontal span a route occupies between its departure and arrival legs. */
export interface RouteCorridor {
  readonly minX: number;
  readonly maxX: number;
}

/**
 * The corridor of a route, spanning the horizontal positions its legs occupy. A
 * side detour widens the corridor by the gutter it steps aside to.
 */
export function corridorOf(startX: number, endX: number, ...wider: readonly number[]): RouteCorridor {
  let minX = Math.min(startX, endX);
  let maxX = Math.max(startX, endX);
  for (const x of wider) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  return { minX, maxX };
}

/** The corridor a drawn polyline occupies: the horizontal extent of its points. */
export function corridorOfPoints(points: readonly DiagramPoint[]): RouteCorridor {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return { minX: 0, maxX: 0 };
  return { minX, maxX };
}

/** True when a stage's horizontal range intersects the corridor. */
export function stageCrossesCorridor(stage: DiagramRect, corridor: RouteCorridor): boolean {
  return stage.x < corridor.maxX && stage.x + stage.width > corridor.minX;
}

/**
 * The lowest stage bottom a route must clear below its own corridor. Only the
 * stages the corridor crosses count, so a stage elsewhere in the diagram can
 * never move this route.
 */
export function corridorClearance(stages: readonly DiagramRect[], corridor: RouteCorridor): number {
  let clearance = 0;
  for (const stage of stages) {
    if (!stageCrossesCorridor(stage, corridor)) continue;
    const bottom = stage.y + stage.height;
    if (bottom > clearance) clearance = bottom;
  }
  return clearance;
}
