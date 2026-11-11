import React from 'react';
import { BaseEdge, useStore, type EdgeProps } from '@xyflow/react';
import type { DiagramPoint } from './routing/orthogonal.js';
import type { RouteLine } from './routing/route.js';
import { useConnectionHandlers } from './connection-interaction.js';

/** The screen size of a handle, kept constant while the diagram zooms. */
const CONTACT_RADIUS = 3.5;
const CONTACT_HIT_RADIUS = 10;
const SEGMENT_GRIP = 8;
/** The hollow mark that identifies a connection authoring no condition. */
const CONDITION_MARK_RADIUS = 4;
/** How wide the invisible path is that catches a press on the line. */
const LINE_HIT_WIDTH = 18;

export interface ConnectionEdgeData {
  readonly path: string;
  readonly points: readonly DiagramPoint[];
  /** The direction the connection travels into its target, in degrees. */
  readonly tipAngle: number;
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
  /** The adjustable segments of the drawn path, in path order. */
  readonly lines: readonly RouteLine[];
  /** True when this transition authors a condition. */
  readonly hasCondition: boolean;
}

/** The middle of a drawn path, where its mark and its editor sit. */
export function pathMidpoint(points: readonly DiagramPoint[]): DiagramPoint | undefined {
  if (points.length === 0) return undefined;
  let total = 0;
  const lengths: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    total += length;
  }
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = lengths[index - 1]!;
    if (walked + length >= total / 2) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const ratio = length === 0 ? 0 : (total / 2 - walked) / length;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    walked += length;
  }
  return points[points.length - 1];
}

/**
 * Draws one connection, its arrowhead, the mark of a connection without a condition,
 * and the handles that appear while the connection is pointed at: one at each end to
 * move the touch point, and one on each adjustable segment to move that segment.
 */
export function ConnectionEdgeView({ id, data }: EdgeProps) {
  const edge = data as unknown as ConnectionEdgeData;
  const handlers = useConnectionHandlers();
  const zoom = useStore(state => state.transform[2]);
  const scale = Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1;
  const start = edge.points[0];
  const tip = edge.points[edge.points.length - 1];
  const middle = pathMidpoint(edge.points);
  const angle = Number.isFinite(edge.tipAngle) ? edge.tipAngle : 0;
  const canAdjust = handlers !== null && !handlers.locked;
  const selected = handlers?.selectedId === id;
  // The group owns the press and the double press: the interaction path React Flow
  // already draws gives a comfortable target, and the handles keep their own gestures.
  return <g
    className={'kb-flow-edge-group' + (selected ? ' is-selected' : '')}
    data-connection-id={id}
    onClick={event => { if (!handlers?.locked) handlers?.onSelect(id); event.stopPropagation(); }}
    onDoubleClick={event => { handlers?.onEditCondition(id); event.stopPropagation(); }}
  >
    <BaseEdge id={id} path={edge.path} interactionWidth={LINE_HIT_WIDTH} className={'kb-flow-edge ' + (edge.kind === 'implicit' ? 'is-implicit' : 'is-explicit') + (edge.returning ? ' is-returning' : '')} />
    {middle !== undefined && !edge.hasCondition && edge.kind === 'explicit' && <circle
      className="kb-flow-condition-mark"
      cx={middle.x}
      cy={middle.y}
      r={CONDITION_MARK_RADIUS * scale}
      aria-hidden="true"
    />}
    {edge.lines.map(line => <rect
      key={'segment-' + line.index}
      className="kb-flow-segment"
      x={line.midpoint.x - (SEGMENT_GRIP / 2) * scale}
      y={line.midpoint.y - (SEGMENT_GRIP / 2) * scale}
      width={SEGMENT_GRIP * scale}
      height={SEGMENT_GRIP * scale}
      rx={2 * scale}
      aria-hidden="true"
      data-line={line.index}
      data-axis={line.axis}
      onPointerDown={event => { if (canAdjust) handlers?.onSegmentPointerDown(event, id, line.index); }}
    />)}
    {start !== undefined && <circle
      className="kb-flow-contact-hit"
      cx={start.x}
      cy={start.y}
      r={CONTACT_HIT_RADIUS * scale}
      aria-hidden="true"
      data-end="source"
      onPointerDown={event => { if (canAdjust) handlers?.onAnchorPointerDown(event, id, 'source'); }}
    />}
    {start !== undefined && <circle
      className="kb-flow-contact"
      cx={start.x}
      cy={start.y}
      r={CONTACT_RADIUS * scale}
      role="button"
      tabIndex={0}
      data-end="source"
      aria-label={handlers?.describe(id, 'source') ?? 'Arrow source end'}
      onPointerDown={event => { if (canAdjust) handlers?.onAnchorPointerDown(event, id, 'source'); }}
      onKeyDown={event => handlers?.onAnchorKeyDown(event, id, 'source')}
      onBlur={() => handlers?.onAnchorBlur(id, 'source')}
    />}
    {tip !== undefined && <circle
      className="kb-flow-contact-hit"
      cx={tip.x}
      cy={tip.y}
      r={CONTACT_HIT_RADIUS * scale}
      aria-hidden="true"
      data-end="target"
      onPointerDown={event => { if (canAdjust) handlers?.onAnchorPointerDown(event, id, 'target'); }}
    />}
    {tip !== undefined && <circle
      className="kb-flow-contact"
      cx={tip.x}
      cy={tip.y}
      r={CONTACT_RADIUS * scale}
      role="button"
      tabIndex={0}
      data-end="target"
      aria-label={handlers?.describe(id, 'target') ?? 'Arrow target end'}
      onPointerDown={event => { if (canAdjust) handlers?.onAnchorPointerDown(event, id, 'target'); }}
      onKeyDown={event => handlers?.onAnchorKeyDown(event, id, 'target')}
      onBlur={() => handlers?.onAnchorBlur(id, 'target')}
    />}
    {tip !== undefined && <polygon className="kb-flow-arrow" points="0,0 -10,-4.5 -10,4.5" transform={'translate(' + tip.x + ', ' + tip.y + ') rotate(' + angle + ')'} />}
  </g>;
}
