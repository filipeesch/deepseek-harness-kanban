import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ConversationModelOutcome } from '../shared/types.js';

/**
 * What one mounted board remembers about the models its conversations started on.
 *
 * A conversation's outcome is reported once, by the receipt of the command that
 * created it, and is kept here for as long as this board is mounted, so the notice
 * outlives the drawer that first showed it. Deciding that a notice was read belongs
 * to the surface that shows it, not to this memory: a dismissal is local view state,
 * never written to the task, the board, or the conversation, so reopening the
 * conversation presents the notice again while the same condition still holds.
 */
export interface ModelFallbackRegistry {
  /** Record what one creation receipt reported about the conversation it identified. */
  record(sessionId: string, outcome: ConversationModelOutcome | undefined): void;
  /** The fallback to present on one conversation, or null when there is nothing to say. */
  of(sessionId: string): ConversationModelOutcome | null;
}

/** Create the fallback memory of one board mount. */
export function useModelFallbackRegistry(): ModelFallbackRegistry {
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, ConversationModelOutcome>>(() => new Map());
  const record = useCallback((sessionId: string, outcome: ConversationModelOutcome | undefined): void => {
    // An applied route, or no route at all, leaves nothing to announce.
    if (outcome === undefined || outcome.applied) return;
    setOutcomes(previous => {
      if (previous.get(sessionId) === outcome) return previous;
      return new Map(previous).set(sessionId, outcome);
    });
  }, []);
  return useMemo<ModelFallbackRegistry>(() => ({ record, of: sessionId => outcomes.get(sessionId) ?? null }), [record, outcomes]);
}

const ModelFallbacksContext = createContext<ModelFallbackRegistry | null>(null);

/** Provide the fallback memory one board mount owns to the surfaces that create and show conversations. */
export function ModelFallbacksProvider({ registry, children }: { registry: ModelFallbackRegistry; children: ReactNode }) {
  return <ModelFallbacksContext.Provider value={registry}>{children}</ModelFallbacksContext.Provider>;
}

/** Read the board's fallback memory; a surface outside a board mount simply has nothing to announce. */
export function useOptionalModelFallbacks(): ModelFallbackRegistry | null {
  return useContext(ModelFallbacksContext);
}
