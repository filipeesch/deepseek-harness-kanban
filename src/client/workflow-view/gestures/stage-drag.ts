import type { StagePosition } from '../../../shared/types.js';

/** How far the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;

export interface PointerPosition { readonly pointerId: number; readonly clientX: number; readonly clientY: number }

/** The document-level listener surface a gesture needs; injectable so it can be tested. */
export interface PointerEventsPort {
  addEventListener(type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (event: PointerPosition) => void): void;
  removeEventListener(type: 'pointermove' | 'pointerup' | 'pointercancel', listener: (event: PointerPosition) => void): void;
}

/** One live gesture. Disposing it always releases the owner's guard. */
export interface GestureHandle { dispose(): void }

/** Where the dragged point is in flow coordinates, corrected for the current zoom. */
export function draggedPosition(origin: StagePosition, start: PointerPosition, current: PointerPosition, zoom: number): StagePosition {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return { x: origin.x + (current.clientX - start.clientX) / scale, y: origin.y + (current.clientY - start.clientY) / scale };
}

export function movedPastThreshold(start: PointerPosition, current: PointerPosition, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(current.clientX - start.clientX, current.clientY - start.clientY) >= threshold;
}

export interface StageDragInput {
  readonly stageId: string;
  readonly start: PointerPosition;
  readonly origin: StagePosition;
  readonly zoom: () => number;
  readonly events: PointerEventsPort;
  readonly onMove: (stageId: string, position: StagePosition) => void;
  readonly onCommit: (stageId: string, position: StagePosition) => void;
  readonly onCancel: () => void;
}

/**
 * One stage-header drag. A press that never passes the threshold is a click; a
 * completed gesture commits exactly once; disposing releases the gesture by
 * cancelling it. The owner keeps its guard from the returned handle, so a
 * finished drag can never block the next one.
 */
export function beginStageDrag(input: StageDragInput): GestureHandle {
  let active = false;
  let disposed = false;
  let position: StagePosition = input.origin;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    input.events.removeEventListener('pointermove', move);
    input.events.removeEventListener('pointerup', up);
    input.events.removeEventListener('pointercancel', cancel);
  };

  const finish = (commit: boolean) => {
    if (disposed) return;
    cleanup();
    if (commit && active) input.onCommit(input.stageId, position);
    else input.onCancel();
  };

  const move = (event: PointerPosition) => {
    if (disposed || event.pointerId !== input.start.pointerId) return;
    if (!active) {
      if (!movedPastThreshold(input.start, event)) return;
      active = true;
    }
    position = draggedPosition(input.origin, input.start, event, input.zoom());
    input.onMove(input.stageId, position);
  };
  const up = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(true); };
  const cancel = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(false); };

  input.events.addEventListener('pointermove', move);
  input.events.addEventListener('pointerup', up);
  input.events.addEventListener('pointercancel', cancel);
  return { dispose: () => finish(false) };
}
