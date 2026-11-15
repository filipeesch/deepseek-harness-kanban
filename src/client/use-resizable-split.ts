/**
 * Pointer and keyboard behaviour shared by the drawer's edge and the workspace
 * divider: both size a right-docked panel from its left edge, so both listen,
 * clamp, capture the pointer, and commit the same way.
 */
import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

/** What one resizable edge needs from its owner. */
export interface ResizableEdgeOptions {
  /** Current width of the panel being sized. */
  readonly current: () => number;
  /** Apply a new width; the owner clamps and stores it. */
  readonly apply: (next: number) => void;
  /** Clamp a requested width into the owner's bounds. */
  readonly clamp: (next: number) => number;
  /** Width a double click or Home restores. */
  readonly reset: number;
  /** Persist the width a gesture ended on. */
  readonly commit: (width: number) => void;
  /** Keyboard step in pixels; defaults to 16. */
  readonly step?: number;
}

/** The handlers a separator element binds. */
export interface ResizableEdgeHandlers {
  onPointerDown(event: React.PointerEvent<HTMLElement>): void;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  onDoubleClick(event: React.MouseEvent<HTMLElement>): void;
}

/**
 * Bind one right-docked panel's edge to pointer and keyboard gestures.
 *
 * Dragging left widens the panel, ArrowLeft widens it by one step, ArrowRight
 * narrows it, and Home restores the owner's default. The pointer is captured so
 * a drag keeps resizing outside the handle; a cancelled pointer reverts the
 * gesture, and unmounting removes every listener.
 * @param options - current width, clamping, default, and commit.
 * @returns the handlers the separator element uses.
 */
export function useResizableEdge(options: ResizableEdgeOptions): ResizableEdgeHandlers {
  const latest = useRef(options);
  latest.current = options;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    cleanup.current?.();
    cleanup.current = null;
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    // A new gesture supersedes any unfinished one.
    cleanup.current?.();
    const target = event.currentTarget;
    try {
      if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId);
    } catch { /* pointer capture is optional */ }
    const startX = event.clientX;
    const start = latest.current.clamp(latest.current.current());
    let width = start;
    const move = (moveEvent: PointerEvent): void => {
      width = latest.current.clamp(start + (startX - moveEvent.clientX));
      latest.current.apply(width);
    };
    const remove = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      cleanup.current = null;
    };
    const up = (): void => {
      remove();
      latest.current.commit(width);
    };
    const cancel = (): void => {
      remove();
      // A cancelled gesture leaves the panel where it started, not where the
      // last partial move landed, and persists nothing.
      latest.current.apply(start);
    };
    cleanup.current = remove;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const step = latest.current.step ?? 16;
    let requested: number | undefined;
    if (event.key === 'ArrowLeft') requested = latest.current.current() + step;
    else if (event.key === 'ArrowRight') requested = latest.current.current() - step;
    else if (event.key === 'Home') requested = latest.current.reset;
    if (requested === undefined) return;
    event.preventDefault();
    const width = latest.current.clamp(requested);
    latest.current.apply(width);
    latest.current.commit(width);
  }, []);

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const width = latest.current.clamp(latest.current.reset);
    latest.current.apply(width);
    latest.current.commit(width);
  }, []);

  return { onPointerDown, onKeyDown, onDoubleClick };
}
