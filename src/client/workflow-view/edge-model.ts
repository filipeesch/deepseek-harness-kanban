import type { ConnectionAnchor, ConnectionLayout, ConnectionSegmentOffset } from '../../shared/types.js';
import { connectionRoute, type ConnectionRoute, type RouteLine } from '../../domain/diagram/route.js';
import type { ConnectionShape, DiagramRect } from '../../domain/diagram/orthogonal.js';

/** One stage as the diagram currently shows it, before the change is stored. */
export interface LiveStageRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One connection as the workflow defines it, with the layout the diagram should draw. */
export interface LiveConnectionDescriptor {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
  readonly fanOut: number;
  readonly fanOutCount: number;
  /** The authored source touch point; absent keeps the automatic departure. */
  readonly source?: ConnectionAnchor;
  /** The authored target touch point; absent keeps the automatic arrival. */
  readonly target?: ConnectionAnchor;
  /** The authored segment displacements, in path order per axis. */
  readonly segments?: readonly ConnectionSegmentOffset[];
  /** The condition this transition authors; absent means it authors none. */
  readonly condition?: string;
  /** Deterministic exit names sharing this exact destination. */
  readonly exitLabels?: readonly string[];
}

export interface LiveEdge extends ConnectionShape {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
  /** The condition this transition authors; absent means it authors none. */
  readonly condition?: string;
  /** Deterministic exit names sharing this exact destination. */
  readonly exitLabels?: readonly string[];
  /** The adjustable segments of the drawn path, in path order. */
  readonly lines: readonly RouteLine[];
}

function rectOf(stage: LiveStageRect): DiagramRect {
  return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
}

/** The displacement the authored layout already applies to one axis at one position. */
export function authoredOffsetAt(segments: readonly ConnectionSegmentOffset[], axis: 'x' | 'y', order: number): number {
  return segments.filter(segment => segment.axis === axis)[order]?.offset ?? 0;
}

/**
 * The automatic coordinate of one drawn line, before its own authored displacement.
 * The drawn line already carries that displacement, so the baseline is the drawn
 * coordinate minus the offset this gesture would replace. A displacement on the
 * other axis can move the route's corridor and therefore its floor, which is why
 * the baseline comes from the drawn route instead of one rebuilt without offsets.
 */
export function baselineCoordinateOf(route: ConnectionRoute, axis: 'x' | 'y', order: number, segments: readonly ConnectionSegmentOffset[] | undefined): number | undefined {
  const line = route.lines.filter(value => value.axis === axis)[order];
  if (line === undefined) return undefined;
  return line.coordinate - authoredOffsetAt(segments ?? [], axis, order);
}

/** Replace the displacement of one axis at one position, keeping the others in order. */
export function withOffset(segments: readonly ConnectionSegmentOffset[], axis: 'x' | 'y', order: number, offset: number): ConnectionSegmentOffset[] {
  const result = segments.map(segment => ({ axis: segment.axis, offset: segment.offset }));
  const positions: number[] = [];
  result.forEach((segment, index) => { if (segment.axis === axis) positions.push(index); });
  while (positions.length <= order) {
    result.push({ axis, offset: 0 });
    positions.push(result.length - 1);
  }
  result[positions[order]!] = { axis, offset };
  return result;
}

/** What an adjustment may author on one connection: its ends and its segments. */
export interface ConnectionLayoutOverride {
  readonly source?: ConnectionAnchor;
  readonly target?: ConnectionAnchor;
  readonly segments?: readonly ConnectionSegmentOffset[];
}

/** The layout a connection describes once a gesture's override is applied. */
export function connectionLayoutOf(connection: LiveConnectionDescriptor, override: ConnectionLayoutOverride): ConnectionLayout {
  const source = override.source ?? connection.source;
  const target = override.target ?? connection.target;
  const segments = override.segments ?? connection.segments;
  return {
    from: connection.from,
    to: connection.to,
    ...(source === undefined ? {} : { source }),
    ...(target === undefined ? {} : { target }),
    ...(segments === undefined ? {} : { segments: [...segments] }),
  };
}

/**
 * The route of one connection as the live diagram should draw it. The stages are
 * supplied here, so the router can clear the stages the connection's own corridor
 * crosses and no others; the drawing, the travel path, and the drag baseline can
 * never disagree about where a segment sits.
 */
export function connectionRouteFor(stages: readonly LiveStageRect[], connection: LiveConnectionDescriptor, withOffsets: boolean): ConnectionRoute | null {
  const from = stages.find(stage => stage.id === connection.from);
  const to = stages.find(stage => stage.id === connection.to);
  if (from === undefined || to === undefined) return null;
  return connectionRoute({
    from: rectOf(from),
    to: rectOf(to),
    returning: connection.returning,
    fanOut: connection.fanOut,
    fanOutCount: connection.fanOutCount,
    clearanceStages: stages.map(rectOf),
    ...(connection.source === undefined ? {} : { source: connection.source }),
    ...(connection.target === undefined ? {} : { target: connection.target }),
    ...(!withOffsets || connection.segments === undefined ? {} : { segments: connection.segments }),
  });
}

/**
 * The edges the diagram draws for the rectangles it currently shows. Every edge
 * is derived from the live positions and sizes through the shared router, so a
 * stage being dragged or resized carries its connections with it and the drawn
 * path is the path a card travels.
 */
export function edgeModel(stages: readonly LiveStageRect[], connections: readonly LiveConnectionDescriptor[]): LiveEdge[] {
  const edges: LiveEdge[] = [];
  for (const connection of connections) {
    const route = connectionRouteFor(stages, connection, true);
    if (route === null) continue;
    edges.push({ id: connection.id, from: connection.from, to: connection.to, kind: connection.kind, returning: connection.returning, path: route.shape.path, points: route.shape.points, tipAngle: route.shape.tipAngle, lines: route.lines, ...(connection.condition === undefined ? {} : { condition: connection.condition }), ...(connection.exitLabels === undefined ? {} : { exitLabels: connection.exitLabels }) });
  }
  return edges;
}
