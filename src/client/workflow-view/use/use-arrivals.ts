import { useCallback, useState } from 'react';

export interface ArrivalState {
  /** One token per card that has arrived; a new token restarts that card's pulse. */
  readonly tokens: ReadonlyMap<string, number>;
  /** Starts the arrival pulse of one card. */
  arrive(taskId: string): void;
  /** Clears the pulse once the card presented that exact token. */
  settle(taskId: string, token: number): void;
  /** Drops the pulses of cards the diagram no longer presents. */
  retain(presented: ReadonlySet<string>): void;
  /** Drops every pulse, for an arrangement that settles without motion. */
  clear(): void;
}

/** The arrival pulses the diagram presents, keyed by task id. */
export function useArrivals(): ArrivalState {
  const [tokens, setTokens] = useState<ReadonlyMap<string, number>>(() => new Map());
  const arrive = useCallback((taskId: string) => {
    setTokens(current => {
      const next = new Map(current);
      next.set(taskId, (current.get(taskId) ?? 0) + 1);
      return next;
    });
  }, []);
  // Only the completion of the pulse the card is presenting may clear it, so a stale
  // animation end can never remove a newer arrival.
  const settle = useCallback((taskId: string, token: number) => {
    setTokens(current => {
      if (current.get(taskId) !== token) return current;
      const next = new Map(current);
      next.delete(taskId);
      return next;
    });
  }, []);
  const retain = useCallback((presented: ReadonlySet<string>) => {
    setTokens(current => {
      const kept = [...current].filter(([taskId]) => presented.has(taskId));
      if (kept.length === current.size) return current;
      return new Map(kept);
    });
  }, []);
  const clear = useCallback(() => {
    setTokens(current => current.size === 0 ? current : new Map());
  }, []);
  return { tokens, arrive, settle, retain, clear };
}
