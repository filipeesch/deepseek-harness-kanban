import type { StageSize } from '../../../shared/types.js';
import { clampStageSize } from '../../../domain/stage-size.js';
import { noSnap, type SnapPolicy } from './grid-snap.js';
import { draggedPosition, type GestureHandle, type PointerEventsPort, type PointerPosition } from './stage-drag.js';

export interface StageResizeInput {
  readonly stageId: string;
  readonly start: PointerPosition;
  /** The rectangle under the pointer, so an outward drag follows the visible corner. */
  readonly origin: StageSize;
  /** The authored minimum: an inward drag edits this, and an unchanged axis keeps it. */
  readonly authored: StageSize;
  readonly zoom: () => number;
  readonly events: PointerEventsPort;
  /** The lattice this gesture settles on; absent keeps the pointer's size. */
  readonly snap?: SnapPolicy;
  readonly onResize: (stageId: string, size: StageSize) => void;
  readonly onCommit: (stageId: string, size: StageSize) => void;
  readonly onCancel: () => void;
}

/**
 * One stage-corner resize. An outward drag grows from the rectangle under the
 * pointer, so a content-tall stage follows the handle; an inward drag edits the
 * authored minimum, so a stage never records its content-grown height as a new
 * floor. The settled size is snapped before it is clamped, so an accepted size is
 * always a lattice point. A press that changes nothing cancels instead of
 * committing.
 */
export function beginStageResize(input: StageResizeInput): GestureHandle {
  let disposed = false;
  let moved = false;
  // The bypass is engaged when the press carries the modifier and stays engaged
  // for the rest of the gesture, so releasing the key never snaps the size back
  // mid-drag.
  let free = input.start.altKey === true;

  /** The size a raw measurement settles on under the gesture's active policy. */
  const settle = (value: StageSize, bypass: boolean): StageSize => {
    const policy = bypass ? noSnap : input.snap ?? noSnap;
    return clampStageSize(policy.size(value));
  };

  // The size the gesture started from, clamped but never snapped: a gesture that
  // settles on it stores nothing, and one that settles anywhere else is a real
  // edit even when the authored size is not on the lattice.
  const floor = clampStageSize(input.authored);
  let size: StageSize = floor;

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
    if (commit && moved) input.onCommit(input.stageId, size);
    else input.onCancel();
  };

  /** The measured size under the gesture's active policy. */
  const measure = (event: PointerPosition): StageSize => {
    const delta = draggedPosition({ x: 0, y: 0 }, input.start, event, input.zoom());
    const width = (delta.x > 0 ? input.origin.width : input.authored.width) + delta.x;
    const height = (delta.y > 0 ? input.origin.height : input.authored.height) + delta.y;
    return settle({ width, height }, free);
  };

  const move = (event: PointerPosition) => {
    if (disposed || event.pointerId !== input.start.pointerId) return;
    if (event.altKey === true) free = true;
    const next = measure(event);
    size = next;
    // Changing the minimum is what a resize means; a press that settles on the
    // size the gesture started from stays a click.
    moved = next.width !== floor.width || next.height !== floor.height;
    input.onResize(input.stageId, size);
  };
  const up = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(true); };
  const cancel = (event: PointerPosition) => { if (event.pointerId === input.start.pointerId) finish(false); };

  input.events.addEventListener('pointermove', move);
  input.events.addEventListener('pointerup', up);
  input.events.addEventListener('pointercancel', cancel);
  return { dispose: () => finish(false) };
}
