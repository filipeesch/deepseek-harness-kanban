import React from 'react';
import { BaseEdge, EdgeLabelRenderer, useStore, type EdgeProps } from '@xyflow/react';
import type { DiagramPoint } from './routing/orthogonal.js';
import { useConnectionHandlers } from './connection-interaction.js';

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
  /** True when this transition authors a condition. */
  readonly hasCondition: boolean;
  readonly exitLabels?: readonly string[];
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
 * Draws one connection: its path, its arrowhead, the mark of a connection without
 * a condition, and the editor its exit names open. The marks that move the
 * connection are not drawn here; they live in the affordance layer above the
 * stages, so a stage or the arrowhead can never cover them. This component still
 * owns the press that selects the connection and the double press that edits it,
 * because the line remains the press target below the stage content.
 */
export function ConnectionEdgeView({ id, data }: EdgeProps) {
  const edge = data as unknown as ConnectionEdgeData;
  const handlers = useConnectionHandlers();
  const zoom = useStore(state => state.transform[2]);
  const scale = Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1;
  const tip = edge.points[edge.points.length - 1];
  const middle = pathMidpoint(edge.points);
  const angle = Number.isFinite(edge.tipAngle) ? edge.tipAngle : 0;
  const selected = handlers?.selectedId === id;
  return <g
    className={'kb-flow-edge-group' + (selected ? ' is-selected' : '')}
    data-connection-id={id}
    onClick={event => { if (!handlers?.locked) handlers?.onSelect(id); event.stopPropagation(); }}
    onDoubleClick={event => {
      // Authoring a condition for a connection that has none is a structural edit, so the
      // layout lock gates it; a condition that already exists stays editable.
      if (!handlers?.locked || edge.hasCondition) handlers?.onEditCondition(id);
      event.stopPropagation();
    }}
    onPointerEnter={() => handlers?.onHover(id)}
    onPointerLeave={() => handlers?.onHoverEnd(id)}
  >
    <BaseEdge id={id} path={edge.path} interactionWidth={LINE_HIT_WIDTH} className={'kb-flow-edge ' + (edge.kind === 'implicit' ? 'is-implicit' : 'is-explicit') + (edge.returning ? ' is-returning' : '')} />
    {middle !== undefined && !edge.hasCondition && edge.kind === 'explicit' && handlers?.locked !== true && <circle
      className="kb-flow-condition-mark"
      cx={middle.x}
      cy={middle.y}
      r={CONDITION_MARK_RADIUS * scale}
      aria-hidden="true"
    />}
    {middle !== undefined && edge.exitLabels !== undefined && <EdgeLabelRenderer><button type="button" className="kb-flow-exit-label nodrag nopan" style={{ transform: 'translate(-50%, -50%) translate(' + middle.x + 'px,' + (middle.y - 8 * scale) + 'px) scale(' + scale + ')' }} aria-label={'Named exits ' + edge.exitLabels.join(', ')} onClick={event => { event.stopPropagation(); handlers?.onEditCondition(id); }}>{edge.exitLabels.join(', ')}</button></EdgeLabelRenderer>}
    {tip !== undefined && <polygon className="kb-flow-arrow" points="0,0 -10,-4.5 -10,4.5" transform={'translate(' + tip.x + ', ' + tip.y + ') rotate(' + angle + ')'} />}
  </g>;
}
