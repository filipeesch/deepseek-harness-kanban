import React from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import type { DiagramPoint } from './connections.js';

export interface ConnectionEdgeData {
  readonly path: string;
  readonly points: readonly DiagramPoint[];
  readonly kind: 'explicit' | 'implicit';
  readonly returning: boolean;
}

/** Draws one connection and its arrowhead from the same curve the card travels. */
export function ConnectionEdgeView({ id, data }: EdgeProps) {
  const edge = data as unknown as ConnectionEdgeData;
  const tip = edge.points[edge.points.length - 1];
  const previous = edge.points[Math.max(0, edge.points.length - 5)];
  const angle = tip === undefined || previous === undefined ? 0 : Math.atan2(tip.y - previous.y, tip.x - previous.x) * (180 / Math.PI);
  return <g>
    <BaseEdge id={id} path={edge.path} className={'kb-flow-edge ' + (edge.kind === 'implicit' ? 'is-implicit' : 'is-explicit') + (edge.returning ? ' is-returning' : '')} />
    {tip !== undefined && <polygon className="kb-flow-arrow" points="0,0 -10,-4.5 -10,4.5" transform={'translate(' + tip.x + ', ' + tip.y + ') rotate(' + angle + ')'} />}
  </g>;
}
