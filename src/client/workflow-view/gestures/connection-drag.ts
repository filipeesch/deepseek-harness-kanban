import { DRAG_THRESHOLD, movedPastThreshold, type GestureHandle, type PointerEventsPort, type PointerPosition } from './stage-drag.js';

/** The document-level keyboard surface a gesture needs; injectable so it can be tested. */
export interface KeyboardEventsPort {
  addEventListener(type: 'keydown', listener: (event: { readonly key: string }) => void): void;
  removeEventListener(type: 'keydown', listener: (event: { readonly key: string }) => void): void;
}

export interface ConnectionDragInput {
  readonly start: PointerPosition;
  readonly events: PointerEventsPort;
  /** Present when the gesture can be cancelled with Escape. */
  readonly keys?: KeyboardEventsPort;
  readonly onMove: (pointer: PointerPosition) => void;
  /** Called once, only when the pointer actually moved. */
  readonly onCommit: () => void;
  /** Called when the press never moved, or when it was cancelled. */
  readonly onCancel: () => void;
  readonly threshold?: number;
}

/**
 * One connection adjustment gesture. A press that never passes the threshold
 * commits nothing; a completed gesture commits exactly once; Escape and
 * pointercancel revert. The owner keeps its guard from the returned handle, so a
 * finished gesture can never block the next one.
 */
export function beginConnectionDrag(input: ConnectionDragInput): GestureHandle {
  let active = false;
  let disposed = false;
  const threshold = input.threshold ?? DRAG_THRESHOLD;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    input.events.removeEventListener('pointermove', move);
    input.events.removeEventListener('pointerup', up);
    input.events.removeEventListener('pointercancel', cancel);
    input.keys?.removeEventListener('keydown', key);
  };

  const finish = (commit: boolean) => {
    if (disposed) return;
    cleanup();
    if (commit && active) input.onCommit();
    else input.onCancel();
  };

  const move = (event: PointerPosition) => {
    if (disposed || event.pointerId !== input.start.pointerId) return;
    if (!active) {
      if (!movedPastThreshold(input.start, event, threshold)) return;
      active = true;
    }
    input.onMove(event);
  };
  const up = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(true); };
  const cancel = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(false); };
  const key = (event: { readonly key: string }) => { if (event.key === 'Escape') finish(false); };

  input.events.addEventListener('pointermove', move);
  input.events.addEventListener('pointerup', up);
  input.events.addEventListener('pointercancel', cancel);
  input.keys?.addEventListener('keydown', key);
  return { dispose: () => finish(false) };
}
