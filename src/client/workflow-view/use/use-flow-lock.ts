import { useCallback, useState } from 'react';

export interface FlowLock {
  readonly locked: boolean;
  toggle(): void;
}

/**
 * The diagram's layout lock. It starts locked every time the diagram is
 * presented and lives only for the session, so a reload never keeps an
 * unlocked diagram.
 */
export function useFlowLock(): FlowLock {
  const [locked, setLocked] = useState(true);
  const toggle = useCallback(() => setLocked(current => !current), []);
  return { locked, toggle };
}
