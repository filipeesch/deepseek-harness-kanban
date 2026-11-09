import { KanbanError } from '../shared/errors.js';
import type { HubScheduleRuntime, ScheduleRunProblem, ScheduleRunView } from '../shared/types.js';
import type { ScheduleRunRecord, ScheduleRunStorage } from './schedule-run-storage.js';

/** The session a continuous schedule reuses, and the project it was created for. */
export interface ContinuousSessionBinding {
  readonly sessionId: string;
  readonly projectId: string;
  readonly projectPath: string;
}

export interface ScheduleRunRegistryOptions {
  storage: ScheduleRunStorage;
  now: () => string;
  /** Called after every observable runtime change so the host can publish it. */
  onChange?: () => void;
  report?: (error: unknown) => void;
}

/**
 * Owns schedule runtime state: which schedules are running and the last result
 * of each. It is the only writer of the run domain, keeps saves in submission
 * order, refuses work for deleted schedules, and never touches the Hub revision.
 */
export class ScheduleRunRegistry {
  private readonly records = new Map<string, ScheduleRunRecord>();
  private readonly running = new Set<string>();
  private readonly runningSessions = new Map<string, string>();
  private readonly pendingArchive = new Map<string, { sessionId: string; error: ScheduleRunProblem }>();
  /** Schedule identities deleted during this process; no late write may resurrect them. */
  private readonly deleted = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: ScheduleRunRegistryOptions) {
    for (const record of options.storage.loadAll()) this.records.set(record.scheduleId, record);
  }

  isRunning(scheduleId: string): boolean { return this.running.has(scheduleId); }

  record(scheduleId: string): ScheduleRunRecord | undefined {
    const value = this.records.get(scheduleId);
    return value === undefined ? undefined : structuredClone(value);
  }

  /** The runtime projection for one Hub; schedules without a record are omitted. */
  runtime(hubId: string): HubScheduleRuntime {
    const view: HubScheduleRuntime = {};
    for (const record of this.records.values()) {
      if (record.hubId !== hubId) continue;
      view[record.scheduleId] = {
        running: this.running.has(record.scheduleId),
        ...(record.lastRun === undefined ? {} : { lastRun: structuredClone(record.lastRun) }),
      };
    }
    return view;
  }

  /** Every Hub's projection, keyed by Hub identity. */
  runtimeByHub(): Record<string, HubScheduleRuntime> {
    const result: Record<string, HubScheduleRuntime> = {};
    const projected = new Set<string>();
    for (const record of this.records.values()) {
      if (projected.has(record.hubId)) continue;
      projected.add(record.hubId);
      result[record.hubId] = this.runtime(record.hubId);
    }
    return result;
  }

  /**
   * Reserve one occurrence and persist its running marker before any native
   * side effect. A duplicate admission and a deleted schedule are refused; a
   * failed durable write rolls the reservation back.
   */
  async begin(hubId: string, scheduleId: string, manual: boolean): Promise<ScheduleRunRecord> {
    if (this.disposed || this.deleted.has(scheduleId)) throw new KanbanError('SCHEDULE_DELETED', 'This schedule was deleted.');
    if (this.running.has(scheduleId)) throw new KanbanError('SCHEDULE_RUNNING', 'This schedule is already running.');
    const existing = this.records.get(scheduleId);
    const record: ScheduleRunRecord = {
      version: 1, hubId, scheduleId,
      running: { startedAt: this.options.now(), manual },
      ...(existing?.lastRun === undefined ? {} : { lastRun: existing.lastRun }),
      ...(existing?.continuousSession === undefined ? {} : { continuousSession: existing.continuousSession }),
    };
    this.running.add(scheduleId);
    this.records.set(scheduleId, record);
    this.changed();
    try {
      await this.enqueue(() => this.options.storage.save(record));
    } catch (error) {
      this.running.delete(scheduleId);
      if (existing === undefined) this.records.delete(scheduleId); else this.records.set(scheduleId, existing);
      this.changed();
      throw error;
    }
    return structuredClone(record);
  }

  /** Record the session the admitted occurrence created or reused. */
  async markSession(scheduleId: string, sessionId: string): Promise<void> {
    const existing = this.records.get(scheduleId);
    if (existing?.running === undefined || this.deleted.has(scheduleId)) return;
    const record: ScheduleRunRecord = { ...existing, running: { ...existing.running, sessionId } };
    this.records.set(scheduleId, record);
    this.runningSessions.set(scheduleId, sessionId);
    await this.enqueue(() => this.options.storage.save(record));
  }

  /** Record the finished outcome and release the admission slot. */
  async finish(scheduleId: string, outcome: ScheduleRunView): Promise<void> {
    this.running.delete(scheduleId);
    this.runningSessions.delete(scheduleId);
    const existing = this.records.get(scheduleId);
    if (existing === undefined || this.deleted.has(scheduleId)) { this.changed(); return; }
    const pending = this.pendingArchive.get(scheduleId);
    this.pendingArchive.delete(scheduleId);
    const archiveError = pending !== undefined && outcome.sessionId !== undefined && pending.sessionId === outcome.sessionId ? pending.error : undefined;
    const record: ScheduleRunRecord = {
      version: 1, hubId: existing.hubId, scheduleId,
      lastRun: { ...outcome, ...(archiveError === undefined ? {} : { archiveError }) },
      ...(existing.continuousSession === undefined ? {} : { continuousSession: existing.continuousSession }),
    };
    this.records.set(scheduleId, record);
    await this.enqueue(() => this.options.storage.save(record));
    this.changed();
  }

  continuousSession(scheduleId: string): ContinuousSessionBinding | undefined {
    const value = this.records.get(scheduleId)?.continuousSession;
    return value === undefined ? undefined : { ...value };
  }

  /** Remember the session a continuous schedule reuses, bound to its project. */
  async bindContinuousSession(hubId: string, scheduleId: string, binding: ContinuousSessionBinding): Promise<void> {
    if (this.deleted.has(scheduleId) || this.disposed) throw new KanbanError('SCHEDULE_DELETED', 'This schedule was deleted.');
    const existing = this.records.get(scheduleId);
    const record: ScheduleRunRecord = {
      version: 1, hubId, scheduleId, continuousSession: { ...binding },
      ...(existing?.running === undefined ? {} : { running: existing.running }),
      ...(existing?.lastRun === undefined ? {} : { lastRun: existing.lastRun }),
    };
    this.records.set(scheduleId, record);
    await this.enqueue(() => this.options.storage.save(record));
  }

  /**
   * Record an archive failure on the run it belongs to. A failure that arrives
   * before finalization is attached when the run finishes; a failure for an
   * older conversation is ignored so it cannot overwrite a newer last run.
   */
  async recordArchiveFailure(scheduleId: string, sessionId: string, error: unknown): Promise<void> {
    if (this.deleted.has(scheduleId) || this.disposed) return;
    const problem = scheduleRunProblem(error);
    const existing = this.records.get(scheduleId);
    if (existing?.lastRun?.sessionId === sessionId) {
      const record: ScheduleRunRecord = { ...existing, lastRun: { ...existing.lastRun, archiveError: problem } };
      this.records.set(scheduleId, record);
      await this.enqueue(() => this.options.storage.save(record));
      this.changed();
      return;
    }
    if (this.runningSessions.get(scheduleId) === sessionId) this.pendingArchive.set(scheduleId, { sessionId, error: problem });
  }

  /** Clear an archive failure after the same conversation finally archives. */
  async clearArchiveFailure(scheduleId: string, sessionId: string): Promise<void> {
    if (this.deleted.has(scheduleId) || this.disposed) return;
    if (this.pendingArchive.get(scheduleId)?.sessionId === sessionId) this.pendingArchive.delete(scheduleId);
    const existing = this.records.get(scheduleId);
    if (existing?.lastRun?.sessionId !== sessionId || existing.lastRun.archiveError === undefined) return;
    const { archiveError: _archiveError, ...lastRun } = existing.lastRun;
    const record: ScheduleRunRecord = { ...existing, lastRun };
    this.records.set(scheduleId, record);
    await this.enqueue(() => this.options.storage.save(record));
    this.changed();
  }

  /** Drop one schedule's runtime when the schedule itself is deleted. */
  async remove(scheduleId: string): Promise<void> {
    this.deleted.add(scheduleId);
    this.running.delete(scheduleId);
    this.runningSessions.delete(scheduleId);
    this.pendingArchive.delete(scheduleId);
    if (!this.records.delete(scheduleId)) { this.changed(); return; }
    await this.enqueue(() => this.options.storage.delete(scheduleId));
    this.changed();
  }

  /** Drop runtime whose Hub no longer exists. */
  async pruneHubs(existing: ReadonlySet<string>): Promise<void> {
    await this.prune(record => existing.has(record.hubId));
  }

  /** Drop runtime whose schedule no longer exists; a record cannot outlive its configuration. */
  async pruneSchedules(existing: ReadonlySet<string>): Promise<void> {
    await this.prune(record => existing.has(record.scheduleId));
  }

  /**
   * A run that never finished was interrupted by a host shutdown. It becomes a
   * failed last run so the schedule does not claim success it never observed.
   */
  async finalizeInterrupted(): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (record.running === undefined || this.running.has(record.scheduleId)) continue;
      const next: ScheduleRunRecord = {
        version: 1, hubId: record.hubId, scheduleId: record.scheduleId,
        lastRun: {
          status: 'failed', at: this.options.now(), manual: record.running.manual,
          ...(record.running.sessionId === undefined ? {} : { sessionId: record.running.sessionId }),
          error: { code: 'SCHEDULE_RUN_INTERRUPTED', message: 'The host stopped before this occurrence finished.' },
        },
        ...(record.continuousSession === undefined ? {} : { continuousSession: record.continuousSession }),
      };
      this.records.set(record.scheduleId, next);
      await this.enqueue(() => this.options.storage.save(next));
    }
    this.changed();
  }

  /** Resolve after every queued write settled. */
  async settle(): Promise<void> { await this.tail; }

  dispose(): void { this.disposed = true; }

  private async prune(keep: (record: ScheduleRunRecord) => boolean): Promise<void> {
    let removed = false;
    for (const record of [...this.records.values()]) {
      if (keep(record)) continue;
      this.deleted.add(record.scheduleId);
      this.running.delete(record.scheduleId);
      this.runningSessions.delete(record.scheduleId);
      this.pendingArchive.delete(record.scheduleId);
      this.records.delete(record.scheduleId);
      removed = true;
      await this.enqueue(() => this.options.storage.delete(record.scheduleId));
    }
    if (removed) this.changed();
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const run = this.tail.then(write);
    this.tail = run.then(() => undefined, error => { this.options.report?.(error); });
    return run;
  }

  private changed(): void {
    if (this.disposed) return;
    this.options.onChange?.();
  }
}

function scheduleRunProblem(error: unknown): ScheduleRunProblem {
  const record = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown; details?: unknown } : undefined;
  const details: Record<string, string | number | boolean> = {};
  if (typeof record?.details === 'object' && record.details !== null) {
    for (const [key, value] of Object.entries(record.details as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') details[key] = value;
      else if (value !== undefined && value !== null) details[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  }
  return {
    code: typeof record?.code === 'string' && record.code.trim() ? record.code : 'SCHEDULE_ARCHIVE_FAILED',
    message: typeof record?.message === 'string' && record.message.trim() ? record.message : 'The conversation could not be archived.',
    ...(Object.keys(details).length === 0 ? {} : { details }),
  };
}
