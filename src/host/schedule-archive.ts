import type { ConversationFacts } from '../shared/types.js';

/** What the watcher needs from the host to decide about one conversation. */
export interface ScheduleArchivePorts {
  facts(sessionId: string): Promise<ConversationFacts>;
  archive(sessionId: string): Promise<void>;
  /** Called after a conversation is archived so the host can publish. */
  onChange?: () => void;
  /** A failed archive attempt, recorded against the conversation's run. */
  onArchiveFailure?: (scheduleId: string, sessionId: string, error: unknown) => void;
  /** A successful archive, clearing an earlier recorded failure. */
  onArchived?: (scheduleId: string, sessionId: string) => void;
  report?: (error: unknown) => void;
  /** Failed attempts allowed before the conversation is left visible. */
  maxAttempts?: number;
}

interface Watched { readonly sessionId: string; readonly scheduleId: string; attempts: number; evaluating: boolean; dirty: boolean }

/**
 * Archives the conversations a schedule created, but only once each is genuinely
 * idle: no running turn, pending interaction, queued prompt, or background work.
 * An observation that arrives during an awaited evaluation marks the entry dirty
 * and triggers a coalesced reevaluation, so the final idle event is never lost.
 */
export class ScheduleArchiveWatcher {
  private readonly entries = new Map<string, Watched>();
  private readonly inFlight = new Set<Promise<void>>();
  private disposed = false;

  constructor(private readonly ports: ScheduleArchivePorts) {}

  register(sessionId: string, scheduleId: string): void {
    if (this.disposed || this.entries.has(sessionId)) return;
    this.entries.set(sessionId, { sessionId, scheduleId, attempts: 0, evaluating: false, dirty: false });
  }

  forget(sessionId: string): void { this.entries.delete(sessionId); }

  observe(sessionId: string): void {
    if (this.disposed) return;
    const entry = this.entries.get(sessionId);
    if (entry === undefined) return;
    if (entry.evaluating) { entry.dirty = true; return; }
    const task = this.evaluate(entry);
    this.inFlight.add(task);
    void task.finally(() => { this.inFlight.delete(task); });
  }

  /** Resolve after every evaluation started so far settled; shutdown drains this. */
  async settle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  get size(): number { return this.entries.size; }

  dispose(): void { this.disposed = true; this.entries.clear(); }

  private async evaluate(entry: Watched): Promise<void> {
    entry.evaluating = true;
    try {
      do {
        entry.dirty = false;
        const facts = await this.ports.facts(entry.sessionId);
        if (this.disposed || this.entries.get(entry.sessionId) !== entry) return;
        const busy = facts.running || facts.background.length > 0
          || facts.pending.kinds.length > 0 || facts.pending.queuedPrompts > 0;
        if (busy) break;
        try {
          await this.ports.archive(entry.sessionId);
          this.entries.delete(entry.sessionId);
          this.ports.onArchived?.(entry.scheduleId, entry.sessionId);
          this.ports.onChange?.();
          return;
        } catch (error) {
          entry.attempts += 1;
          this.ports.onArchiveFailure?.(entry.scheduleId, entry.sessionId, error);
          this.ports.report?.(error);
          if (entry.attempts >= (this.ports.maxAttempts ?? 5)) { this.entries.delete(entry.sessionId); return; }
          break;
        }
      } while (entry.dirty);
    } finally {
      entry.evaluating = false;
      if (!this.disposed && this.entries.get(entry.sessionId) === entry && entry.dirty) this.observe(entry.sessionId);
    }
  }
}
