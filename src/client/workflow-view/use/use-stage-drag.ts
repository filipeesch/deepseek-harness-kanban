import { useCallback, useEffect, useRef } from 'react';
import type { StagePosition } from '../../../shared/types.js';
import { beginStageDrag, type GestureHandle, type PointerEventsPort } from '../gestures/stage-drag.js';
import type { SnapPolicy } from '../gestures/grid-snap.js';

/** What the stage-drag gesture needs from the canvas that owns the node positions. */
export interface StageDragPort {
  readonly locked: boolean;
  readonly zoom: () => number;
  readonly events: PointerEventsPort;
  readonly snap: SnapPolicy;
  /** The position the stage is shown at before this gesture starts. */
  positionOf(stageId: string): StagePosition | undefined;
  /** Show the stage at the position the gesture has reached. */
  preview(stageId: string, position: StagePosition): void;
  /** A completed drag, with the position it settled on. */
  commit(stageId: string, position: StagePosition): void;
}

export interface StageDrag {
  start(event: React.PointerEvent<HTMLElement>, stageId: string): void;
  /** True while a drag owns the node positions, so a props update must not replace them. */
  isDragging(): boolean;
}

/**
 * One stage-header drag at a time. The hook owns the gesture's guard, so a
 * finished drag can never block the next one. The zoom, the preview, and the
 * commit callback are read through a ref, so the running gesture always talks to
 * the current canvas; the lock and the snapping policy are sampled when the press
 * starts, because a gesture never changes them halfway.
 */
export function useStageDrag(port: StageDragPort): StageDrag {
  const portRef = useRef(port); portRef.current = port;
  const drag = useRef<GestureHandle | null>(null);

  useEffect(() => () => { drag.current?.dispose(); drag.current = null; }, []);

  const start = useCallback((event: React.PointerEvent<HTMLElement>, stageId: string) => {
    const current = portRef.current;
    if (current.locked || event.button !== 0 || drag.current !== null) return;
    const origin = current.positionOf(stageId);
    if (origin === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = beginStageDrag({
      stageId,
      start: { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, altKey: event.altKey },
      origin,
      zoom: () => portRef.current.zoom(),
      events: current.events,
      snap: current.snap,
      onMove: (id, position) => portRef.current.preview(id, position),
      onCommit: (id, position) => { drag.current = null; portRef.current.commit(id, position); },
      onCancel: () => { drag.current = null; portRef.current.preview(stageId, origin); },
    });
  }, []);

  const isDragging = useCallback(() => drag.current !== null, []);
  return { start, isDragging };
}
