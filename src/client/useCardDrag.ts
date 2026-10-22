import { useCallback, useEffect, useRef, useState } from 'react';

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
  const suppressClickUntil = useRef(0);

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
    event.preventDefault();
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
    try { source.setPointerCapture(event.pointerId); } catch { /* pointer capture is best effort */ }

    const move = (moveEvent: PointerEvent) => {
      if (current.current !== dragState) return;
      const dx = moveEvent.clientX - dragState.startX;
      const dy = moveEvent.clientY - dragState.startY;
      if (!dragState.active) {
        if (Math.hypot(dx, dy) < 5) return;
        dragState.active = true;
        const sourceRect = dragState.source.getBoundingClientRect();
        const ghost = dragState.source.cloneNode(true) as HTMLElement;
        ghost.classList.add('kb-drag-ghost');
        ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;width:' + sourceRect.width + 'px;opacity:.9;box-shadow:0 8px 24px #0000002e;transform:rotate(1.5deg);';
        document.body.appendChild(ghost);
        dragState.ghost = ghost;
        dragState.source.style.opacity = '0';
      }
      if (dragState.ghost) {
        dragState.ghost.style.left = (moveEvent.clientX - dragState.offsetX) + 'px';
        dragState.ghost.style.top = (moveEvent.clientY - dragState.offsetY) + 'px';
        dragState.ghost.style.display = 'none';
      }
      const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (dragState.ghost) dragState.ghost.style.display = '';
      const column = hit?.closest<HTMLElement>('[data-column-id]');
      if (!column) { pendingDrop.current = null; setDrag(null); return; }
      const columnId = column.dataset.columnId ?? '';
      if (!columnId || !optionsRef.current.canDrop(columnId, dragState.taskId)) { pendingDrop.current = null; setDrag(null); return; }
      const list = column.querySelector<HTMLElement>('.kb-card-list');
      if (!list) { pendingDrop.current = null; setDrag(null); return; }
      const cards = Array.from(list.querySelectorAll<HTMLElement>('.kb-card')).filter(card => card.dataset.taskId !== dragState.taskId);
      let index = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const cardRect = cards[i]!.getBoundingClientRect();
        if (moveEvent.clientY < cardRect.top + cardRect.height / 2) { index = i; break; }
      }
      const listRect = list.getBoundingClientRect();
      let indicatorY = 4;
      if (cards.length > 0 && index === 0) indicatorY = cards[0]!.getBoundingClientRect().top - listRect.top - 1;
      else if (cards.length > 0 && index >= cards.length) indicatorY = cards[cards.length - 1]!.getBoundingClientRect().bottom - listRect.top + 1;
      else if (cards.length > 0) {
        const previous = cards[index - 1]!.getBoundingClientRect();
        const next = cards[index]!.getBoundingClientRect();
        indicatorY = (previous.bottom + next.top) / 2 - listRect.top;
      }
      const beforeTaskId = cards[index]?.dataset.taskId ?? null;
      pendingDrop.current = { columnId, beforeTaskId };
      setDrag({
        taskId: dragState.taskId, sourceColumnId: dragState.sourceColumnId,
        overColumnId: columnId, overColumnName: column.querySelector('.kb-column-header h2')?.textContent ?? columnId,
        indicatorY, beforeTaskId,
      });
      const board = document.querySelector<HTMLElement>('.kb-columns');
      if (board) {
        const boardRect = board.getBoundingClientRect();
        if (moveEvent.clientX < boardRect.left + 60) board.scrollLeft -= 12;
        else if (moveEvent.clientX > boardRect.right - 60) board.scrollLeft += 12;
      }
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
    // Store the listener cleanup on the drag instance; the outer cleanup calls it through the ghost/source fields.
    (dragState as PointerDrag & { removeListeners?: () => void }).removeListeners = cleanupListeners;
  }, [cleanup]);

  // Ensure a component unmount removes listeners even when no pointerup arrives.
  useEffect(() => () => {
    const active = current.current as (PointerDrag & { removeListeners?: () => void }) | null;
    active?.removeListeners?.();
  }, []);

  return { drag, begin, shouldSuppressClick: () => Date.now() < suppressClickUntil.current };
}
