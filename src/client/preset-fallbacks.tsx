import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ConversationPresetOutcome } from '../shared/types.js';

/**
 * What one mounted board remembers about the agent presets its conversations
 * started on.
 *
 * A conversation's preset outcome is reported once, by the receipt of the command
 * that created it, and is kept here for as long as this board is mounted, so the
 * notice outlives the drawer that first showed it. Deciding that a notice was read
 * belongs to the surface that shows it: a dismissal is local view state, never
 * written to the task, the board, or the conversation.
 */
export interface PresetFallbackRegistry {
  /** Record what one creation receipt reported about the conversation it identified. */
  record(sessionId: string, outcome: ConversationPresetOutcome | undefined): void;
  /** The fallback to present on one conversation, or null when there is nothing to say. */
  of(sessionId: string): ConversationPresetOutcome | null;
}

/** Create the preset-fallback memory of one board mount. */
export function usePresetFallbackRegistry(): PresetFallbackRegistry {
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, ConversationPresetOutcome>>(() => new Map());
  const record = useCallback((sessionId: string, outcome: ConversationPresetOutcome | undefined): void => {
    // An applied preset, or no preset at all, leaves nothing to announce.
    if (outcome === undefined || outcome.applied) return;
    setOutcomes(previous => {
      if (previous.get(sessionId) === outcome) return previous;
      return new Map(previous).set(sessionId, outcome);
    });
  }, []);
  return useMemo<PresetFallbackRegistry>(() => ({ record, of: sessionId => outcomes.get(sessionId) ?? null }), [record, outcomes]);
}

const PresetFallbacksContext = createContext<PresetFallbackRegistry | null>(null);

/** Provide the preset-fallback memory one board mount owns to the surfaces that show it. */
export function PresetFallbacksProvider({ registry, children }: { registry: PresetFallbackRegistry; children: ReactNode }) {
  return <PresetFallbacksContext.Provider value={registry}>{children}</PresetFallbacksContext.Provider>;
}

/** Read the board's preset-fallback memory; a surface outside a board mount has nothing to announce. */
export function useOptionalPresetFallbacks(): PresetFallbackRegistry | null {
  return useContext(PresetFallbacksContext);
}
