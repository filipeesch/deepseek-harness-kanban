import type { ConversationFacts } from '../shared/types.js';
import { ConversationReadTracker } from './conversation-read-tracker.js';
import { browserStorage, type KeyValueStorage } from './key-value-storage.js';
import { ReadAcknowledgments } from './read-acknowledgments.js';

/**
 * One collaborator for per-conversation read state: which conversation is
 * displayed, which settled turn it acknowledged, and the durable record that
 * survives a reload.
 */
export class ConversationReadState {
  private readonly progress: ReadAcknowledgments;
  private readonly tracker: ConversationReadTracker;

  constructor(storage: KeyValueStorage = browserStorage()) {
    this.progress = new ReadAcknowledgments(storage);
    this.tracker = new ConversationReadTracker(this.progress);
  }

  /** Refresh facts and acknowledge every conversation that is currently displayed. */
  sync(conversations: Readonly<Record<string, ConversationFacts>>): void {
    this.tracker.sync(conversations);
  }

  /** The acknowledged sequence for a conversation. */
  acknowledged(sessionId: string): number | undefined {
    return this.tracker.acknowledged(sessionId);
  }

  /** Start reading one conversation; the returned release is idempotent. */
  view(sessionId: string): () => void {
    return this.tracker.view(sessionId);
  }

  /** A closed tab stops notifying about the turn that had already settled. */
  close(sessionId: string): void {
    this.tracker.close(sessionId);
  }

  /** Drop acknowledgments for conversations that no longer belong to any task. */
  prune(known: ReadonlySet<string>): void {
    this.progress.prune(known);
  }

  /** Persist coalesced acknowledgments immediately. */
  flush(): void {
    this.progress.flush();
  }
}
