import type { ConversationFacts, PendingUserWork } from '../shared/types.js';
import { mergePendingUserWork, pendingUserWork } from '../domain/pending-user-work.js';
import type { ConversationFactsSource } from './native-facts.js';

/** The conversation-scoped question projection the composition reads. */
export interface PendingQuestionSource { pending(sessionId: string): boolean }

/**
 * Fold the plugin's question projection into the native facts, so one source
 * answers "what does this conversation still owe the user?" for the advance
 * gate, the admission re-check, and the attention projection alike. The
 * projection is read after the native read, so a page admitted during that
 * await is still counted.
 */
export function withQuestionPending(source: ConversationFactsSource, questions: PendingQuestionSource): ConversationFactsSource {
  return {
    async read(sessionId: string): Promise<ConversationFacts> {
      const facts = await source.read(sessionId);
      if (!questions.pending(sessionId)) return facts;
      return { ...facts, pending: mergePendingUserWork([facts.pending, pendingUserWork(['decision-question'])]) };
    },
  };
}

/**
 * Merge one task's conversations into the single pending value the advance
 * consumes. Reads run concurrently; a rejection propagates so the caller can
 * fail closed instead of reading an unreadable conversation as idle.
 */
export async function readPendingUserWork(source: ConversationFactsSource, sessionIds: readonly string[]): Promise<PendingUserWork> {
  const facts = await Promise.all(sessionIds.map(sessionId => source.read(sessionId)));
  return mergePendingUserWork(facts.map(value => value.pending));
}
