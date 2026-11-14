import { invariant, problem } from '../shared/errors.js';
import { recordDeterministicHandoff } from '../domain/task-history/record.js';
import { firstOpenSessionId } from '../shared/conversations.js';
import { deterministicEqual } from '../domain/deterministic-definition.js';
import type { DeterministicSummary } from '../shared/deterministic.js';
import type { HubTask } from '../shared/types.js';
import type { LocatedTask } from './hub-repository.js';

/** The task facts the surface needs, without depending on the application root. */
export interface DeterministicTaskFacts {
  stageEntry?: { id: string };
  deterministicHandoff?: {
    id: string; entryId: string; executionId: string; instruction?: string; sessionId?: string;
    acceptedAt?: string; error?: unknown; fromColumnId: string; columnId: string; exit: string; message: string;
  };
  operation: unknown | null;
}

/** The ports the deterministic surface needs from the application root. */
export interface DeterministicSurfacePorts {
  /** Every located task, for sweeps. */
  all(): Iterable<LocatedTask>;
  /** One task's Hubs and board, by identity. */
  locate(taskId: string): LocatedTask | undefined;
  /** The execution supervisor when the host exposes one. */
  supervisor(): { reconcile(taskId: string): void } | undefined;
  /** Mutate one task inside its Hub transaction. */
  transact(taskId: string, mutate: (task: HubTask | undefined) => void): Promise<void>;
  /** Create the task's first conversation and answer its identity. */
  ensureConversation(taskId: string): Promise<string>;
  /** Admit the destination instruction into one native conversation. */
  admit(input: { taskId: string; columnId: string; instruction: string; sessionId: string; requestId: string; entryId: string }): Promise<void>;
  /** Run the pending-transition dispatch after a reservation is released. */
  dispatchPending(): void;
  /** False while the application is shutting down or not initialized. */
  live(): boolean;
  /** True while the application is shutting down. */
  closing(): boolean;
  report?(error: unknown): void;
}

interface Reservation { readonly entryId: string; readonly deliveryId: string }

/**
 * The scripted-execution surface: the published summary, the native-context
 * admission reservation, and the destination-instruction dispatch.
 *
 * The reservation exists so one logical handoff never admits context twice in
 * different conversations of the same task. It is deliberately not a lock on the
 * agent turn or on the command lane.
 */
export class DeterministicSurface {
  private readonly reservations = new Map<string, Reservation>();
  private readonly deliveries = new Map<string, Promise<void>>();

  constructor(private readonly ports: DeterministicSurfacePorts) {}

  /** Every executing task's published summary, by task id. */
  summaries(): Record<string, DeterministicSummary> {
    const result: Record<string, DeterministicSummary> = {};
    const unavailable = this.ports.supervisor() === undefined;
    for (const { task, board } of this.ports.all()) {
      const value = task.deterministic;
      if (!value || task.stageEntry?.id !== value.entryId) continue;
      const saved = board.workflow.columns.find(column => column.id === task.columnId)?.deterministic;
      result[task.id] = {
        entryId: value.entryId, executionId: value.executionId, phase: unavailable ? 'failed' : value.phase,
        startedAt: value.startedAt, attempt: value.attempt, restartCount: value.restartCount,
        ...(value.parameters === undefined ? {} : { parameters: { ...value.parameters } }),
        ...(unavailable
          ? { error: { code: 'DETERMINISTIC_UNAVAILABLE', message: 'Mount the native filesystem, sandbox, shell, and function-body TypeScript capabilities to run deterministic steps.' } }
          : value.error ? { error: value.error } : {}),
        ...(value.result === undefined ? {} : {
          exit: value.result.exit, message: value.result.message,
          ...(value.result.deliveryStatus === undefined ? {} : { deliveryStatus: value.result.deliveryStatus }),
        }),
        ...(value.hold === undefined ? {} : { hold: value.hold }),
        ...(value.capture === undefined ? {} : { fingerprint: value.capture.fingerprint }),
        savedVersionChanged: !saved || !deterministicEqual(saved, value.definition),
      };
    }
    return result;
  }

  /** True while a conversation is admitting this task's destination context. */
  isReserved(taskId: string): boolean { return this.reservations.has(taskId); }

  /** Refuse a context change while a destination admission owns the task. */
  assertUnreserved(taskId: string): void {
    invariant(!this.reservations.has(taskId), 'NATIVE_ADMISSION_PENDING', 'Wait for native context admission before moving this task or changing its directory.');
  }

  /** Reserve native context admission for one handoff; the release clears it. */
  reserve(taskId: string, entryId: string, deliveryId: string): () => void {
    const task = this.ports.locate(taskId)?.task;
    invariant(task?.stageEntry?.id === entryId && task.deterministicHandoff?.id === deliveryId && !task.pendingTransition && !task.operation, 'STALE_HANDOFF', 'The destination entry was replaced before context admission.');
    invariant(!this.reservations.has(taskId), 'NATIVE_ADMISSION_PENDING', 'Another conversation is admitting context for this task.');
    const token: Reservation = { entryId, deliveryId };
    this.reservations.set(taskId, token);
    return () => {
      if (this.reservations.get(taskId) !== token) return;
      this.reservations.delete(taskId);
      this.ports.supervisor()?.reconcile(taskId);
      this.ports.dispatchPending();
    };
  }

  /** Record that the destination context was admitted for this handoff. */
  async accept(taskId: string, entryId: string, deliveryId: string): Promise<void> {
    if (this.ports.locate(taskId) === undefined) return;
    await this.ports.transact(taskId, task => {
      const handoff = task?.deterministicHandoff;
      if (!task || task.stageEntry?.id !== entryId || handoff?.id !== deliveryId || handoff.acceptedAt) return;
      handoff.acceptedAt = new Date().toISOString();
      delete handoff.error;
      recordDeterministicHandoff(task, {
        at: handoff.acceptedAt, deliveryId: handoff.id, executionId: handoff.executionId,
        fromColumnId: handoff.fromColumnId, columnId: task.columnId, outcome: 'accepted', exit: handoff.exit, message: handoff.message,
        ...(handoff.params === undefined ? {} : { parameters: handoff.params }),
      });
    });
  }

  /** Deliver every destination instruction a handoff is still waiting on. */
  async dispatch(): Promise<void> {
    if (!this.ports.live()) return;
    const jobs: Promise<void>[] = [];
    for (const { task } of this.ports.all()) {
      const handoff = task.deterministicHandoff;
      if (!handoff?.instruction || handoff.acceptedAt || handoff.error || task.stageEntry?.id !== handoff.entryId || task.operation || this.reservations.has(task.id)) continue;
      const existing = this.deliveries.get(task.id);
      if (existing !== undefined) { jobs.push(existing); continue; }
      const done = Promise.resolve().then(async () => {
        try {
          let current = this.ports.locate(task.id);
          if (current?.task.stageEntry?.id !== handoff.entryId || current.project.operation) return;
          const sessionId = handoff.sessionId ?? firstOpenSessionId(current.task) ?? await this.ports.ensureConversation(task.id);
          current = this.ports.locate(task.id);
          if (current?.task.stageEntry?.id !== handoff.entryId) return;
          await this.ports.transact(task.id, value => {
            if (value?.stageEntry?.id === handoff.entryId && value.deterministicHandoff?.id === handoff.id) value.deterministicHandoff.sessionId = sessionId;
          });
          await this.ports.admit({ taskId: task.id, columnId: current.task.columnId, instruction: handoff.instruction!, sessionId, requestId: handoff.id, entryId: handoff.entryId });
          await this.accept(task.id, handoff.entryId, handoff.id);
        } catch (error) {
          if (this.ports.closing()) return;
          const current = this.ports.locate(task.id);
          if (current === undefined) return;
          await this.ports.transact(task.id, value => {
            const record = value?.deterministicHandoff;
            if (!value || value.stageEntry?.id !== handoff.entryId || record?.id !== handoff.id || record.acceptedAt) return;
            record.error = problem(error);
            recordDeterministicHandoff(value, {
              at: new Date().toISOString(), deliveryId: record.id, executionId: record.executionId,
              fromColumnId: record.fromColumnId, columnId: record.columnId, outcome: 'failed', exit: record.exit, message: record.message,
              ...(record.params === undefined ? {} : { parameters: record.params }), error: record.error,
            });
          });
          this.ports.report?.(error);
        }
      }).finally(() => { this.deliveries.delete(task.id); });
      this.deliveries.set(task.id, done);
      jobs.push(done);
    }
    await Promise.all(jobs);
  }
}
