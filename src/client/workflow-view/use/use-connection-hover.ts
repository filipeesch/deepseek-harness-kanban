import { useCallback, useEffect, useRef, useState } from 'react';
import { AFFORDANCE } from '../affordance-geometry.js';
import { hoverReduce, NO_HOVER, type HoverEvent, type HoverState } from '../affordance-hover.js';

/** Which connection the diagram presents as pointed at, with a linger on leaving it. */
export interface ConnectionHover {
  readonly hoveredId: string | null;
  /** The pointer entered a connection's line or one of its marks. */
  enter(connectionId: string): void;
  /** The pointer left a connection's line or one of its marks. */
  leave(connectionId: string): void;
  clear(): void;
}

/**
 * One hovered connection at a time. A pointer that moves from a line to a mark of
 * the same connection crosses a DOM boundary, so the clear is delayed by the
 * affordance linger and an entering mark cancels it.
 */
export function useConnectionHover(): ConnectionHover {
  const [state, setState] = useState<HoverState>(NO_HOVER);
  const stateRef = useRef(state); stateRef.current = state;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => () => cancelTimer(), [cancelTimer]);

  const apply = useCallback((event: HoverEvent) => {
    const next = hoverReduce(stateRef.current, event);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const enter = useCallback((connectionId: string) => {
    cancelTimer();
    apply({ kind: 'enter', id: connectionId });
  }, [apply, cancelTimer]);

  const leave = useCallback((connectionId: string) => {
    apply({ kind: 'leave', id: connectionId });
    if (stateRef.current.pending !== connectionId) return;
    cancelTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      apply({ kind: 'settle', id: connectionId });
    }, AFFORDANCE.lingerMs);
  }, [apply, cancelTimer]);

  const clear = useCallback(() => {
    cancelTimer();
    apply({ kind: 'clear' });
  }, [apply, cancelTimer]);

  return { hoveredId: state.id, enter, leave, clear };
}
