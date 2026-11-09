import { useCallback, useMemo, useState } from 'react';
import { readGridSnap, writeGridSnap } from '../../grid-preference.js';
import { gridSnapPolicy, noSnap, type SnapPolicy } from '../gestures/grid-snap.js';

export interface GridSnap {
  readonly enabled: boolean;
  /** The policy every layout gesture settles on. */
  readonly snap: SnapPolicy;
  toggle(): void;
}

/**
 * The diagram's snapping preference and the policy it resolves to. It starts on,
 * is remembered for this browser, and is a presentation choice only: nothing
 * about it reaches the board's workflow.
 */
export function useGridSnap(): GridSnap {
  const [enabled, setEnabled] = useState(readGridSnap);
  const toggle = useCallback(() => {
    setEnabled(current => {
      const next = !current;
      writeGridSnap(next);
      return next;
    });
  }, []);
  const snap = useMemo(() => (enabled ? gridSnapPolicy() : noSnap), [enabled]);
  return { enabled, snap, toggle };
}
