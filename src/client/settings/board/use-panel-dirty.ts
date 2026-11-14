import { useEffect, useRef } from 'react';

/**
 * Report one board panel's unsaved state to the container that guards navigation.
 * The callback is read through a ref so a container's inline callback does not
 * re-run the effect on every render, and unmounting clears the flag: a panel that
 * is gone has no draft to lose.
 */
export function usePanelDirty(dirty: boolean, onChange?: (dirty: boolean) => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => { latest.current?.(dirty); }, [dirty]);
  useEffect(() => () => { latest.current?.(false); }, []);
}
