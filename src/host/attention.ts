import type { ConversationFacts } from '../shared/types.js';
import { samePendingUserWork } from '../domain/pending-user-work.js';
import type { ConversationFactsSource } from './native-facts.js';
import { ConversationFactsCache } from './conversation-facts-cache.js';

export { MAX_READ_RETRIES } from './conversation-facts-cache.js';

const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_RECONCILE_MS = 2_000;
/** Timer reconciliation reads in small batches so one slow conversation cannot block a publish. */
const RECONCILE_BATCH = 4;

/** One task whose conversations contribute to its attention. */
export interface AttentionTask {
  id: string;
  sessionIds: readonly string[];
  /** Closed conversations are historical and resolve last. */
  closedSessionIds?: readonly string[];
  /** Active tasks (running or auto mode enabled) resolve their facts before historically idle ones. */
  priority?: 'active' | 'normal';
}
export interface AttentionCoordinatorOptions {
  source: ConversationFactsSource;
  tasks: () => readonly AttentionTask[];
  runPendingWork: () => Promise<void>;
  /** Called with the conversations whose resolved facts changed, so only their tasks are woken. */
  onChange: (changedSessionIds: readonly string[]) => void;
  report: (error: unknown) => void;
  /** Called once per resolved background fact batch so the caller can publish the new projection. */
  onFacts?: () => void;
  /** Background read concurrency; the cache defaults it. */
  concurrency?: number;
  /** Batch coalescing seam for tests. */
  schedule?: (run: () => void) => void;
  debounceMs?: number;
  reconcileMs?: number;
}

function hasActive(facts: Record<string, ConversationFacts>): boolean {
  return Object.values(facts).some(value => value.running || value.background.length > 0);
}

function sameSettledTurn(left: ConversationFacts['settledTurn'], right: ConversationFacts['settledTurn']): boolean {
  return (left?.seq ?? null) === (right?.seq ?? null) && (left?.outcome ?? null) === (right?.outcome ?? null);
}

/** Whether two resolved facts for the same conversation describe the same work. */
function sameFacts(before: ConversationFacts | undefined, after: ConversationFacts): boolean {
  if (before === undefined) return false;
  if (before.running !== after.running || !samePendingUserWork(before.pending, after.pending)) return false;
  if (!sameSettledTurn(before.settledTurn, after.settledTurn)) return false;
  if (before.background.length !== after.background.length) return false;
  for (let index = 0; index < before.background.length; index += 1) {
    if (before.background[index]!.kind !== after.background[index]!.kind
      || before.background[index]!.label !== after.background[index]!.label) return false;
  }
  return true;
}

/** Compare two conversation-fact projections for the host's publish-on-change rule. */
export function sameConversationFacts(left: Record<string, ConversationFacts>, right: Record<string, ConversationFacts>): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    const after = right[key];
    if (after === undefined || !sameFacts(left[key], after)) return false;
  }
  return true;
}

/** The conversations whose facts changed between two resolved projections. */
export function changedConversationFacts(left: Record<string, ConversationFacts> | undefined, right: Record<string, ConversationFacts>): string[] {
  if (left === undefined) return Object.keys(right);
  const changed: string[] = [];
  for (const [sessionId, after] of Object.entries(right)) if (!sameFacts(left[sessionId], after)) changed.push(sessionId);
  for (const sessionId of Object.keys(left)) if (right[sessionId] === undefined) changed.push(sessionId);
  return changed;
}

function sessionsOf(tasks: readonly AttentionTask[]): string[] {
  const known = new Set<string>();
  for (const task of tasks) for (const sessionId of task.sessionIds) known.add(sessionId);
  return [...known];
}

/**
 * Owns the per-conversation fact cache, its invalidation, and the presentation
 * projection. Presentation never awaits a cold read; admission reads the uncached
 * facts source, so a partial or fallback presentation can never feed an automatic
 * decision.
 */
export class AttentionCoordinator {
  private readonly facts: ConversationFactsCache;
  private readonly debounceMs: number;
  private readonly reconcileMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timerKind: 'debounce' | 'reconcile' | undefined;
  private last: Record<string, ConversationFacts> | undefined;
  private presented: readonly string[] = [];
  private readonly dirty = new Set<string>();
  private ticking = false;
  private tickAgain = false;
  private disposed = false;

  constructor(private readonly options: AttentionCoordinatorOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.reconcileMs = options.reconcileMs ?? DEFAULT_RECONCILE_MS;
    this.facts = new ConversationFactsCache({
      source: options.source,
      report: options.report,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
      notify: () => this.factsSettled(),
    });
  }

  /** One conversation's durable read for admission paths; never queued behind presentation. */
  read(sessionId: string): Promise<ConversationFacts> {
    return this.facts.read(sessionId);
  }

  /** Drop one conversation's cached facts, or every conversation's facts, for the next tick. */
  invalidate(sessionId?: string): void {
    this.facts.invalidate(sessionId);
    this.markDirty(sessionId);
  }

  /** Invalidate the affected facts, reset its retry allowance, and coalesce an activity refresh. */
  touch(sessionId?: string): void {
    if (this.disposed) return;
    this.facts.touch(sessionId);
    this.markDirty(sessionId);
    this.schedule(this.debounceMs, 'debounce');
  }

  /**
   * Resolve the requested conversations before an explicit snapshot response. Every
   * other conversation keeps its resolved cache and continues in the background queue;
   * an explicit refresh never turns into a full cold re-read.
   */
  async refresh(sessionIds: readonly string[], tasks?: readonly AttentionTask[]): Promise<Record<string, ConversationFacts>> {
    if (this.disposed) return {};
    const list = tasks ?? this.options.tasks();
    const known = sessionsOf(list);
    const knownSet = new Set(known);
    // A native status event can name an ordinary chat; only task conversations are read.
    const targets = [...new Set(sessionIds)].filter(sessionId => knownSet.has(sessionId));
    this.presented = known;
    this.facts.prune(knownSet);
    for (const sessionId of targets) {
      this.facts.invalidate(sessionId);
      this.facts.clearFailures(sessionId);
      this.dirty.delete(sessionId);
    }
    // The requested conversations are read directly below; queueing them would make a
    // failure notify as a background batch before the explicit response exists.
    this.ensurePresentation(list, new Set(targets));
    const entries = targets.length === 0 ? [] : await Promise.all(targets.map(async sessionId => [sessionId, await this.facts.read(sessionId)] as const));
    if (this.disposed) return {};
    const projected = this.facts.resolvedFor(known);
    for (const [sessionId, facts] of entries) projected[sessionId] = facts;
    this.last = projected;
    this.arm(projected);
    return projected;
  }

  /**
   * The resolved presentation with no read scheduled or awaited. A command response
   * uses it so the command itself never starts a conversation-fact read.
   */
  presentCache(tasks?: readonly AttentionTask[]): Record<string, ConversationFacts> {
    if (this.disposed) return {};
    return this.facts.resolvedFor(sessionsOf(tasks ?? this.options.tasks()));
  }

  /** Ask for one task's conversations to be resolved before historically idle ones. */
  prioritize(sessionIds: readonly string[]): void {
    if (this.disposed || sessionIds.length === 0) return;
    this.facts.ensure(sessionIds, 'event');
  }

  /** The presentation projection: resolved facts only, with background reads scheduled. */
  present(tasks?: readonly AttentionTask[]): Record<string, ConversationFacts> {
    if (this.disposed) return {};
    const list = tasks ?? this.options.tasks();
    const sessionIds = sessionsOf(list);
    this.presented = sessionIds;
    this.facts.prune(new Set(sessionIds));
    this.ensurePresentation(list);
    // The read this publication started supersedes the dirty edge that caused it;
    // a touch that arrives later re-adds the id, and a failed read stays dirty for retry.
    for (const sessionId of sessionIds) if (this.facts.current(sessionId)) this.dirty.delete(sessionId);
    const projected = this.facts.resolvedFor(sessionIds);
    this.last = projected;
    this.arm(projected);
    return projected;
  }

  /** Awaiting projection: every conversation's durable facts, used by explicit refreshes and tests. */
  async project(tasks?: readonly AttentionTask[]): Promise<Record<string, ConversationFacts>> {
    if (this.disposed) return {};
    const list = tasks ?? this.options.tasks();
    const sessionIds = sessionsOf(list);
    this.presented = sessionIds;
    this.facts.prune(new Set(sessionIds));
    const entries = await Promise.all(sessionIds.map(async sessionId => [sessionId, await this.facts.read(sessionId)] as const));
    if (this.disposed) return {};
    for (const sessionId of sessionIds) this.dirty.delete(sessionId);
    const projected = Object.fromEntries(entries) as Record<string, ConversationFacts>;
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
    this.presented = [];
    this.dirty.clear();
    this.facts.dispose();
  }

  /** A background batch resolved: refresh the presentation and publish only a real change. */
  private factsSettled(): void {
    if (this.disposed) return;
    const next = this.facts.resolvedFor(this.sessionIds());
    const changed = this.last === undefined || !sameConversationFacts(this.last, next);
    this.last = next;
    if (changed) this.options.onFacts?.();
    this.arm(next);
  }

  /** Every conversation the board currently presents, from the last snapshot or the task list. */
  private sessionIds(): string[] {
    return this.presented.length > 0 ? [...this.presented] : sessionsOf(this.options.tasks());
  }

  private markDirty(sessionId?: string): void {
    if (this.disposed) return;
    if (sessionId !== undefined) { this.dirty.add(sessionId); return; }
    for (const id of this.sessionIds()) this.dirty.add(id);
  }

  private ensurePresentation(tasks: readonly AttentionTask[], skip?: ReadonlySet<string>): void {
    const active: string[] = [];
    const normal: string[] = [];
    const historical: string[] = [];
    for (const task of tasks) {
      const closed = new Set(task.closedSessionIds ?? []);
      for (const sessionId of task.sessionIds) {
        if (skip?.has(sessionId) === true) continue;
        const known = this.last?.[sessionId];
        const busy = known !== undefined && (known.running || known.background.length > 0);
        if (task.priority === 'active' || busy) active.push(sessionId);
        else if (closed.has(sessionId)) historical.push(sessionId);
        else normal.push(sessionId);
      }
    }
    // Active conversations must claim the first worker slots; queueing the idle
    // history first would start it before an auto-mode or busy conversation.
    this.facts.ensure(active, 'active');
    this.facts.ensure(normal, 'normal');
    this.facts.ensure(historical, 'historical');
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

  private arm(projected: Record<string, ConversationFacts>): void {
    if (this.disposed) return;
    if (hasActive(projected) || this.facts.retrying()) {
      if (this.timer === undefined) this.schedule(this.reconcileMs, 'reconcile');
      return;
    }
    if (this.timerKind === 'reconcile' && this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerKind = undefined;
    }
  }

  /** Conversations to re-read: touched edges, active work, and reads inside the retry allowance. */
  private reconcileIds(): string[] {
    const ids = new Set<string>();
    for (const sessionId of [...this.dirty]) {
      if (this.facts.isExhausted(sessionId)) { this.dirty.delete(sessionId); continue; }
      ids.add(sessionId);
    }
    for (const sessionId of this.facts.failedIds()) ids.add(sessionId);
    for (const [sessionId, facts] of Object.entries(this.last ?? {})) {
      if ((facts.running || facts.background.length > 0) && !this.facts.isExhausted(sessionId)) ids.add(sessionId);
    }
    return [...ids];
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
        await this.options.runPendingWork();
      } catch (error) {
        this.options.report(error);
      }
      if (this.disposed) return;
      // Re-read only the conversations that can change on their own; historical facts
      // cannot move without a session event and are never started by a timer. Reads are
      // batched so one slow conversation cannot hold back every other publish.
      const ids = this.reconcileIds();
      this.dirty.clear();
      for (const sessionId of ids) this.facts.invalidate(sessionId);
      // Work-conserving workers: one slow conversation occupies one slot while the
      // others keep starting and publishing their own completions.
      let next = 0;
      const publishIfChanged = (): void => {
        const projected = this.facts.resolvedFor(this.sessionIds());
        const changed = changedConversationFacts(this.last, projected);
        this.last = projected;
        if (changed.length > 0) this.options.onChange(changed);
      };
      const worker = async (): Promise<void> => {
        while (!this.disposed) {
          const sessionId = ids[next];
          next += 1;
          if (sessionId === undefined) return;
          await this.facts.read(sessionId);
          if (this.disposed) return;
          publishIfChanged();
        }
      };
      await Promise.all(Array.from({ length: Math.min(RECONCILE_BATCH, ids.length) }, () => worker()));
      if (this.disposed) return;
      this.arm(this.last ?? {});
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
}
