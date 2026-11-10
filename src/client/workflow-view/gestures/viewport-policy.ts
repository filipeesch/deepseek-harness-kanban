/** The bounded zoom range every diagram gesture and control shares. */
export const FLOW_ZOOM = { min: 0.2, max: 2.5, step: 1.25 } as const;

/**
 * The largest a card's attention mark may grow against the diagram's zoom. Above the
 * bound a mark keeps a constant on-screen size; below it the mark shrinks with the
 * card instead of dwarfing it.
 */
export const MARK_SCALE_LIMIT = 3.5;

/** The zoom a mark multiplies by to keep its authored on-screen size, bounded. */
export function markScale(zoom: number): number {
  const safe = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(MARK_SCALE_LIMIT, Math.max(1, 1 / safe));
}

export interface Viewport { readonly x: number; readonly y: number; readonly zoom: number }
export interface ViewportPoint { readonly x: number; readonly y: number }

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(FLOW_ZOOM.max, Math.max(FLOW_ZOOM.min, zoom));
}

/** The next zoom level in one direction, stopped at the bounds. */
export function nextZoom(zoom: number, direction: 'in' | 'out'): number {
  return clampZoom(direction === 'in' ? zoom * FLOW_ZOOM.step : zoom / FLOW_ZOOM.step);
}

/** The viewport that keeps the given screen point over the same diagram point. */
export function zoomAroundPoint(viewport: Viewport, point: ViewportPoint, zoom: number): Viewport {
  const next = clampZoom(zoom);
  const scale = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  return {
    x: point.x - ((point.x - viewport.x) / scale) * next,
    y: point.y - ((point.y - viewport.y) / scale) * next,
    zoom: next,
  };
}
