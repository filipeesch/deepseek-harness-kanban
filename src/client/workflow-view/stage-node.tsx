import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import type { StageSize } from './layout.js';

export interface FlowCard {
  readonly id: string;
  readonly title: string;
  readonly projectName: string;
  readonly running: boolean;
  readonly unread: boolean;
  readonly failed: boolean;
}

export type StageNodeModel = {
  readonly id: string;
  readonly label: string;
  readonly cards: readonly FlowCard[];
};

export interface StageCallbacks {
  onOpenCard(taskId: string): void;
  onCardPointerDown(event: React.PointerEvent<HTMLElement>, taskId: string, stageId: string): void;
  shouldSuppressClick(): boolean;
  onMeasure(stageId: string, size: StageSize): void;
  /** Added by the canvas, which owns stage dragging; the view does not provide it. */
  onStagePointerDown?(event: React.PointerEvent<HTMLElement>, stageId: string): void;
}

/** Shared by every stage node so node data stays serializable and stable. */
export const StageCallbacksContext = createContext<StageCallbacks | null>(null);

/** The stage under the card drag; a separate context so dragging never re-syncs nodes. */
export interface StageDragState { readonly stageId: string | null; readonly indicatorY: number | null }
export const StageDragContext = createContext<StageDragState>({ stageId: null, indicatorY: null });

export function StageNodeView({ id, data }: { id: string; data: StageNodeModel }) {
  const callbacks = useContext(StageCallbacksContext);
  const drag = useContext(StageDragContext);
  const zoom = useStore(state => state.transform[2]);
  const drop = drag.stageId === id;
  const root = useRef<HTMLDivElement>(null);

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

  return <section ref={root} className="kb-flow-stage nopan" aria-label={data.label + ' stage'} data-column-id={id} data-drop={drop ? 'true' : undefined}>
    <header className="kb-column-header kb-flow-stage-header nopan" onPointerDown={event => callbacks?.onStagePointerDown?.(event, id)}>
      <h2>{data.label}</h2>
      <span aria-label={data.cards.length + ' cards'}>{data.cards.length}</span>
    </header>
    <div className="kb-card-list">
      {data.cards.map(card => <button
        key={card.id}
        type="button"
        className="kb-card kb-flow-card nodrag nopan"
        data-task-id={card.id}
        onPointerDown={event => callbacks?.onCardPointerDown(event, card.id, id)}
        onClick={() => { if (callbacks?.shouldSuppressClick() === true) return; callbacks?.onOpenCard(card.id); }}
      >
        <span className="kb-flow-card-title">{card.title}</span>
        <span className="kb-flow-card-meta">
          {card.running && <span className="kb-dot kb-blue" aria-label="Running" />}
          {card.unread && <span className="kb-dot kb-blue" aria-label="Unread" />}
          {card.failed && <span className="kb-dot kb-red" aria-label="Failed" />}
          {card.projectName}
        </span>
      </button>)}
      {data.cards.length === 0 && <p className="kb-empty-column">No cards</p>}
      {drop && drag.indicatorY !== null && <div className="kb-drop-indicator" style={{ top: drag.indicatorY / (zoom === 0 ? 1 : zoom) }} aria-hidden="true" />}
    </div>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </section>;
}
