import React from 'react';
import { useStore } from '@xyflow/react';
import type { StageSide } from '../../shared/types.js';
import { AFFORDANCE, affordanceScale, diagramBox } from './affordance-geometry.js';
import { useConnectionHandlers, type ConnectionEnd } from './connection-interaction.js';
import { ABSENT_MODE, editable, marksPresented, selectsOnFocus } from './connection-mode.js';
import type { LiveEdge, LiveStageRect } from './edge-model.js';
import type { DiagramPoint } from '../../domain/diagram/orthogonal.js';
import type { CreationState } from './use/use-connection-gestures.js';

/** The sides a connection can be drawn from, in the order the ports are presented. */
const CONNECTION_SIDES: readonly StageSide[] = ['top', 'right', 'bottom', 'left'];

/** Room the creation preview reserves around its line, in diagram units. */
const PREVIEW_PADDING = 48;
/** The screen size of the dot a pointer line ends at. */
const PREVIEW_TIP = 4;

export interface ConnectionAffordancesProps {
  /** The connections the diagram draws, with their live geometry. */
  readonly edges: readonly LiveEdge[];
  /** The line a creation drag presents, or null while no creation is running. */
  readonly creation: CreationState | null;
  /** The stages as the diagram currently shows them, for the creation ports. */
  readonly stages: readonly LiveStageRect[];
  /** The stage the pointer is on; its ports are the only ones presented. */
  readonly hoveredStageId: string | null;
  /** Keeps the ports presented while the pointer crosses from the stage to a port. */
  onStageEnter(stageId: string): void;
  onStageLeave(stageId: string): void;
  /** Starts drawing a new connection from one side of one stage. */
  onBeginConnect(event: React.PointerEvent<Element>, stageId: string, side: StageSide): void;
}

/**
 * The centre of one side of a stage. A connection port's pointer target sits just
 * outside that boundary, so it never takes a press from the stage's own header,
 * cards, or resize handle; only its dot reaches back to the edge.
 */
function boundaryPoint(stage: LiveStageRect, side: StageSide, outward: number): DiagramPoint {
  switch (side) {
    case 'top': return { x: stage.x + stage.width / 2, y: stage.y - outward };
    case 'bottom': return { x: stage.x + stage.width / 2, y: stage.y + stage.height + outward };
    case 'left': return { x: stage.x - outward, y: stage.y + stage.height / 2 };
    default: return { x: stage.x + stage.width + outward, y: stage.y + stage.height / 2 };
  }
}

function portStyle(point: DiagramPoint, target: number, mark: number, scale: number): React.CSSProperties {
  return {
    left: point.x,
    top: point.y,
    width: target,
    height: target,
    ['--kb-port-mark' as string]: mark + 'px',
    // The mark is authored in screen pixels and counter-scaled, so its border,
    // shadow, and outline keep the same screen thickness as its size.
    ['--kb-affordance-scale' as string]: String(scale),
  } as React.CSSProperties;
}

function positionStyle(point: DiagramPoint, target: number, mark: number, scale: number): React.CSSProperties {
  return {
    left: point.x,
    top: point.y,
    width: target,
    height: target,
    ['--kb-affordance-mark' as string]: mark + 'px',
    ['--kb-affordance-scale' as string]: String(scale),
  } as React.CSSProperties;
}

/** The line, route, and arrowhead a creation drag presents while it is running. */
function CreationAffordance({ creation, scale }: { readonly creation: CreationState; readonly scale: number }) {
  const route = creation.route;
  const points = route?.points ?? [creation.from, creation.to];
  const box = diagramBox(points, PREVIEW_PADDING);
  const tip = route?.points[route.points.length - 1];
  return <svg
    className="kb-flow-creation"
    width={box.width}
    height={box.height}
    viewBox={box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height}
    style={{ left: box.x, top: box.y }}
    aria-hidden="true"
  >
    {route === undefined
      ? <path className="kb-flow-creation-line" d={'M ' + creation.from.x + ' ' + creation.from.y + ' L ' + creation.to.x + ' ' + creation.to.y} />
      : <path className="kb-flow-creation-route" d={route.path} />}
    {route === undefined
      ? <circle className="kb-flow-creation-tip" cx={creation.to.x} cy={creation.to.y} r={PREVIEW_TIP * scale} />
      : tip !== undefined && <polygon className="kb-flow-creation-arrow" points="0,0 -10,-4.5 -10,4.5" transform={'translate(' + tip.x + ', ' + tip.y + ') rotate(' + route.tipAngle + ') scale(' + scale + ')'} />}
  </svg>;
}

/**
 * The marks that move a connection, drawn above the stage regions so a stage
 * boundary or the arrowhead can never cover them. One handle sits at each end and
 * one grip on each adjustable segment of every drawn connection; a connection's
 * marks are presented only while the diagram is editable and the connection is
 * pointed at or selected, and focused marks stay presented so the keyboard
 * adjustment keeps working. The marks exist in the DOM for every connection at all
 * times, which is what keeps both ends reachable by keyboard without pointing at
 * the line first; an inspecting diagram never reveals them, and focusing an end
 * selects its connection instead.
 */
export function ConnectionAffordances({ edges, creation, stages, hoveredStageId, onStageEnter, onStageLeave, onBeginConnect }: ConnectionAffordancesProps) {
  const handlers = useConnectionHandlers();
  const mode = handlers?.mode ?? ABSENT_MODE;
  const zoom = useStore(state => state.transform[2]);
  const scale = affordanceScale(zoom);
  const target = AFFORDANCE.target * scale;
  const mark = AFFORDANCE.mark;
  const grip = AFFORDANCE.grip;
  const portMark = AFFORDANCE.portMark;
  const operational = editable(mode);
  const portStage = operational ? stages.find(stage => stage.id === hoveredStageId) : undefined;
  return <div className="kb-flow-affordances">
    {portStage !== undefined && CONNECTION_SIDES.map(side => {
      const point = boundaryPoint(portStage, side, target / 2);
      return <div
        key={'port-' + side}
        className="kb-flow-port"
        data-side={side}
        data-stage-id={portStage.id}
        aria-hidden="true"
        title={'Draw a connection from the ' + side + ' side'}
        style={portStyle(point, target, portMark, scale)}
        onPointerDown={event => onBeginConnect(event, portStage.id, side)}
        onPointerEnter={() => onStageEnter(portStage.id)}
        onPointerLeave={() => onStageLeave(portStage.id)}
      ><span className="kb-flow-port-dot" aria-hidden="true" /></div>;
    })}
    {edges.map(edge => {
      const selected = handlers?.selectedId === edge.id;
      const marked = marksPresented(mode, { hovered: handlers?.hoveredId === edge.id, selected });
      const selectOnFocus = selectsOnFocus(mode);
      const start = edge.points[0];
      const tip = edge.points[edge.points.length - 1];
      const describe = (end: ConnectionEnd) => handlers?.describe(edge.id, end) ?? 'Arrow ' + end + ' end';
      return <div
        key={edge.id}
        className={'kb-flow-marks' + (selected ? ' is-selected' : '')}
        data-connection-mark={edge.id}
        data-active={marked ? 'true' : undefined}
        onPointerEnter={() => handlers?.onHover(edge.id)}
        onPointerLeave={() => handlers?.onHoverEnd(edge.id)}
      >
        {start !== undefined && <div
          className="kb-flow-handle"
          data-end="source"
          data-x={start.x}
          data-y={start.y}
          role="button"
          tabIndex={0}
          aria-label={describe('source')}
          style={positionStyle(start, target, mark, scale)}
          onPointerDown={event => { if (operational) handlers?.onAnchorPointerDown(event, edge.id, 'source'); }}
          onKeyDown={event => handlers?.onAnchorKeyDown(event, edge.id, 'source')}
          onFocus={() => { if (selectOnFocus) handlers?.onSelect(edge.id); }}
          onBlur={() => handlers?.onAnchorBlur(edge.id, 'source')}
        ><span className="kb-flow-handle-dot" aria-hidden="true" /></div>}
        {edge.lines.map(line => <div
          key={'grip-' + line.index}
          className="kb-flow-grip"
          data-line={line.index}
          data-axis={line.axis}
          data-x={line.midpoint.x}
          data-y={line.midpoint.y}
          aria-hidden="true"
          style={positionStyle(line.midpoint, target, grip, scale)}
          onPointerDown={event => { if (operational) handlers?.onSegmentPointerDown(event, edge.id, line.index); }}
        ><span className="kb-flow-grip-dot" aria-hidden="true" /></div>)}
        {tip !== undefined && <div
          className="kb-flow-handle"
          data-end="target"
          data-x={tip.x}
          data-y={tip.y}
          role="button"
          tabIndex={0}
          aria-label={describe('target')}
          style={positionStyle(tip, target, mark, scale)}
          onPointerDown={event => { if (operational) handlers?.onAnchorPointerDown(event, edge.id, 'target'); }}
          onKeyDown={event => handlers?.onAnchorKeyDown(event, edge.id, 'target')}
          onFocus={() => { if (selectOnFocus) handlers?.onSelect(edge.id); }}
          onBlur={() => handlers?.onAnchorBlur(edge.id, 'target')}
        ><span className="kb-flow-handle-dot" aria-hidden="true" /></div>}
      </div>;
    })}
    {creation !== null && <CreationAffordance creation={creation} scale={scale} />}
  </div>;
}
