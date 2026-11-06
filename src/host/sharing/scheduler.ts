import type { HubSharingService } from './service.js';

export interface SharingPollSchedulerOptions {
  service: Pick<HubSharingService, 'publishedHubs' | 'check' | 'busy'>;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  report?: (error: unknown) => void;
  /** A due check waits briefly when the Hub lane is busy rather than dropping the tick. */
  busyRetryMs?: number;
}

interface Schedule { intervalMinutes: number; handle: unknown }

const BUSY_RETRY_MS = 5_000;

/**
 * Host-side automatic check scheduler. One timer per published Hub, driven by
 * that Hub's interval; `0` disables automatic checks. Timers are injectable so
 * tests can advance a fake clock.
 */
export class SharingPollScheduler {
  private readonly schedules = new Map<string, Schedule>();
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private disposed = false;

  constructor(private readonly options: SharingPollSchedulerOptions) {
    this.setTimer = options.setTimer ?? ((callback, ms) => { const handle = setTimeout(callback, ms); handle.unref?.(); return handle; });
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Reconcile the desired per-Hub schedules with the current publishing state. */
  sync(): void {
    if (this.disposed) return;
    const desired = new Map(this.options.service.publishedHubs().map(entry => [entry.hubId, entry.intervalMinutes]));
    for (const [hubId, schedule] of [...this.schedules]) {
      const interval = desired.get(hubId);
      if (interval === undefined || interval <= 0) { this.cancel(hubId); continue; }
      if (interval !== schedule.intervalMinutes) this.schedule(hubId, interval, 0);
    }
    for (const [hubId, interval] of desired) {
      if (interval <= 0 || this.schedules.has(hubId)) continue;
      this.schedule(hubId, interval, 0);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const hubId of [...this.schedules.keys()]) this.cancel(hubId);
  }

  private cancel(hubId: string): void {
    const schedule = this.schedules.get(hubId);
    if (!schedule) return;
    this.clearTimer(schedule.handle);
    this.schedules.delete(hubId);
  }

  private schedule(hubId: string, intervalMinutes: number, delayMs: number): void {
    if (this.disposed) return;
    this.cancel(hubId);
    if (intervalMinutes <= 0) return;
    const handle = this.setTimer(() => { void this.tick(hubId); }, delayMs);
    this.schedules.set(hubId, { intervalMinutes, handle });
  }

  private async tick(hubId: string): Promise<void> {
    if (this.disposed) return;
    const schedule = this.schedules.get(hubId);
    if (!schedule) return;
    if (this.options.service.busy(hubId)) {
      this.schedule(hubId, schedule.intervalMinutes, this.options.busyRetryMs ?? BUSY_RETRY_MS);
      return;
    }
    try { await this.options.service.check(hubId); }
    catch (error) { this.options.report?.(error); }
    if (this.disposed) return;
    const current = this.schedules.get(hubId);
    if (!current) return;
    this.schedule(hubId, current.intervalMinutes, current.intervalMinutes * 60_000);
  }
}
