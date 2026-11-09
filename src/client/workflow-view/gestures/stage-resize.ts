import type { StageSize } from '../../../shared/types.js';
import { clampStageSize } from '../../../domain/stage-size.js';
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
  readonly onResize: (stageId: string, size: StageSize) => void;
  readonly onCommit: (stageId: string, size: StageSize) => void;
  readonly onCancel: () => void;
}

/**
 * One stage-corner resize. An outward drag grows from the rectangle under the
 * pointer, so a content-tall stage follows the handle; an inward drag edits the
 * authored minimum, so a stage never records its content-grown height as a new
 * floor. A press that changes nothing cancels instead of committing.
 */
export function beginStageResize(input: StageResizeInput): GestureHandle {
  let disposed = false;
  let moved = false;
  let size: StageSize = clampStageSize(input.authored);

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

  const measure = (event: PointerPosition): StageSize => {
    const delta = draggedPosition({ x: 0, y: 0 }, input.start, event, input.zoom());
    const width = (delta.x > 0 ? input.origin.width : input.authored.width) + delta.x;
    const height = (delta.y > 0 ? input.origin.height : input.authored.height) + delta.y;
    return clampStageSize({ width, height });
  };

  const floor = clampStageSize(input.authored);
  const move = (event: PointerPosition) => {
    if (disposed || event.pointerId !== input.start.pointerId) return;
    const next = measure(event);
    size = next;
    // Changing the minimum is what a resize means; a clamped no-op stays a click.
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
