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
