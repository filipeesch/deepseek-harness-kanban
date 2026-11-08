import { EMPTY_CONVERSATION_FACTS, type ConversationFacts } from '../shared/types.js';
import type { ConversationFactsSource } from './native-facts.js';

/** Bounded re-reads after a transient facts failure; a new edge resets the allowance. */
export const MAX_READ_RETRIES = 5;

/** Presentation priority for one conversation's background read. */
export type FactsPriority = 'event' | 'active' | 'normal' | 'historical';

const PRIORITY: Readonly<Record<FactsPriority, number>> = { event: 0, active: 1, normal: 2, historical: 3 };

export interface ConversationFactsCacheOptions {
  source: ConversationFactsSource;
  /** How many background conversation reads may run at once. */
  concurrency?: number;
  /** Called once per resolved background batch, so the host can publish the new projection. */
  notify?: () => void;
  report?: (error: unknown) => void;
  /** Batch coalescing seam; defaults to one microtask so a wave of reads publishes once. */
  schedule?: (run: () => void) => void;
}

/**
 * Owns the conversation-facts cache, its retry allowance, and the bounded background
 * read queue. Admission reads start immediately through `read`; presentation reads are
 * queued by priority and publish once per batch. A failed read keeps its last known
 * facts so a presented indicator does not flicker, and no caller ever waits on the queue.
 */
export class ConversationFactsCache {
  private readonly cache = new Map<string, Promise<ConversationFacts>>();
  private readonly lastGood = new Map<string, ConversationFacts>();
  private readonly failedReads = new Map<string, number>();
  private readonly queue = new Map<string, FactsPriority>();
  private readonly concurrency: number;
  private readonly schedule: (run: () => void) => void;
  private active = 0;
  private notification = false;
  private disposed = false;

  constructor(private readonly options: ConversationFactsCacheOptions) {
    this.concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
    this.schedule = options.schedule ?? (run => queueMicrotask(run));
  }

  /** The single read used by admission and by the queue; deduped, retried by the coordinator. */
  read(sessionId: string): Promise<ConversationFacts> {
    return this.start(sessionId, false);
  }

  /** Resolved facts only: never starts a read and never includes an unresolved conversation. */
  resolvedFor(sessionIds: readonly string[]): Record<string, ConversationFacts> {
    const result: Record<string, ConversationFacts> = {};
    for (const sessionId of sessionIds) {
      const value = this.lastGood.get(sessionId);
      if (value !== undefined) result[sessionId] = value;
    }
    return result;
  }

  /**
   * Enqueue missing reads; an upgraded priority replaces the previous one. A conversation
   * with a failed read is retried only by the coordinator's bounded reconcile, never from
   * an `ensure` triggered by the publication it caused.
   */
  ensure(sessionIds: readonly string[], priority: FactsPriority): void {
    if (this.disposed) return;
    for (const sessionId of sessionIds) {
      if (this.cache.has(sessionId) || this.failedReads.has(sessionId)) continue;
      const queued = this.queue.get(sessionId);
      if (queued === undefined || PRIORITY[priority] < PRIORITY[queued]) this.queue.set(sessionId, priority);
    }
    this.pump();
  }

  /** Drop one conversation's cached facts, or every conversation's facts, and reset its retry allowance. */
  touch(sessionId?: string): void {
    if (this.disposed) return;
    this.clearFailures(sessionId);
    this.invalidate(sessionId);
  }

  invalidate(sessionId?: string): void {
    if (sessionId === undefined) this.cache.clear();
    else this.cache.delete(sessionId);
  }

  clearFailures(sessionId?: string): void {
    if (sessionId === undefined) this.failedReads.clear();
    else this.failedReads.delete(sessionId);
  }

  /** Conversations still inside their bounded retry allowance. */
  failedIds(): string[] {
    return [...this.failedReads].filter(([, attempts]) => attempts < MAX_READ_RETRIES).map(([sessionId]) => sessionId);
  }

  /** Whether this conversation currently has an in-flight or resolved read. */
  current(sessionId: string): boolean {
    return this.cache.has(sessionId);
  }

  /** A conversation whose retries are used up stays with its last known facts until a new edge. */
  isExhausted(sessionId: string): boolean {
    return (this.failedReads.get(sessionId) ?? 0) >= MAX_READ_RETRIES;
  }

  retrying(): boolean {
    return this.failedIds().length > 0;
  }

  /** Drop conversations that no longer belong to any task. */
  prune(known: ReadonlySet<string>): void {
    for (const sessionId of [...this.cache.keys()]) if (!known.has(sessionId)) this.cache.delete(sessionId);
    for (const sessionId of [...this.lastGood.keys()]) if (!known.has(sessionId)) this.lastGood.delete(sessionId);
    for (const sessionId of [...this.failedReads.keys()]) if (!known.has(sessionId)) this.failedReads.delete(sessionId);
    for (const sessionId of [...this.queue.keys()]) if (!known.has(sessionId)) this.queue.delete(sessionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cache.clear();
    this.lastGood.clear();
    this.failedReads.clear();
    this.queue.clear();
  }

  private start(sessionId: string, background: boolean): Promise<ConversationFacts> {
    const cached = this.cache.get(sessionId);
    if (cached !== undefined) return cached;
    // A direct read (admission or an explicit refresh) supersedes a queued one: the
    // queue entry must not later claim a worker slot for work that already started.
    this.queue.delete(sessionId);
    const pending: Promise<ConversationFacts> = this.options.source.read(sessionId).then(facts => {
      // A late old read must not overwrite the newest successful projection.
      if (this.cache.get(sessionId) === pending) {
        this.failedReads.delete(sessionId);
        this.lastGood.set(sessionId, facts);
      }
      return facts;
    }).catch(() => {
      // A late rejection must not evict a newer successful read.
      if (this.cache.get(sessionId) === pending) {
        this.cache.delete(sessionId);
        this.failedReads.set(sessionId, (this.failedReads.get(sessionId) ?? 0) + 1);
      }
      return this.lastGood.get(sessionId) ?? EMPTY_CONVERSATION_FACTS;
    }).finally(() => {
      if (!background) return;
      this.active = Math.max(0, this.active - 1);
      this.notifyOnce();
      this.pump();
    });
    this.cache.set(sessionId, pending);
    return pending;
  }

  private pump(): void {
    if (this.disposed) return;
    while (this.active < this.concurrency) {
      const next = this.takeNext();
      if (next === undefined) return;
      this.queue.delete(next);
      // A direct read may already own this conversation; starting it again would take
      // a worker slot that its background finally never releases.
      if (this.cache.has(next)) continue;
      this.active += 1;
      void this.start(next, true);
    }
  }

  private takeNext(): string | undefined {
    let best: string | undefined;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const [sessionId, priority] of this.queue) {
      const value = PRIORITY[priority];
      if (value < bestPriority) { bestPriority = value; best = sessionId; }
    }
    return best;
  }

  private notifyOnce(): void {
    if (this.disposed || this.notification) return;
    this.notification = true;
    this.schedule(() => {
      this.notification = false;
      if (this.disposed) return;
      try { this.options.notify?.(); } catch (error) { this.options.report?.(error); }
    });
  }
}
