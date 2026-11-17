import { classifySessionFailure, sameSessionObservation } from '../domain/session-observation.js';
import type { SessionObservation } from '../shared/types.js';
import type { ConversationFactsSource } from './native-facts.js';

export interface ConversationObservationOptions {
  /** Called once per operation that changed at least one record. */
  onChange?: () => void;
  report?: (error: unknown) => void;
}

/**
 * Owns the one record per conversation the plugin could not observe. It is a
 * separate index, never a field on the conversation facts: a failed read is a
 * failure to know, and no consumer of facts may treat it as knowledge.
 * Recording the same failure twice is a no-op, so a retried read cannot turn one
 * failure into many notifications.
 */
export class ConversationObservationIndex {
  private readonly records = new Map<string, SessionObservation>();

  constructor(private readonly options: ConversationObservationOptions = {}) {}

  /**
   * Classify one failed observation and record it.
   * @param sessionId - the conversation that failed.
   * @param failure - the error the observation read threw.
   * @returns whether the recorded state changed.
   */
  record(sessionId: string, failure: unknown): boolean {
    const observation = classifySessionFailure(failure as { code?: unknown; message?: unknown } | undefined);
    if (observation === null) return false;
    if (sameSessionObservation(this.records.get(sessionId), observation)) return false;
    this.records.set(sessionId, observation);
    this.notify();
    return true;
  }

  /**
   * Clear the record of one conversation after a successful observation.
   * @returns whether a record was removed.
   */
  recover(sessionId: string): boolean {
    if (!this.records.delete(sessionId)) return false;
    this.notify();
    return true;
  }

  /** One conversation's record, when it currently has one. */
  get(sessionId: string): SessionObservation | undefined {
    return this.records.get(sessionId);
  }

  /** Whether the conversation is currently recorded as unobservable. */
  has(sessionId: string): boolean {
    return this.records.has(sessionId);
  }

  /** The records of the listed conversations, in listing order, omitting the observed ones. */
  resolved(sessionIds: readonly string[]): Record<string, SessionObservation> {
    const result: Record<string, SessionObservation> = {};
    for (const sessionId of sessionIds) {
      const value = this.records.get(sessionId);
      if (value !== undefined) result[sessionId] = value;
    }
    return result;
  }

  /** Every record, for the snapshot and for the card aggregation. */
  all(): Record<string, SessionObservation> {
    return Object.fromEntries(this.records);
  }

  /** Drop records for conversations no task refers to any more. */
  prune(known: ReadonlySet<string>): void {
    let changed = false;
    for (const sessionId of [...this.records.keys()]) {
      if (known.has(sessionId)) continue;
      this.records.delete(sessionId);
      changed = true;
    }
    if (changed) this.notify();
  }

  dispose(): void {
    this.records.clear();
  }

  private notify(): void {
    try { this.options.onChange?.(); }
    catch (error) { this.options.report?.(error); }
  }
}

export interface ObservedFactsSourceOptions {
  source: ConversationFactsSource;
  index: ConversationObservationIndex;
}

/**
 * Decorate one conversation-facts source so a failed observation is classified
 * before the facts cache swallows it, and a successful one clears the record.
 * The rejection still propagates: the cache keeps owning retries and fallbacks.
 */
export function createObservedFactsSource(options: ObservedFactsSourceOptions): ConversationFactsSource {
  const { source, index } = options;
  return {
    async read(sessionId: string) {
      try {
        const facts = await source.read(sessionId);
        index.recover(sessionId);
        return facts;
      } catch (error) {
        index.record(sessionId, error);
        throw error;
      }
    },
  };
}
