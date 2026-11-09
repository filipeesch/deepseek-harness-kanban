import React from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import type { DiagramPoint } from './connections.js';

export interface ConnectionEdgeData {
  readonly path: string;
  readonly points: readonly DiagramPoint[];
  /** The direction the connection travels into its target, in degrees. */
  readonly tipAngle: number;
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
}

/**
 * Draws one connection, its arrowhead, and the contact points that appear while
 * the connection is pointed at.
 */
export function ConnectionEdgeView({ id, data }: EdgeProps) {
  const edge = data as unknown as ConnectionEdgeData;
  const start = edge.points[0];
  const tip = edge.points[edge.points.length - 1];
  const angle = Number.isFinite(edge.tipAngle) ? edge.tipAngle : 0;
  return <g className="kb-flow-edge-group">
    <BaseEdge id={id} path={edge.path} interactionWidth={18} className={'kb-flow-edge ' + (edge.kind === 'implicit' ? 'is-implicit' : 'is-explicit') + (edge.returning ? ' is-returning' : '')} />
    {start !== undefined && <circle className="kb-flow-contact" cx={start.x} cy={start.y} r={3.5} aria-hidden="true" />}
    {tip !== undefined && <circle className="kb-flow-contact" cx={tip.x} cy={tip.y} r={3.5} aria-hidden="true" />}
    {tip !== undefined && <polygon className="kb-flow-arrow" points="0,0 -10,-4.5 -10,4.5" transform={'translate(' + tip.x + ', ' + tip.y + ') rotate(' + angle + ')'} />}
  </g>;
}
