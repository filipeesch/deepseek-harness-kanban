import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import type { StageSize } from '../../shared/types.js';
import { PlusIcon } from '../icons.js';
import { EMPTY_STAGE_COPY } from '../stage-empty.js';
import { useCardEnvironment } from './card-environment.js';
import { beginStageResize } from './gestures/stage-resize.js';
import type { GestureHandle, PointerEventsPort } from './gestures/stage-drag.js';
import type { SnapPolicy } from './gestures/grid-snap.js';

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
  /** The canvas's stage-drag start; a harness without dragging leaves it out. */
  readonly onPointerDown?: (event: React.PointerEvent<HTMLElement>, stageId: string) => void;
}

/**
 * A stage's title, its creation action, and its card count.
 *
 * Exported so a harness renders this markup instead of imitating it: the creation
 * action only earns trust when the markup under test is the markup the canvas
 * paints. The pointer gesture is stopped here on purpose — the header is the stage's
 * drag handle, and pressing the action must never pick the stage up.
 */
export function StageHeader({ id, label, cardCount, locked, creatable, onCreateTask, onPointerDown }: StageHeaderProps) {
  return <header className="kb-column-header kb-flow-stage-header nopan" data-locked={locked ? 'true' : undefined} onPointerDown={event => onPointerDown?.(event, id)}>
    <h2>{label}</h2>
    {/* One group, so presenting the action never shifts the title or the card count. */}
    <div className="kb-flow-stage-actions">
      {creatable && <button
        type="button"
        className="kb-button kb-icon-button kb-flow-stage-create nodrag nopan"
        disabled={onCreateTask === undefined}
        aria-label="New task"
        title="New task"
        onPointerDown={event => { event.stopPropagation(); }}
        onClick={event => { event.stopPropagation(); onCreateTask?.(); }}
      ><PlusIcon size={14} /></button>}
      <span aria-label={cardCount + ' cards'}>{cardCount}</span>
    </div>
  </header>;
}

/** The stage under the card drag; a separate context so dragging never re-syncs nodes. */
export interface StageDragState { readonly stageId: string | null; readonly indicatorY: number | null }
export const StageDragContext = createContext<StageDragState>({ stageId: null, indicatorY: null });

export function StageNodeView({ id, data }: { id: string; data: StageNodeModel }) {
  const callbacks = useContext(StageCallbacksContext);
  const environment = useCardEnvironment();
  const drag = useContext(StageDragContext);
  const zoom = useStore(state => state.transform[2]);
  const drop = drag.stageId === id;
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
  >
    <StageHeader
      id={id}
      label={data.label}
      cardCount={data.cardIds.length}
      locked={data.locked}
      creatable={data.creatable}
      onCreateTask={callbacks?.onCreateTask}
      onPointerDown={(event, stageId) => callbacks?.onStagePointerDown?.(event, stageId)}
    />
    <div className="kb-card-list">
      {data.cardIds.map(cardId => <div key={cardId} className="kb-flow-card-slot nodrag nopan">{environment?.renderCard(cardId) ?? null}</div>)}
      {data.cardIds.length === 0 && <p className="kb-empty-column">{EMPTY_STAGE_COPY}</p>}
      {drop && drag.indicatorY !== null && <div className="kb-drop-indicator" style={{ top: drag.indicatorY / (zoom === 0 ? 1 : zoom) }} aria-hidden="true" />}
    </div>
    {/* Position anchors for the drawn connections; they are not interactive. */}
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
    {!data.locked && <div className="kb-flow-resize nodrag nopan" role="separator" aria-label={'Resize ' + data.label + ' stage'} onPointerDown={startResize} />}
  </section>;
}
