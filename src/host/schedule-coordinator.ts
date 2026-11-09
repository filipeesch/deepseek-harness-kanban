import { nextOccurrence } from '../domain/cron.js';
import { KanbanError } from '../shared/errors.js';
import type { HubSchedule } from '../shared/types.js';

/** One stored schedule and the Hub that owns it. */
export interface ScheduledEntry { readonly hubId: string; readonly schedule: HubSchedule }

/** Timer boundary, injectable so admission and re-arming are deterministic in tests. */
export interface ScheduleTimerPort {
  schedule(run: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface ScheduleCoordinatorOptions {
  clock: () => number;
  timer: ScheduleTimerPort;
  /** Every stored schedule, enabled or not, so a pause cancels its timer. */
  schedules: () => Iterable<ScheduledEntry>;
  run: (request: { hubId: string; scheduleId: string; manual: boolean; occurrenceAt: string }) => Promise<void>;
  /** Whether the runner is still active for a schedule. */
  isRunning: (scheduleId: string) => boolean;
  report?: (error: unknown) => void;
  /** Largest delay one timer may request; longer waits re-arm themselves. */
  maxDelayMs?: number;
}

interface Armed {
  readonly hubId: string;
  readonly expression: string;
  readonly timeZone: string;
  readonly dueAt: number;
  handle?: unknown;
}

const MAX_TIMER_DELAY = 2 ** 31 - 1;

/**
 * Owns one timer per enabled schedule and the admission rules around it: one
 * run per schedule, no queue, and the adopted occurrence runs once even when
 * its timer fired late. Configuration changes reconcile through `sync`.
 */
export class ScheduleCoordinator {
  private readonly armed = new Map<string, Armed>();
  private readonly starting = new Set<string>();
  private readonly admitted = new Set<Promise<void>>();
  private disposed = false;

  constructor(private readonly options: ScheduleCoordinatorOptions) {}

  start(): void { this.sync(); }

  /** Reconcile timers with the stored schedules: re-arm changed, cancel paused or removed. */
  sync(): void {
    if (this.disposed) return;
    const desired = new Map<string, ScheduledEntry>();
    for (const entry of this.options.schedules()) desired.set(entry.schedule.id, entry);
    for (const [scheduleId, armed] of [...this.armed]) {
      const entry = desired.get(scheduleId);
      if (entry === undefined || !entry.schedule.enabled || entry.schedule.cron !== armed.expression || entry.schedule.timeZone !== armed.timeZone) this.cancel(scheduleId);
    }
    for (const [scheduleId, entry] of desired) {
      if (!entry.schedule.enabled || this.armed.has(scheduleId)) continue;
      this.arm(scheduleId, entry);
    }
  }

  /** Run one saved schedule now; the scheduled occurrence is not moved. */
  runNow(hubId: string, scheduleId: string): void {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The schedule coordinator is shut down.');
    const entry = this.find(hubId, scheduleId);
    if (!entry.schedule.enabled) throw new KanbanError('SCHEDULE_PAUSED', 'Enable the schedule before running it.');
    if (this.isRunning(scheduleId)) throw new KanbanError('SCHEDULE_RUNNING', 'This schedule is already running.');
    this.launch(entry.hubId, scheduleId, true, this.options.clock());
  }

  isRunning(scheduleId: string): boolean {
    return this.starting.has(scheduleId) || this.options.isRunning(scheduleId);
  }

  dispose(): void {
    this.disposed = true;
    for (const scheduleId of [...this.armed.keys()]) this.cancel(scheduleId);
  }

  /** Resolve after every admitted execution settled; shutdown drains this before closing storage. */
  async settle(): Promise<void> {
    while (this.admitted.size > 0) await Promise.allSettled([...this.admitted]);
  }

  private find(hubId: string, scheduleId: string): ScheduledEntry {
    for (const entry of this.options.schedules()) {
      if (entry.hubId === hubId && entry.schedule.id === scheduleId) return entry;
    }
    throw new KanbanError('SCHEDULE_NOT_FOUND', 'Schedule does not exist in this Hub.');
  }

  private findStored(hubId: string, scheduleId: string): ScheduledEntry | undefined {
    for (const entry of this.options.schedules()) {
      if (entry.hubId === hubId && entry.schedule.id === scheduleId) return entry;
    }
    return undefined;
  }

  private arm(scheduleId: string, entry: ScheduledEntry): void {
    const due = nextOccurrence(entry.schedule.cron, entry.schedule.timeZone, new Date(this.options.clock()));
    if (due === undefined) {
      this.options.report?.(new KanbanError('INVALID_CRON', 'The stored cron expression never fires.', { scheduleId }));
      return;
    }
    const record: Armed = { hubId: entry.hubId, expression: entry.schedule.cron, timeZone: entry.schedule.timeZone, dueAt: due.getTime() };
    this.armed.set(scheduleId, record);
    this.armTimer(scheduleId, record);
  }

  private armTimer(scheduleId: string, record: Armed): void {
    const delay = Math.max(0, record.dueAt - this.options.clock());
    const capped = Math.min(delay, this.options.maxDelayMs ?? MAX_TIMER_DELAY);
    record.handle = this.options.timer.schedule(() => { this.fire(scheduleId); }, capped);
  }

  private fire(scheduleId: string): void {
    if (this.disposed) return;
    const record = this.armed.get(scheduleId);
    if (record === undefined) return;
    record.handle = undefined;
    const entry = this.findStored(record.hubId, scheduleId);
    if (entry === undefined || !entry.schedule.enabled) { this.cancel(scheduleId); this.sync(); return; }
    if (record.dueAt > this.options.clock()) { this.armTimer(scheduleId, record); return; }
    if (this.isRunning(scheduleId)) { this.cancel(scheduleId); this.sync(); return; }
    const dueAt = record.dueAt;
    this.cancel(scheduleId);
    this.launch(record.hubId, scheduleId, false, dueAt);
    this.sync();
  }

  private cancel(scheduleId: string): void {
    const record = this.armed.get(scheduleId);
    if (record === undefined) return;
    if (record.handle !== undefined) this.options.timer.cancel(record.handle);
    this.armed.delete(scheduleId);
  }

  private launch(hubId: string, scheduleId: string, manual: boolean, occurrenceAtMs: number): void {
    this.starting.add(scheduleId);
    const occurrenceAt = new Date(occurrenceAtMs).toISOString();
    const task = this.options.run({ hubId, scheduleId, manual, occurrenceAt })
      .catch(error => this.options.report?.(error))
      .finally(() => { this.starting.delete(scheduleId); this.admitted.delete(task); });
    this.admitted.add(task);
  }
}
