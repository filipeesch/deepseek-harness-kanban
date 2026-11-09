import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import type { StageSize } from '../../shared/types.js';
import { useCardEnvironment } from './card-environment.js';
import { beginStageResize } from './gestures/stage-resize.js';
import type { GestureHandle, PointerEventsPort } from './gestures/stage-drag.js';

export type StageNodeModel = {
  readonly id: string;
  readonly label: string;
  readonly cardIds: readonly string[];
  /** The minimum width the stage renders at. */
  readonly width: number;
  /** The minimum height the stage renders at; it still grows with its cards. */
  readonly height: number;
  readonly locked: boolean;
};

export interface StageCallbacks {
  onMeasure(stageId: string, size: StageSize): void;
  /** Added by the canvas, which owns stage dragging; the view does not provide it. */
  onStagePointerDown?(event: React.PointerEvent<HTMLElement>, stageId: string): void;
  onStageResize?(stageId: string, size: StageSize): void;
  onStageResizeEnd?(stageId: string, size: StageSize): void;
  onStageResizeCancel?(stageId: string): void;
}

/** Shared by every stage node so node data stays serializable and stable. */
export const StageCallbacksContext = createContext<StageCallbacks | null>(null);

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
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY },
      origin,
      authored: { width: data.width, height: data.height },
      zoom: () => zoom,
      events: document as unknown as PointerEventsPort,
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
    <header className="kb-column-header kb-flow-stage-header nopan" data-locked={data.locked ? 'true' : undefined} onPointerDown={event => callbacks?.onStagePointerDown?.(event, id)}>
      <h2>{data.label}</h2>
      <span aria-label={data.cardIds.length + ' cards'}>{data.cardIds.length}</span>
    </header>
    <div className="kb-card-list">
      {data.cardIds.map(cardId => <div key={cardId} className="kb-flow-card-slot nodrag nopan">{environment?.renderCard(cardId) ?? null}</div>)}
      {data.cardIds.length === 0 && <p className="kb-empty-column">No matching tasks</p>}
      {drop && drag.indicatorY !== null && <div className="kb-drop-indicator" style={{ top: drag.indicatorY / (zoom === 0 ? 1 : zoom) }} aria-hidden="true" />}
    </div>
    {/* Position anchors for the drawn connections; they are not interactive. */}
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
    {!data.locked && <div className="kb-flow-resize nodrag nopan" role="separator" aria-label={'Resize ' + data.label + ' stage'} onPointerDown={startResize} />}
  </section>;
}
