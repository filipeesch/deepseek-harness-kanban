import React from 'react';
import { diagramBox } from './affordance-geometry.js';
import type { LiveEdge } from './edge-model.js';

/** Room the presented route reserves around itself, in diagram units, for its stroke and arrowhead. */
const ROUTE_PADDING = 16;

export interface SelectedRouteProps {
  /** The selected connection as the diagram draws it, or undefined while nothing is selected. */
  readonly edge: LiveEdge | undefined;
}

/**
 * The route of the selected connection, drawn above the stage regions so a segment
 * a stage region hides is still readable. It copies the path and the arrowhead the
 * edge layer already draws, with the paint of a selected connection, and it is
 * inert: it never receives a press and it is hidden from assistive technology,
 * because the connection beneath it remains the control.
 */
export function SelectedRoute({ edge }: SelectedRouteProps) {
  if (edge === undefined || edge.points.length === 0) return null;
  const box = diagramBox(edge.points, ROUTE_PADDING);
  const tip = edge.points[edge.points.length - 1]!;
  const angle = Number.isFinite(edge.tipAngle) ? edge.tipAngle : 0;
  return <svg
    className="kb-flow-selected-route"
    width={box.width}
    height={box.height}
    viewBox={box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height}
    style={{ left: box.x, top: box.y }}
    aria-hidden="true"
  >
    <path className={'kb-flow-selected-route-path' + (edge.kind === 'implicit' ? ' is-implicit' : '')} d={edge.path} />
    <polygon className="kb-flow-selected-route-arrow" points="0,0 -10,-4.5 -10,4.5" transform={'translate(' + tip.x + ', ' + tip.y + ') rotate(' + angle + ')'} />
  </svg>;
}
