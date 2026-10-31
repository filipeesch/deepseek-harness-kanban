import type { AutoModePauseReason, Board, ConversationFacts, HubTask } from '../shared/types.js';
import { openSessionIds } from '../shared/conversations.js';
import { hasUnresolvedEntry } from '../domain/stage-entry.js';
import { resolveAutoAdvance, type AutoAdvancePlan } from '../domain/auto-advance.js';

/** Delay before a completed turn is evaluated, so the native activity projection has settled. */
export const AUTO_ADVANCE_SETTLE_MS = 250;
/** Bounded re-reads while the ending conversation itself still reports activity. */
export const AUTO_ADVANCE_SETTLE_ATTEMPTS = 3;

const PAUSE_REASONS: Readonly<Record<string, AutoModePauseReason>> = {
  error: 'turn-error',
  blocked: 'turn-blocked',
  aborted: 'turn-aborted',
  'max-tokens': 'turn-max-tokens',
};

/** The recorded pause for a turn ending that is not `completed`, or undefined for completed. */
export function pauseReasonFor(kind: string): AutoModePauseReason | undefined {
  return PAUSE_REASONS[kind];
}

/** The `turn/end` reason kind, or undefined when the value is not a turn boundary. */
export function turnEndReason(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const value = event as { type?: unknown; data?: unknown };
  if (value.type !== 'turn/end') return undefined;
  const data = typeof value.data === 'object' && value.data !== null ? value.data as { reason?: unknown } : undefined;
  const reason = data !== undefined && typeof data.reason === 'object' && data.reason !== null ? data.reason as { kind?: unknown } : undefined;
  return typeof reason?.kind === 'string' ? reason.kind : undefined;
}

/** The event identity used to ignore a duplicated observation of the same turn boundary. */
export function turnEndKey(sessionId: string, event: unknown): string | undefined {
  if (turnEndReason(event) === undefined) return undefined;
  const seq = (event as { seq?: unknown }).seq;
  return typeof seq === 'number' && Number.isSafeInteger(seq) ? sessionId + ':' + seq : undefined;
}

export interface AutoAdvanceTaskView { task: HubTask; board: Board }

export interface AutoAdvancePorts {
  /** The task and board that own a conversation, when any. */
  locateBySession(sessionId: string): AutoAdvanceTaskView | undefined;
  locate(taskId: string): AutoAdvanceTaskView | undefined;
  facts(sessionId: string): Promise<ConversationFacts>;
  /** Persist one durable advance and dispatch it; throws when nothing was admitted. */
  admit(taskId: string, plan: AutoAdvancePlan): Promise<void>;
  pause(taskId: string, reason: AutoModePauseReason, message: string | undefined, expectedColumnId: string): Promise<void>;
  schedule(callback: () => void): unknown;
  cancel(handle: unknown): void;
  report(error: unknown): void;
}

interface QueuedTask { sessions: Set<string>; attempts: number; generation: number }

/**
 * Turns live turn boundaries into automatic advances. It owns only the policy
 * decision: reason filtering, the settle delay, the idle gate, and admission
 * hand-off. Persistence and execution stay with the injected ports.
 */
export class AutoAdvanceCoordinator {
  private readonly handled = new Set<string>();
  private readonly queued = new Map<string, QueuedTask>();
  private readonly generations = new Map<string, number>();
  private timer: unknown;
  private armed = false;
  private disposed = false;

  constructor(private readonly ports: AutoAdvancePorts) {}

  /** Observe one native session event; only an open task conversation's turn end matters. */
  observe(sessionId: string, event: unknown): void {
    if (this.disposed) return;
    const kind = turnEndReason(event);
    const key = turnEndKey(sessionId, event);
    if (kind === undefined || key === undefined) return;
    const located = this.ports.locateBySession(sessionId);
    if (!located || !openSessionIds(located.task).includes(sessionId)) return;
    if (located.task.autoMode?.enabled !== true) return;
    if (this.handled.has(key)) return;
    this.handled.add(key);
    if (this.handled.size > 1024) {
      for (const oldest of this.handled) {
        this.handled.delete(oldest);
        if (this.handled.size <= 768) break;
      }
    }
    if (kind === 'completed') {
      const entry = this.queued.get(located.task.id) ?? { sessions: new Set<string>(), attempts: 0, generation: this.generations.get(located.task.id) ?? 0 };
      entry.sessions.add(sessionId);
      this.queued.set(located.task.id, entry);
      this.arm();
      return;
    }
    const reason = pauseReasonFor(kind);
    if (reason === undefined) return;
    void this.ports.pause(located.task.id, reason, undefined, located.task.columnId).catch(error => this.ports.report(error));
  }

  /** Drop a queued settle for one task; used when auto mode is disabled. */
  forget(taskId: string): void {
    this.queued.delete(taskId);
    this.generations.set(taskId, (this.generations.get(taskId) ?? 0) + 1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.armed) this.ports.cancel(this.timer);
    this.timer = undefined;
    this.armed = false;
    this.queued.clear();
    this.handled.clear();
    this.generations.clear();
  }

  private arm(): void {
    if (this.disposed || this.armed) return;
    this.armed = true;
    this.timer = this.ports.schedule(() => {
      this.armed = false;
      this.timer = undefined;
      void this.settle();
    });
  }

  private async settle(): Promise<void> {
    if (this.disposed) return;
    const entries = [...this.queued];
    this.queued.clear();
    let retry = false;
    for (const [taskId, entry] of entries) {
      try {
        if (this.disposed) return;
        if ((this.generations.get(taskId) ?? 0) !== entry.generation) continue;
        const located = this.ports.locate(taskId);
        if (!located || located.task.autoMode?.enabled !== true) continue;
        const gate = await this.idleGate(located.task, entry.sessions);
        if (this.disposed) return;
        if ((this.generations.get(taskId) ?? 0) !== entry.generation) continue;
        if (!gate.idle) {
          if (gate.retry && entry.attempts + 1 < AUTO_ADVANCE_SETTLE_ATTEMPTS) {
            this.queued.set(taskId, { sessions: entry.sessions, attempts: entry.attempts + 1, generation: entry.generation });
            retry = true;
          }
          continue;
        }
        await this.advance(located.task, located.board);
      } catch (error) {
        this.ports.report(error);
      }
    }
    if (retry && !this.disposed) this.arm();
  }

  /** Idle means every open conversation reports neither a running turn nor a pending reply. */
  private async idleGate(task: HubTask, ending: ReadonlySet<string>): Promise<{ idle: boolean; retry: boolean }> {
    let retry = false;
    for (const sessionId of openSessionIds(task)) {
      let facts: ConversationFacts;
      try { facts = await this.ports.facts(sessionId); }
      catch (error) { this.ports.report(error); return { idle: false, retry: false }; }
      if (this.disposed) return { idle: false, retry: false };
      if (!facts.running && !facts.awaitingReply) continue;
      if (!ending.has(sessionId)) return { idle: false, retry: false };
      retry = true;
    }
    return retry ? { idle: false, retry: true } : { idle: true, retry: false };
  }

  private async advance(task: HubTask, board: Board): Promise<void> {
    if (this.disposed) return;
    if (task.operation || task.pendingTransition || hasUnresolvedEntry(task)) return;
    const plan = resolveAutoAdvance(board.workflow, task.columnId);
    if (!plan.destination) return;
    try {
      await this.ports.admit(task.id, plan);
    } catch (error) {
      this.ports.report(error);
      const message = error instanceof Error ? error.message : String(error);
      try { await this.ports.pause(task.id, 'advance-failed', message, task.columnId); }
      catch (failure) { this.ports.report(failure); }
    }
  }
}
