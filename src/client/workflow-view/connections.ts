export interface DiagramPoint { readonly x: number; readonly y: number }
export interface DiagramRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface ConnectionShape {
  readonly path: string;
  readonly points: readonly DiagramPoint[];
  /** The direction the connection travels into its target, in degrees. */
  readonly tipAngle: number;
}

/** How far apart multiple connections leave the same stage edge. */
const FAN_OUT_SPACING = 20;
/** How far a returning connection runs below the stages it passes. */
const RETURNING_DEPTH = 72;
/** The radius of every right-angle corner. */
const CORNER_RADIUS = 12;
/** How many points the travel animation samples from the drawn path. */
export const CONNECTION_SAMPLES = 32;

type Segment =
  | { readonly kind: 'line'; readonly from: DiagramPoint; readonly to: DiagramPoint }
  | { readonly kind: 'quad'; readonly from: DiagramPoint; readonly control: DiagramPoint; readonly to: DiagramPoint };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function distance(from: DiagramPoint, to: DiagramPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** A point `span` away from `from`, on the line towards `to`. */
function towards(from: DiagramPoint, to: DiagramPoint, span: number): DiagramPoint {
  const length = distance(from, to);
  if (length === 0) return { x: from.x, y: from.y };
  return { x: from.x + ((to.x - from.x) / length) * span, y: from.y + ((to.y - from.y) / length) * span };
}

/** Turn a polyline into line segments joined by rounded corners. */
function roundedSegments(points: readonly DiagramPoint[], radius: number): Segment[] {
  const segments: Segment[] = [];
  let cursor = points[0];
  if (cursor === undefined) return segments;
  for (let index = 1; index < points.length - 1; index++) {
    const corner = points[index]!;
    const previous = points[index - 1]!;
    const following = points[index + 1]!;
    const span = Math.min(radius, distance(previous, corner) / 2, distance(corner, following) / 2);
    const entry = towards(corner, previous, span);
    const exit = towards(corner, following, span);
    if (distance(cursor, entry) > 0) segments.push({ kind: 'line', from: cursor, to: entry });
    if (span > 0) segments.push({ kind: 'quad', from: entry, control: corner, to: exit });
    cursor = exit;
  }
  const end = points[points.length - 1];
  if (end !== undefined && distance(cursor, end) > 0) segments.push({ kind: 'line', from: cursor, to: end });
  return segments;
}

function segmentPath(segments: readonly Segment[]): string {
  const first = segments[0];
  if (first === undefined) return '';
  let path = 'M ' + round(first.from.x) + ' ' + round(first.from.y);
  for (const segment of segments) {
    path += segment.kind === 'line'
      ? ' L ' + round(segment.to.x) + ' ' + round(segment.to.y)
      : ' Q ' + round(segment.control.x) + ' ' + round(segment.control.y) + ', ' + round(segment.to.x) + ' ' + round(segment.to.y);
  }
  return path;
}

function approximateLength(segment: Segment): number {
  return segment.kind === 'line' ? distance(segment.from, segment.to) : distance(segment.from, segment.control) + distance(segment.control, segment.to);
}

function pointAt(segment: Segment, t: number): DiagramPoint {
  if (segment.kind === 'line') {
    return { x: segment.from.x + (segment.to.x - segment.from.x) * t, y: segment.from.y + (segment.to.y - segment.from.y) * t };
  }
  const inverse = 1 - t;
  const a = inverse * inverse;
  const b = 2 * inverse * t;
  const c = t * t;
  return {
    x: a * segment.from.x + b * segment.control.x + c * segment.to.x,
    y: a * segment.from.y + b * segment.control.y + c * segment.to.y,
  };
}

/** Sample the drawn path at a fixed number of steps, so a card can travel along it. */
function sampleSegments(segments: readonly Segment[], count: number): DiagramPoint[] {
  if (segments.length === 0) return [];
  const lengths = segments.map(approximateLength);
  const total = lengths.reduce((sum, value) => sum + value, 0) || 1;
  const points: DiagramPoint[] = [];
  let segmentIndex = 0;
  let consumed = 0;
  for (let step = 0; step <= count; step++) {
    const target = (step / count) * total;
    while (segmentIndex < segments.length - 1 && target > consumed + (lengths[segmentIndex] ?? 0)) {
      consumed += lengths[segmentIndex] ?? 0;
      segmentIndex += 1;
    }
    const length = lengths[segmentIndex] ?? 0;
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, (target - consumed) / length));
    points.push(pointAt(segments[segmentIndex]!, t));
  }
  points[points.length - 1] = pointAt(segments[segments.length - 1]!, 1);
  return points;
}

/**
 * The drawn shape of one connection. A forward connection leaves the source's
 * right edge at a fan-out offset and enters the target's left edge; a returning
 * connection leaves both bottom edges and runs below the stages. Both are
 * orthogonal with rounded corners, and the sampled points are the same path the
 * card travels.
 */
function tipAngleOf(points: readonly DiagramPoint[]): number {
  const end = points[points.length - 1];
  const previous = points[points.length - 2];
  if (end === undefined || previous === undefined) return 0;
  return Math.atan2(end.y - previous.y, end.x - previous.x) * (180 / Math.PI);
}

/** Both edges leave and enter through the bottom, below every stage. */
function bottomPoints(from: DiagramRect, to: DiagramRect, options: {
  readonly fanOut: number;
  readonly fanOutCount: number;
  readonly clearance?: number;
}): DiagramPoint[] {
  // Distinct departures along the bottom edge, and a gutter below every stage so
  // the route does not cut through a stacked stage on its way back.
  const step = from.width / (options.fanOutCount + 1);
  const start = { x: from.x + step * (options.fanOut + 1), y: from.y + from.height };
  const end = { x: to.x + to.width / 2, y: to.y + to.height };
  const floor = Math.max(start.y, end.y, options.clearance ?? 0) + RETURNING_DEPTH;
  return [start, { x: start.x, y: floor }, { x: end.x, y: floor }, end];
}

/** The route that leaves and enters through the right edges, outside both stages. */
function sidePoints(start: DiagramPoint, end: DiagramPoint): DiagramPoint[] {
  const gutter = Math.max(start.x, end.x) + RETURNING_DEPTH;
  return [start, { x: gutter, y: start.y }, { x: gutter, y: end.y }, end];
}

function rangesOverlap(from: DiagramRect, to: DiagramRect): { readonly x: boolean; readonly y: boolean } {
  return {
    x: from.x < to.x + to.width && to.x < from.x + from.width,
    y: from.y < to.y + to.height && to.y < from.y + from.height,
  };
}

export function connectionShape(from: DiagramRect, to: DiagramRect, options: {
  readonly returning: boolean;
  readonly fanOut: number;
  readonly fanOutCount: number;
  /** The lowest stage bottom the connection must stay below. */
  readonly clearance?: number;
}): ConnectionShape {
  const spread = Math.max(0, from.height - 16);
  const spacing = options.fanOutCount > 1 ? Math.min(FAN_OUT_SPACING, spread / (options.fanOutCount - 1)) : 0;
  const offset = options.fanOutCount > 1 ? (options.fanOut - (options.fanOutCount - 1) / 2) * spacing : 0;
  let points: DiagramPoint[];
  if (options.returning) {
    points = bottomPoints(from, to, options);
  } else {
    const start = { x: from.x + from.width, y: from.y + from.height / 2 + offset };
    const end = { x: to.x, y: to.y + to.height / 2 };
    // The target can sit physically before the source after stages are rearranged;
    // a horizontal line would then cross both interiors. A stacked pair overlapping
    // horizontally gets the side route, because a bottom gutter would run through
    // the lower stage; every other arrangement uses the gutter below both.
    if (end.x <= start.x) {
      const overlap = rangesOverlap(from, to);
      const sideEnd = { x: to.x + to.width, y: to.y + to.height / 2 };
      points = overlap.x && !overlap.y ? sidePoints(start, sideEnd) : bottomPoints(from, to, options);
    }
    else if (Math.abs(end.y - start.y) < 1) points = [start, end];
    else {
      const middle = (start.x + end.x) / 2;
      points = [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
    }
  }
  const segments = roundedSegments(points, CORNER_RADIUS);
  return { path: segmentPath(segments), points: sampleSegments(segments, CONNECTION_SAMPLES), tipAngle: tipAngleOf(points) };
}

/** The straight fallback when the diagram draws no connection between two stages. */
export function directShape(from: DiagramRect, to: DiagramRect): ConnectionShape {
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const segments: Segment[] = [{ kind: 'line', from: start, to: end }];
  return { path: segmentPath(segments), points: sampleSegments(segments, CONNECTION_SAMPLES), tipAngle: tipAngleOf([start, end]) };
}
