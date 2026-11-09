import { connectionShape, type ConnectionShape, type DiagramPoint, type DiagramRect } from './connections.js';

/** One stage as the diagram currently shows it, before the change is stored. */
export interface LiveStageRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One connection as the workflow defines it, without its drawn shape. */
export interface LiveConnectionDescriptor {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
  readonly fanOut: number;
  readonly fanOutCount: number;
}

export interface LiveEdge extends ConnectionShape {
  readonly id: string;
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
}

function rectOf(stage: LiveStageRect): DiagramRect {
  return { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
}

/**
 * The edges the diagram draws for the rectangles it currently shows. Every edge
 * is derived from the live positions and sizes, so a stage being dragged or
 * resized carries its connections with it.
 */
export function liveConnections(stages: readonly LiveStageRect[], connections: readonly LiveConnectionDescriptor[]): LiveEdge[] {
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  const lowest = stages.reduce((bottom, stage) => Math.max(bottom, stage.y + stage.height), 0);
  const edges: LiveEdge[] = [];
  for (const connection of connections) {
    const from = byId.get(connection.from);
    const to = byId.get(connection.to);
    if (from === undefined || to === undefined) continue;
    const shape = connectionShape(rectOf(from), rectOf(to), {
      returning: connection.returning,
      fanOut: connection.fanOut,
      fanOutCount: connection.fanOutCount,
      clearance: lowest,
    });
    edges.push({ id: connection.id, kind: connection.kind, returning: connection.returning, path: shape.path, points: shape.points, tipAngle: shape.tipAngle });
  }
  return edges;
}

/** The contact points a connection reveals while it is pointed at. */
export function contactPoints(edge: LiveEdge): { readonly start: DiagramPoint; readonly end: DiagramPoint } | null {
  const start = edge.points[0];
  const end = edge.points[edge.points.length - 1];
  if (start === undefined || end === undefined) return null;
  return { start, end };
}
