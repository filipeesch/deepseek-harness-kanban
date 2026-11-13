import type { DiagramPoint } from '../../domain/diagram/orthogonal.js';

/** The sizes a connection affordance draws, in screen pixels. */
export const AFFORDANCE = {
  /** The visible diameter of an end handle. */
  mark: 12,
  /** The visible size of a segment grip. */
  grip: 12,
  /** The visible size of the dot that marks a connection port. */
  portMark: 12,
  /** The pointer target of a handle, a grip, or a stage port. */
  target: 24,
  /** How long a pointed-at connection keeps its marks after the pointer leaves. */
  lingerMs: 180,
} as const;

/** The smallest pointer target an affordance may present, in screen pixels. */
export const MIN_POINTER_TARGET = 24;

/**
 * How much an authored screen size multiplies to keep that size inside the
 * viewport, which the diagram scales by its zoom. A non-finite or zero zoom
 * falls back to 1, so a surface that has not measured yet still draws.
 */
export function affordanceScale(zoom: number): number {
  const safe = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return 1 / safe;
}

/** The diagram-space size that renders as the authored screen size at a zoom level. */
export function markSize(size: number, zoom: number): number {
  return size * affordanceScale(zoom);
}

/** The screen size a diagram-space mark occupies at a zoom level. */
export function screenSizeOf(flowSize: number, zoom: number): number {
  const safe = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return flowSize * safe;
}
/** A rectangle in diagram units that holds a drawn route. */
export interface DiagramBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The smallest box that holds a diagram-space route with the given padding, used
 * by everything the affordance layer draws from a route: the creation preview and
 * the route of the selected connection. Padding keeps a stroke and an arrowhead
 * inside the box, and an empty route still presents a box of its own padding.
 */
export function diagramBox(points: readonly DiagramPoint[], padding: number): DiagramBox {
  if (points.length === 0) return { x: -padding, y: -padding, width: padding * 2, height: padding * 2 };
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) + padding - minX),
    height: Math.max(1, Math.max(...ys) + padding - minY),
  };
}
