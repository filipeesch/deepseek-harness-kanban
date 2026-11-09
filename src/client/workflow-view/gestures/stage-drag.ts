import type { StagePosition } from '../../../shared/types.js';
import { samePosition } from '../../../domain/stage-position.js';
import type { SnapPolicy } from './grid-snap.js';

/** How far the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;

export interface PointerPosition { readonly pointerId: number; readonly clientX: number; readonly clientY: number; /** Present on a real pointer event; the bypass modifier for this move. */ readonly altKey?: boolean }

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
  /** The lattice this gesture settles on; absent keeps the pointer's position. */
  readonly snap?: SnapPolicy;
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
  // The bypass is engaged when the press carries the modifier and stays engaged
  // for the rest of the gesture, so releasing the key never snaps the stage back
  // under the pointer mid-drag.
  let free = input.start.altKey === true;
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
    // The workflow stores whole diagram units, so the guard compares what would be
    // persisted with the position the gesture started from. A gesture that settles
    // there is not a layout edit: it must not reach the history or the save.
    const settled = { x: Math.round(position.x), y: Math.round(position.y) };
    if (commit && active && !samePosition(settled, input.origin)) input.onCommit(input.stageId, settled);
    else input.onCancel();
  };

  const move = (event: PointerPosition) => {
    if (disposed || event.pointerId !== input.start.pointerId) return;
    // Sample the bypass before the threshold: the modifier can be pressed and
    // released inside the first few pixels of a drag.
    if (event.altKey === true) free = true;
    if (!active) {
      if (!movedPastThreshold(input.start, event)) return;
      active = true;
    }
    const raw = draggedPosition(input.origin, input.start, event, input.zoom());
    position = free || input.snap === undefined ? raw : input.snap.position(raw);
    input.onMove(input.stageId, position);
  };
  const up = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(true); };
  const cancel = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(false); };

  input.events.addEventListener('pointermove', move);
  input.events.addEventListener('pointerup', up);
  input.events.addEventListener('pointercancel', cancel);
  return { dispose: () => finish(false) };
}
