import type { ConversationFacts, SettledTurn } from '../shared/types.js';

/** The read-progress port the tracker needs; the durable store implements it. */
export interface ReadProgress {
  acknowledged(sessionId: string): number | undefined;
  acknowledge(sessionId: string, seq: number): void;
}

/**
 * Owns which conversations are being read. It acknowledges the settled turn of a
 * displayed conversation and of a closed tab, without knowing how the facts were
 * obtained or where the acknowledgment is stored.
 */
export class ConversationReadTracker {
  private readonly viewers = new Map<string, number>();
  private readonly facts = new Map<string, ConversationFacts>();

  constructor(private readonly progress: ReadProgress) {}

  /** Refresh the facts and acknowledge every conversation that is currently displayed. */
  sync(conversations: Readonly<Record<string, ConversationFacts>>): void {
    this.facts.clear();
    for (const [sessionId, value] of Object.entries(conversations)) {
      this.facts.set(sessionId, value);
      if ((this.viewers.get(sessionId) ?? 0) > 0) this.mark(sessionId, value.settledTurn);
    }
  }

  /** Start reading one conversation; the returned release is idempotent. */
  view(sessionId: string): () => void {
    this.viewers.set(sessionId, (this.viewers.get(sessionId) ?? 0) + 1);
    const facts = this.facts.get(sessionId);
    if (facts) this.mark(sessionId, facts.settledTurn);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const remaining = (this.viewers.get(sessionId) ?? 1) - 1;
      if (remaining > 0) this.viewers.set(sessionId, remaining);
      else this.viewers.delete(sessionId);
    };
  }

  /** A closed tab stops notifying about the turn that had already settled. */
  close(sessionId: string): void {
    const facts = this.facts.get(sessionId);
    if (facts) this.mark(sessionId, facts.settledTurn);
  }

  /** The acknowledged sequence for a conversation, as the durable store knows it. */
  acknowledged(sessionId: string): number | undefined {
    return this.progress.acknowledged(sessionId);
  }

  private mark(sessionId: string, settled: SettledTurn | null): void {
    if (settled) this.progress.acknowledge(sessionId, settled.seq);
  }
}
