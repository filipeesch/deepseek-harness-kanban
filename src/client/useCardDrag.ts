import { useCallback, useEffect, useRef, useState } from 'react';
import { boardDropResolver, type CardDropResolver } from './card-drop.js';

export interface CardDragState {
  taskId: string;
  sourceColumnId: string;
  overColumnId: string;
  overColumnName: string;
  indicatorY: number;
  beforeTaskId: string | null;
}

export interface CardDragOptions {
  enabled: boolean;
  canDrop: (columnId: string, taskId: string) => boolean;
  onDrop: (taskId: string, columnId: string, beforeTaskId: string | null) => void;
  /** Injected so the same gesture serves the board and the diagram. */
  resolver?: CardDropResolver;
}

interface PointerDrag {
  taskId: string;
  sourceColumnId: string;
  source: HTMLElement;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
  ghost: HTMLElement | null;
}

/** Pointer-driven card dragging with a cloned ghost and an insertion indicator. */
export function useCardDrag(options: CardDragOptions) {
  const [drag, setDrag] = useState<CardDragState | null>(null);
  const current = useRef<PointerDrag | null>(null);
  const pendingDrop = useRef<{ columnId: string; beforeTaskId: string | null } | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const fallbackResolver = useRef<CardDropResolver | null>(null);
  const suppressClickUntil = useRef(0);

  const resolver = (): CardDropResolver => {
    const injected = optionsRef.current.resolver;
    if (injected !== undefined) return injected;
    if (fallbackResolver.current === null) fallbackResolver.current = boardDropResolver();
    return fallbackResolver.current;
  };

  const cleanup = useCallback(() => {
    const active = current.current as (PointerDrag & { removeListeners?: () => void }) | null;
    current.current = null;
    if (active) {
      active.removeListeners?.();
      if (active.ghost?.parentNode) active.ghost.parentNode.removeChild(active.ghost);
      active.source.style.opacity = '';
    }
    document.body.style.userSelect = '';
    document.documentElement.style.userSelect = '';
    setDrag(null);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const begin = useCallback((event: React.PointerEvent<HTMLElement>, taskId: string, sourceColumnId: string) => {
    if (!optionsRef.current.enabled || event.button !== 0 || current.current) return;
    const source = event.currentTarget;
    const rect = source.getBoundingClientRect();
    const dragState: PointerDrag = {
      taskId, sourceColumnId, source,
      startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      active: false, ghost: null,
    };
    current.current = dragState;
    pendingDrop.current = null;
    document.body.style.userSelect = 'none';
    document.documentElement.style.userSelect = 'none';

    const move = (moveEvent: PointerEvent) => {
      if (current.current !== dragState) return;
      const dx = moveEvent.clientX - dragState.startX;
      const dy = moveEvent.clientY - dragState.startY;
      if (!dragState.active) {
        if (Math.hypot(dx, dy) < 5) return;
        dragState.active = true;
        try { dragState.source.setPointerCapture(moveEvent.pointerId); } catch { /* pointer capture is best effort */ }
        const sourceRect = dragState.source.getBoundingClientRect();
        // The preview stays inside the plugin root so the board's scoped card styles
        // and theme tokens apply to it; fixed positioning keeps it out of the layout.
        const layer = dragState.source.closest('.dsh-kanban');
        if (layer !== null) {
          const ghost = dragState.source.cloneNode(true) as HTMLElement;
          ghost.classList.add('kb-drag-ghost');
          ghost.classList.remove('kb-card-gliding');
          ghost.style.width = sourceRect.width + 'px';
          ghost.style.left = (event.clientX - dragState.offsetX) + 'px';
          ghost.style.top = (event.clientY - dragState.offsetY) + 'px';
          layer.appendChild(ghost);
          dragState.ghost = ghost;
          dragState.source.style.opacity = '0';
        }
      }
      if (dragState.ghost) {
        dragState.ghost.style.left = (moveEvent.clientX - dragState.offsetX) + 'px';
        dragState.ghost.style.top = (moveEvent.clientY - dragState.offsetY) + 'px';
        dragState.ghost.style.display = 'none';
      }
      const point = { x: moveEvent.clientX, y: moveEvent.clientY };
      const target = resolver().resolve(point, dragState.taskId);
      if (dragState.ghost) dragState.ghost.style.display = '';
      if (!target || !optionsRef.current.canDrop(target.columnId, dragState.taskId)) { pendingDrop.current = null; setDrag(null); return; }
      pendingDrop.current = { columnId: target.columnId, beforeTaskId: target.beforeTaskId };
      setDrag({
        taskId: dragState.taskId, sourceColumnId: dragState.sourceColumnId,
        overColumnId: target.columnId, overColumnName: target.columnName,
        indicatorY: target.indicatorY, beforeTaskId: target.beforeTaskId,
      });
      resolver().autoScroll?.(point);
    };

    const finish = (drop: boolean) => {
      if (current.current !== dragState) return;
      const active = dragState.active;
      const target = drop ? pendingDrop.current : null;
      pendingDrop.current = null;
      cleanup();
      if (!active) return;
      suppressClickUntil.current = Date.now() + 200;
      if (target) optionsRef.current.onDrop(dragState.taskId, target.columnId, target.beforeTaskId);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    const cleanupListeners = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      if (dragState.ghost?.parentNode) dragState.ghost.parentNode.removeChild(dragState.ghost);
      dragState.ghost = null;
      dragState.source.style.opacity = '';
    };
    (dragState as PointerDrag & { removeListeners?: () => void }).removeListeners = cleanupListeners;
  }, [cleanup]);

  // Ensure a component unmount removes listeners even when no pointerup arrives.
  useEffect(() => () => {
    const active = current.current as (PointerDrag & { removeListeners?: () => void }) | null;
    active?.removeListeners?.();
  }, []);

  const shouldSuppressClick = useCallback(() => Date.now() < suppressClickUntil.current, []);

  return { drag, begin, shouldSuppressClick };
}
