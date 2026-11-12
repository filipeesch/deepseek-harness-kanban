export interface DiagramPoint { readonly x: number; readonly y: number }
export interface DiagramRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface ConnectionShape {
  readonly path: string;
  readonly points: readonly DiagramPoint[];
  /** The direction the connection travels into its target, in degrees. */
  readonly tipAngle: number;
}

/** The radius of every right-angle corner. */
export const CORNER_RADIUS = 12;
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

/** A point span away from from, on the line towards to. */
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

function tipAngleOf(points: readonly DiagramPoint[]): number {
  const end = points[points.length - 1];
  const previous = points[points.length - 2];
  if (end === undefined || previous === undefined) return 0;
  return Math.atan2(end.y - previous.y, end.x - previous.x) * (180 / Math.PI);
}

/** The drawn shape of a polyline: a rounded orthogonal path, its sample points, and the tip angle. */
export function buildShape(points: readonly DiagramPoint[]): ConnectionShape {
  const segments = roundedSegments(points, CORNER_RADIUS);
  return { path: segmentPath(segments), points: sampleSegments(segments, CONNECTION_SAMPLES), tipAngle: tipAngleOf(points) };
}

/** Drop repeated points and the corners that add nothing, so every segment alternates axis. */
export function normalizePolyline(points: readonly DiagramPoint[]): DiagramPoint[] {
  const collapsed: DiagramPoint[] = [];
  for (const point of points) {
    const previous = collapsed[collapsed.length - 1];
    if (previous !== undefined && Math.abs(previous.x - point.x) < 0.01 && Math.abs(previous.y - point.y) < 0.01) continue;
    collapsed.push({ x: point.x, y: point.y });
  }
  const result: DiagramPoint[] = [];
  for (const point of collapsed) {
    while (result.length >= 2) {
      const first = result[result.length - 2]!;
      const second = result[result.length - 1]!;
      const vertical = Math.abs(first.x - second.x) < 0.01 && Math.abs(second.x - point.x) < 0.01;
      const horizontal = Math.abs(first.y - second.y) < 0.01 && Math.abs(second.y - point.y) < 0.01;
      if (!vertical && !horizontal) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}
