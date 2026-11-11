import { useCallback, useRef, useState } from 'react';
import { emptyHistory, pushStep, type PlacementHistory, type PlacementStep } from '../history.js';

export interface PlacementHistoryState {
  readonly history: PlacementHistory;
  readonly historyRef: React.MutableRefObject<PlacementHistory>;
  push(step: PlacementStep): void;
  replace(history: PlacementHistory): void;
  /** Remove one step by identity, used when that step's write was rejected. */
  dropStep(step: PlacementStep): void;
  reset(): void;
}

/** The in-memory undo and redo stack for stage placement and size. */
export function usePlacementHistory(): PlacementHistoryState {
  const [history, setHistory] = useState<PlacementHistory>(emptyHistory);
  const historyRef = useRef(history);
  historyRef.current = history;
  const push = useCallback((step: PlacementStep) => setHistory(current => pushStep(current, step)), []);
  const replace = useCallback((next: PlacementHistory) => setHistory(next), []);
  const dropStep = useCallback((step: PlacementStep) => setHistory(current => {
    const index = current.entries.lastIndexOf(step);
    if (index < 0) return current;
    return { entries: current.entries.filter((_, position) => position !== index), cursor: index < current.cursor ? current.cursor - 1 : current.cursor };
  }), []);
  const reset = useCallback(() => setHistory(emptyHistory()), []);
  return { history, historyRef, push, replace, dropStep, reset };
}
