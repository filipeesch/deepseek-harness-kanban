import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import type { StageSide, StageSize } from '../../shared/types.js';
import { EMPTY_STAGE_COPY } from '../board-copy.js';
import { StageHeader as SharedStageHeader } from '../stage/stage-header.js';
import { useCardEnvironment } from './card-environment.js';
import { beginStageResize } from './gestures/stage-resize.js';
import type { GestureHandle, PointerEventsPort } from './gestures/stage-drag.js';
import type { SnapPolicy } from './gestures/grid-snap.js';

/** The sides a connection can be drawn from, in the order the ports are presented. */
export const CONNECTION_SIDES: readonly StageSide[] = ['top', 'right', 'bottom', 'left'];

export type StageNodeModel = {
  readonly id: string;
  readonly label: string;
  readonly cardIds: readonly string[];
  /** The minimum width the stage renders at. */
  readonly width: number;
  /** The minimum height the stage renders at; it still grows with its cards. */
  readonly height: number;
  readonly locked: boolean;
  /** True for the stage the board creates tasks in: the workflow's configured initial stage. */
  readonly creatable: boolean;
};

export interface StageCallbacks {
  onMeasure(stageId: string, size: StageSize): void;
  /** Added by the canvas, which owns stage dragging; the view does not provide it. */
  onStagePointerDown?(event: React.PointerEvent<HTMLElement>, stageId: string): void;
  /** The lattice the resize gesture settles on; the canvas supplies it. */
  readonly snap?: SnapPolicy;
  onStageResize?(stageId: string, size: StageSize): void;
  onStageResizeEnd?(stageId: string, size: StageSize): void;
  onStageResizeCancel?(stageId: string): void;
  /**
   * Opens the board's New task experience, supplied by the view from the board's
   * single creation instance. It takes no stage: the action appears on the initial
   * stage alone, so the press carries no target choice, and the board decides where a
   * task is created. Absent when no registered project can own a task, which is what
   * leaves the action presented but unavailable. It is a creation action, not a
   * layout edit, so it stays available while the layout is locked.
   */
  onCreateTask?(): void;
  /** Opens the board's stage editor; the board owns that dialog. */
  onEditStage?(stageId: string): void;
  /**
   * Starts drawing a new connection from one side of this stage. Present while the
   * layout is unlocked; the ports are a pointer affordance and stay out of the keyboard
   * order, because adding a destination by keyboard happens in the stage editor.
   */
  onBeginConnect?(event: React.PointerEvent<HTMLElement>, stageId: string, side: StageSide): void;
}

/** Shared by every stage node so node data stays serializable and stable. */
export const StageCallbacksContext = createContext<StageCallbacks | null>(null);

export interface StageHeaderProps {
  readonly id: string;
  readonly label: string;
  readonly cardCount: number;
  readonly locked: boolean;
  /** True for the stage the board creates tasks in; the action appears only there. */
  readonly creatable: boolean;
  /** The board's creation action, absent when no registered project can own a task. */
  readonly onCreateTask?: () => void;
  /** The board's stage editor, absent when the board offers no editing. */
  readonly onEditStage?: () => void;
  /** The canvas's stage-drag start; a harness without dragging leaves it out. */
  readonly onPointerDown?: (event: React.PointerEvent<HTMLElement>, stageId: string) => void;
}

/**
 * The diagram's adapter over the shared stage header: it adds this presentation's
 * classes and turns the drag start into a stage-specific callback.
 */
export function StageHeader({ id, label, cardCount, locked, creatable, onCreateTask, onEditStage, onPointerDown }: StageHeaderProps) {
  return <SharedStageHeader
    label={label}
    cardCount={cardCount}
    className="kb-flow-stage-header nopan"
    locked={locked}
    creatable={creatable}
    {...(onCreateTask === undefined ? {} : { onCreateTask })}
    {...(locked || onEditStage === undefined ? {} : { onEditStage })}
    {...(onPointerDown === undefined ? {} : { onPointerDown: event => onPointerDown(event, id) })}
  />;
}

/** The stage under the card drag and the stage a connection gesture would land on. */
export interface StageDragState { readonly stageId: string | null; readonly indicatorY: number | null; readonly candidateStageId: string | null }
export const StageDragContext = createContext<StageDragState>({ stageId: null, indicatorY: null, candidateStageId: null });

export function StageNodeView({ id, data }: { id: string; data: StageNodeModel }) {
  const callbacks = useContext(StageCallbacksContext);
  const environment = useCardEnvironment();
  const drag = useContext(StageDragContext);
  const zoom = useStore(state => state.transform[2]);
  const drop = drag.stageId === id;
  const candidate = drag.candidateStageId === id;
  const root = useRef<HTMLDivElement>(null);
  const resizing = useRef<GestureHandle | null>(null);

  useEffect(() => {
    const element = root.current;
    if (element === null || callbacks === null) return;
    const report = () => callbacks.onMeasure(id, { width: element.offsetWidth, height: element.offsetHeight });
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, callbacks]);

  useEffect(() => () => { resizing.current?.dispose(); }, []);

  function startResize(event: React.PointerEvent<HTMLElement>) {
    if (data.locked || resizing.current !== null || event.button !== 0) return;
    const element = root.current;
    if (element === null) return;
    event.preventDefault();
    event.stopPropagation();
    // The pointer starts on the rendered rectangle; the gesture decides per axis
    // whether to grow from it or to edit the authored minimum.
    const origin = { width: element.offsetWidth, height: element.offsetHeight };
    resizing.current = beginStageResize({
      stageId: id,
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, altKey: event.altKey },
      origin,
      authored: { width: data.width, height: data.height },
      zoom: () => zoom,
      events: document as unknown as PointerEventsPort,
      snap: callbacks?.snap,
      onResize: (stageId, size) => callbacks?.onStageResize?.(stageId, size),
      onCommit: (stageId, size) => { resizing.current = null; callbacks?.onStageResizeEnd?.(stageId, size); },
      onCancel: () => { resizing.current = null; callbacks?.onStageResizeCancel?.(id); },
    });
  }

  return <section
    ref={root}
    className="kb-flow-stage nopan"
    style={{ width: data.width, minHeight: data.height }}
    aria-label={data.label + ' stage'}
    data-column-id={id}
    data-drop={drop ? 'true' : undefined}
    data-connect-candidate={candidate ? 'true' : undefined}
  >
    <StageHeader
      id={id}
      label={data.label}
      cardCount={data.cardIds.length}
      locked={data.locked}
      creatable={data.creatable}
      onCreateTask={callbacks?.onCreateTask}
      {...(callbacks?.onEditStage === undefined ? {} : { onEditStage: () => callbacks.onEditStage!(id) })}
      onPointerDown={(event, stageId) => callbacks?.onStagePointerDown?.(event, stageId)}
    />
    <div className="kb-card-list">
      {data.cardIds.map(cardId => <div key={cardId} className="kb-flow-card-slot nodrag nopan">{environment?.renderCard(cardId) ?? null}</div>)}
      {data.cardIds.length === 0 && <p className="kb-empty-column">{EMPTY_STAGE_COPY}</p>}
      {drop && drag.indicatorY !== null && <div className="kb-drop-indicator" style={{ top: drag.indicatorY / (zoom === 0 ? 1 : zoom) }} aria-hidden="true" />}
    </div>
    {/* One port per side, so a connection can be drawn from wherever it should leave. */}
    {!data.locked && callbacks?.onBeginConnect !== undefined && CONNECTION_SIDES.map(side => <div
      key={side}
      className="kb-flow-port nodrag nopan"
      data-side={side}
      aria-hidden="true"
      title={'Draw a connection from the ' + side + ' side'}
      onPointerDown={event => callbacks?.onBeginConnect?.(event, id, side)}
    />)}
    {/* Position anchors for the drawn connections; they are not interactive. */}
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
    {!data.locked && <div className="kb-flow-resize nodrag nopan" role="separator" aria-label={'Resize ' + data.label + ' stage'} onPointerDown={startResize} />}
  </section>;
}
