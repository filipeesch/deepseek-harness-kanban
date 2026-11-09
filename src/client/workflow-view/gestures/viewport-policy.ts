/** The bounded zoom range every diagram gesture and control shares. */
export const FLOW_ZOOM = { min: 0.2, max: 2.5, step: 1.25 } as const;

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
