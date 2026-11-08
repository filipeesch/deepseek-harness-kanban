export interface DiagramPoint { readonly x: number; readonly y: number }
export interface DiagramRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface ConnectionShape { readonly path: string; readonly points: readonly DiagramPoint[] }

/** How far apart multiple connections leave the same stage edge. */
const FAN_OUT_SPACING = 20;
/** How far a returning connection runs below the stages it passes. */
const RETURNING_DEPTH = 72;
/** How many points the travel animation samples from the drawn curve. */
export const CONNECTION_SAMPLES = 24;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function cubic(start: DiagramPoint, controlA: DiagramPoint, controlB: DiagramPoint, end: DiagramPoint, t: number): DiagramPoint {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: a * start.x + b * controlA.x + c * controlB.x + d * end.x,
    y: a * start.y + b * controlA.y + c * controlB.y + d * end.y,
  };
}

/**
 * The drawn shape of one connection. A forward connection leaves the source's
 * right edge at a fan-out offset and enters the target's left edge; a returning
 * connection leaves both bottom edges and runs below the stages. The sampled
 * points are the same curve the path draws, which is what the card travels.
 */
export function connectionShape(from: DiagramRect, to: DiagramRect, options: { readonly returning: boolean; readonly fanOut: number; readonly fanOutCount: number; /** The lowest stage bottom the connection must stay below. */ readonly clearance?: number }): ConnectionShape {
  const spread = Math.max(0, from.height - 16);
  const spacing = options.fanOutCount > 1 ? Math.min(FAN_OUT_SPACING, spread / (options.fanOutCount - 1)) : 0;
  const offset = options.fanOutCount > 1 ? (options.fanOut - (options.fanOutCount - 1) / 2) * spacing : 0;
  let start: DiagramPoint;
  let controlA: DiagramPoint;
  let controlB: DiagramPoint;
  let end: DiagramPoint;
  if (options.returning) {
    // Distinct departures along the bottom edge, and a gutter below every stage
    // so the return does not cut through a stacked stage on its way back.
    const step = from.width / (options.fanOutCount + 1);
    start = { x: from.x + step * (options.fanOut + 1), y: from.y + from.height };
    end = { x: to.x + to.width / 2, y: to.y + to.height };
    const floor = Math.max(start.y, end.y, options.clearance ?? 0) + RETURNING_DEPTH;
    // A cubic with both controls at `depth` peaks at (start + end + 6 * depth) / 8,
    // so the controls sit deeper than the gutter the curve must clear.
    const depth = Math.max(floor, (8 * floor - start.y - end.y) / 6);
    controlA = { x: start.x, y: depth };
    controlB = { x: end.x, y: depth };
  } else {
    start = { x: from.x + from.width, y: from.y + from.height / 2 + offset };
    end = { x: to.x, y: to.y + to.height / 2 };
    const reach = Math.max(48, Math.abs(end.x - start.x) / 2);
    controlA = { x: start.x + reach, y: start.y };
    controlB = { x: end.x - reach, y: end.y };
  }
  const points: DiagramPoint[] = [];
  for (let index = 0; index <= CONNECTION_SAMPLES; index++) {
    points.push(cubic(start, controlA, controlB, end, index / CONNECTION_SAMPLES));
  }
  const path = 'M ' + round(start.x) + ' ' + round(start.y)
    + ' C ' + round(controlA.x) + ' ' + round(controlA.y)
    + ', ' + round(controlB.x) + ' ' + round(controlB.y)
    + ', ' + round(end.x) + ' ' + round(end.y);
  return { path, points };
}

/** The straight fallback when the diagram draws no connection between two stages. */
export function directShape(from: DiagramRect, to: DiagramRect): ConnectionShape {
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const points: DiagramPoint[] = [];
  for (let index = 0; index <= CONNECTION_SAMPLES; index++) {
    const t = index / CONNECTION_SAMPLES;
    points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
  }
  return { path: 'M ' + round(start.x) + ' ' + round(start.y) + ' C ' + round((start.x + end.x) / 2) + ' ' + round(start.y) + ', ' + round((start.x + end.x) / 2) + ' ' + round(end.y) + ', ' + round(end.x) + ' ' + round(end.y), points };
}
