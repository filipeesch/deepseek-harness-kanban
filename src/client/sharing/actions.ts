import { useCallback, useState } from 'react';
import type { ClientApi, Problem, SharingCommand } from '../../shared/types.js';
import { asProblem } from '../ui.js';

/**
 * One action layer for every publishing surface. It owns the pending label and the
 * failure, so a component can never dispatch the wrong command or lose an error.
 */
export interface SharingActions {
  /** The label of the action in flight, or null. */
  readonly pending: string | null;
  readonly error: Problem | null;
  /** Returns the failure, or null when the command succeeded. */
  run(label: string, command: SharingCommand): Promise<Problem | null>;
  reset(): void;
}

export function useSharingActions(api: ClientApi | undefined, options: { onError?: (problem: Problem) => void } = {}): SharingActions {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const reset = useCallback(() => setError(null), []);
  const run = useCallback(async (label: string, command: SharingCommand): Promise<Problem | null> => {
    if (api === undefined) {
      const problem: Problem = { code: 'SHARING_UNAVAILABLE', message: 'Team settings are unavailable in this view.' };
      setError(problem);
      options.onError?.(problem);
      return problem;
    }
    setPending(label); setError(null);
    try { await api.sharing(command); return null; }
    catch (failure) {
      const problem = asProblem(failure);
      setError(problem);
      options.onError?.(problem);
      return problem;
    }
    finally { setPending(null); }
  }, [api, options.onError]);
  return { pending, error, run, reset };
}
