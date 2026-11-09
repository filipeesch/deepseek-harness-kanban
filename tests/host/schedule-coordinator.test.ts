import { describe, expect, it } from 'vitest';
import type { HubSchedule } from '../../src/shared/types.js';
import { ScheduleCoordinator, type ScheduledEntry } from '../../src/host/schedule-coordinator.js';

interface FakeTimer { at: number; run: () => void; cancelled: boolean; fired: boolean }

function schedule(overrides: Partial<HubSchedule> = {}): HubSchedule {
  return {
    id: 'schedule', title: 'Schedule', prompt: 'Do work', cron: '* * * * *', timeZone: 'UTC', projectId: 'project',
    newConversation: true, archiveWhenIdle: true, enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function harness(entries: ScheduledEntry[], options: { maxDelayMs?: number } = {}) {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const timers: FakeTimer[] = [];
  const pending: Array<() => void> = [];
  const running = new Set<string>();
  const calls: Array<{ hubId: string; scheduleId: string; manual: boolean; occurrenceAt: string }> = [];
  const errors: unknown[] = [];
  const timer = {
    schedule(run: () => void, delay: number) { const value: FakeTimer = { at: now + delay, run, cancelled: false, fired: false }; timers.push(value); return value; },
    cancel(handle: unknown) { (handle as FakeTimer).cancelled = true; },
  };
  const coordinator = new ScheduleCoordinator({
    clock: () => now,
    timer,
    schedules: () => entries,
    run: request => {
      calls.push(request);
      running.add(request.scheduleId);
      return new Promise<void>(resolve => { pending.push(() => { running.delete(request.scheduleId); resolve(); }); });
    },
    isRunning: scheduleId => running.has(scheduleId),
    report: error => errors.push(error),
    ...(options.maxDelayMs === undefined ? {} : { maxDelayMs: options.maxDelayMs }),
  });
  function active(): FakeTimer[] { return timers.filter(value => !value.cancelled && !value.fired).sort((left, right) => left.at - right.at); }
  function advance(): void {
    const next = active()[0];
    if (next === undefined) throw new Error('no active timer');
    now = Math.max(now, next.at);
    next.fired = true;
    next.run();
  }
  async function settle(): Promise<void> { for (const resolve of pending.splice(0)) resolve(); await Promise.resolve(); }
  return { coordinator, calls, errors, timers, advance, settle, now: () => now, active, running };
}

describe('ScheduleCoordinator', () => {
  it('arms the next occurrence, runs it once, and re-arms for the following one', async () => {
    const value = schedule();
    const harnessed = harness([{ hubId: 'hub', schedule: value }]);
    harnessed.coordinator.start();
    expect(harnessed.active()).toHaveLength(1);
    harnessed.advance();
    expect(harnessed.calls).toEqual([{ hubId: 'hub', scheduleId: 'schedule', manual: false, occurrenceAt: '2026-01-01T00:01:00.000Z' }]);
    expect(harnessed.active()).toHaveLength(1);
    expect(harnessed.active()[0]!.at).toBe(Date.parse('2026-01-01T00:02:00.000Z'));
    await harnessed.settle();
    harnessed.advance();
    expect(harnessed.calls).toHaveLength(2);
    expect(harnessed.calls[1]!.occurrenceAt).toBe('2026-01-01T00:02:00.000Z');
    harnessed.coordinator.dispose();
  });

  it('skips an occurrence while the previous run is still active and never queues it', async () => {
    const harnessed = harness([{ hubId: 'hub', schedule: schedule() }]);
    harnessed.coordinator.start();
    harnessed.advance();
    expect(harnessed.calls).toHaveLength(1);
    harnessed.advance();
    expect(harnessed.calls).toHaveLength(1);
    expect(harnessed.active()[0]!.at).toBe(Date.parse('2026-01-01T00:03:00.000Z'));
    await harnessed.settle();
    harnessed.advance();
    expect(harnessed.calls).toHaveLength(2);
    harnessed.coordinator.dispose();
  });

  it('runs now without moving the next scheduled occurrence and refuses twice', async () => {
    const harnessed = harness([{ hubId: 'hub', schedule: schedule() }]);
    harnessed.coordinator.start();
    const scheduled = harnessed.active()[0]!.at;
    harnessed.coordinator.runNow('hub', 'schedule');
    expect(harnessed.calls[0]).toMatchObject({ manual: true, occurrenceAt: '2026-01-01T00:00:00.000Z' });
    expect(harnessed.active()[0]!.at).toBe(scheduled);
    expect(() => harnessed.coordinator.runNow('hub', 'schedule')).toThrowError(/already running/);
    await harnessed.settle();
    harnessed.coordinator.dispose();
  });

  it('refuses run-now for a paused schedule and an unknown one', () => {
    const paused = schedule({ enabled: false });
    const harnessed = harness([{ hubId: 'hub', schedule: paused }]);
    harnessed.coordinator.start();
    expect(harnessed.active()).toHaveLength(0);
    expect(() => harnessed.coordinator.runNow('hub', 'schedule')).toThrowError(/Enable the schedule/);
    expect(() => harnessed.coordinator.runNow('hub', 'missing')).toThrowError(/does not exist/);
    harnessed.coordinator.dispose();
  });

  it('reconciles a changed expression, a pause, and a removal', () => {
    const value = schedule();
    const entries: ScheduledEntry[] = [{ hubId: 'hub', schedule: value }];
    const harnessed = harness(entries);
    harnessed.coordinator.start();
    const first = harnessed.active()[0]!;
    value.cron = '0 * * * *';
    harnessed.coordinator.sync();
    expect(first.cancelled).toBe(true);
    expect(harnessed.active()[0]!.at).toBe(Date.parse('2026-01-01T01:00:00.000Z'));
    value.enabled = false;
    harnessed.coordinator.sync();
    expect(harnessed.active()).toHaveLength(0);
    value.enabled = true;
    harnessed.coordinator.sync();
    expect(harnessed.active()).toHaveLength(1);
    entries.length = 0;
    harnessed.coordinator.sync();
    expect(harnessed.active()).toHaveLength(0);
    harnessed.coordinator.dispose();
  });

  it('clamps a long delay and re-arms the adopted occurrence', () => {
    const yearly = schedule({ cron: '0 0 1 1 *' });
    const harnessed = harness([{ hubId: 'hub', schedule: yearly }], { maxDelayMs: 1_000 });
    harnessed.coordinator.start();
    expect(harnessed.active()[0]!.at).toBe(Date.parse('2026-01-01T00:00:01.000Z'));
    harnessed.advance();
    expect(harnessed.calls).toHaveLength(0);
    expect(harnessed.active()[0]!.at).toBe(Date.parse('2026-01-01T00:00:02.000Z'));
    harnessed.coordinator.dispose();
  });

  it('reports a stored expression that never fires and arms nothing', () => {
    const broken = schedule({ cron: '0 0 30 2 *' });
    const harnessed = harness([{ hubId: 'hub', schedule: broken }]);
    harnessed.coordinator.start();
    expect(harnessed.active()).toHaveLength(0);
    expect(harnessed.errors).toHaveLength(1);
    harnessed.coordinator.dispose();
  });

  it('drains admitted executions before shutdown completes', async () => {
    const harnessed = harness([{ hubId: 'hub', schedule: schedule() }]);
    harnessed.coordinator.start();
    harnessed.advance();
    expect(harnessed.calls).toHaveLength(1);
    harnessed.coordinator.dispose();
    let settled = false;
    const draining = harnessed.coordinator.settle().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await harnessed.settle();
    await draining;
    expect(settled).toBe(true);
  });

  it('runs different schedules concurrently and disposes cleanly', async () => {
    const entries: ScheduledEntry[] = [
      { hubId: 'hub', schedule: schedule({ id: 'a' }) },
      { hubId: 'hub', schedule: schedule({ id: 'b' }) },
    ];
    const harnessed = harness(entries);
    harnessed.coordinator.start();
    expect(harnessed.active()).toHaveLength(2);
    harnessed.advance();
    harnessed.advance();
    expect(harnessed.calls.map(call => call.scheduleId).sort()).toEqual(['a', 'b']);
    harnessed.coordinator.dispose();
    expect(harnessed.active()).toHaveLength(0);
    await harnessed.settle();
  });
});
