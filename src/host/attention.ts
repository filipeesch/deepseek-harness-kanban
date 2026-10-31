import type { ConversationFacts } from '../shared/types.js';
import { EMPTY_CONVERSATION_FACTS } from '../shared/types.js';
import type { ConversationFactsSource } from './native-facts.js';

/** Bounded re-reads after a transient facts failure; a new edge resets the allowance. */
export const MAX_READ_RETRIES = 5;
const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_RECONCILE_MS = 2_000;

/** One task whose conversations contribute to its attention. */
export interface AttentionTask { id: string; sessionIds: readonly string[] }
export interface AttentionCoordinatorOptions {
  source: ConversationFactsSource;
  tasks: () => readonly AttentionTask[];
  pendingQuestion: (sessionId: string) => boolean;
  refreshWorktrees: () => Promise<void>;
  onChange: () => void;
  report: (error: unknown) => void;
  debounceMs?: number;
  reconcileMs?: number;
}

function hasActive(facts: Record<string, ConversationFacts>): boolean {
  return Object.values(facts).some(value => value.running || value.background.length > 0);
}

function sameSettledTurn(left: ConversationFacts['settledTurn'], right: ConversationFacts['settledTurn']): boolean {
  return (left?.seq ?? null) === (right?.seq ?? null) && (left?.outcome ?? null) === (right?.outcome ?? null);
}

/** Compare two conversation-fact projections for the host's publish-on-change rule. */
export function sameConversationFacts(left: Record<string, ConversationFacts>, right: Record<string, ConversationFacts>): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    const before = left[key]!, after = right[key];
    if (!after) return false;
    if (before.running !== after.running || before.awaitingReply !== after.awaitingReply) return false;
    if (!sameSettledTurn(before.settledTurn, after.settledTurn)) return false;
    if (before.background.length !== after.background.length) return false;
    for (let index = 0; index < before.background.length; index += 1) {
      if (before.background[index]!.kind !== after.background[index]!.kind
        || before.background[index]!.label !== after.background[index]!.label) return false;
    }
  }
  return true;
}

/**
 * Owns the per-conversation fact cache, invalidation, and projection. One coalesced
 * tick keeps the pending-worktree resume coupled to activity changes; the caller decides
 * when to publish.
 */
export class AttentionCoordinator {
  private readonly cache = new Map<string, Promise<ConversationFacts>>();
  private readonly lastGood = new Map<string, ConversationFacts>();
  private readonly failedReads = new Map<string, number>();
  private readonly debounceMs: number;
  private readonly reconcileMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timerKind: 'debounce' | 'reconcile' | undefined;
  private last: Record<string, ConversationFacts> | undefined;
  private ticking = false;
  private tickAgain = false;
  private disposed = false;

  constructor(private readonly options: AttentionCoordinatorOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.reconcileMs = options.reconcileMs ?? DEFAULT_RECONCILE_MS;
  }

  /** Drop one conversation's cached facts, or every conversation's facts. */
  invalidate(sessionId?: string): void {
    if (sessionId === undefined) this.cache.clear();
    else this.cache.delete(sessionId);
  }

  /** Invalidate the affected facts, reset its retry allowance, and coalesce an activity refresh. */
  touch(sessionId?: string): void {
    if (this.disposed) return;
    if (sessionId === undefined) this.failedReads.clear();
    else this.failedReads.delete(sessionId);
    this.invalidate(sessionId);
    this.schedule(this.debounceMs, 'debounce');
  }

  /** Project the current conversations' facts and reconcile the bounded background timer. */
  async project(tasks?: readonly AttentionTask[]): Promise<Record<string, ConversationFacts>> {
    if (this.disposed) return {};
    const projected = await this.projectFresh(tasks);
    if (this.disposed) return projected;
    this.last = projected;
    this.arm(projected);
    return projected;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerKind = undefined;
    this.last = undefined;
    this.cache.clear();
    this.lastGood.clear();
    this.failedReads.clear();
  }

  private schedule(delay: number, kind: 'debounce' | 'reconcile'): void {
    if (this.disposed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timerKind = kind;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.timerKind = undefined;
      void this.tick();
    }, delay);
  }

  private retrying(): boolean {
    return [...this.failedReads.values()].some(attempts => attempts < MAX_READ_RETRIES);
  }

  private arm(projected: Record<string, ConversationFacts>): void {
    if (this.disposed) return;
    if (hasActive(projected) || this.retrying()) {
      if (this.timer === undefined) this.schedule(this.reconcileMs, 'reconcile');
      return;
    }
    if (this.timerKind === 'reconcile' && this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerKind = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      try {
        await this.options.refreshWorktrees();
      } catch (error) {
        this.options.report(error);
      }
      if (this.disposed) return;
      this.invalidate();
      const projected = await this.projectFresh();
      if (this.disposed) return;
      const changed = !this.last || !sameConversationFacts(this.last, projected);
      this.last = projected;
      if (changed) this.options.onChange();
      this.arm(projected);
    } catch (error) {
      this.options.report(error);
    } finally {
      this.ticking = false;
      if (this.tickAgain && !this.disposed) {
        this.tickAgain = false;
        void this.tick();
      }
    }
  }

  private async projectFresh(tasks?: readonly AttentionTask[]): Promise<Record<string, ConversationFacts>> {
    if (this.disposed) return {};
    const list = tasks ?? this.options.tasks();
    const known = new Set<string>();
    const facts: Record<string, ConversationFacts> = {};
    for (const task of list) {
      for (const sessionId of task.sessionIds) {
        if (known.has(sessionId)) continue;
        known.add(sessionId);
        facts[sessionId] = this.withPendingQuestion(sessionId, await this.read(sessionId));
      }
    }
    for (const sessionId of [...this.cache.keys()]) if (!known.has(sessionId)) this.cache.delete(sessionId);
    for (const sessionId of [...this.lastGood.keys()]) if (!known.has(sessionId)) this.lastGood.delete(sessionId);
    for (const sessionId of [...this.failedReads.keys()]) if (!known.has(sessionId)) this.failedReads.delete(sessionId);
    return facts;
  }

  private withPendingQuestion(sessionId: string, facts: ConversationFacts): ConversationFacts {
    if (facts.awaitingReply || !this.options.pendingQuestion(sessionId)) return facts;
    return { ...facts, awaitingReply: true };
  }

  private read(sessionId: string): Promise<ConversationFacts> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;
    const pending: Promise<ConversationFacts> = this.options.source.read(sessionId).then(facts => {
      this.failedReads.delete(sessionId);
      this.lastGood.set(sessionId, facts);
      return facts;
    }).catch(() => {
      // A late rejection must not mark or evict a newer successful read.
      if (this.cache.get(sessionId) === pending) {
        this.cache.delete(sessionId);
        this.failedReads.set(sessionId, (this.failedReads.get(sessionId) ?? 0) + 1);
      }
      // Keep the last known facts so a transient failure does not flicker a presented indicator.
      return this.lastGood.get(sessionId) ?? EMPTY_CONVERSATION_FACTS;
    });
    this.cache.set(sessionId, pending);
    return pending;
  }
}
