import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharingPollScheduler } from '../../src/host/sharing/scheduler.js';

interface FakeService {
  published: Array<{ hubId: string; intervalMinutes: number }>;
  checks: string[];
  busy: boolean;
  fail?: Error;
  service: {
    publishedHubs: () => Array<{ hubId: string; intervalMinutes: number }>;
    check: (hubId: string) => Promise<void>;
    busy: () => boolean;
  };
}

function fakeService(): FakeService {
  const state: FakeService = {
    published: [{ hubId: 'hub', intervalMinutes: 5 }],
    checks: [],
    busy: false,
    service: {
      publishedHubs: () => state.published.map(entry => ({ ...entry })),
      check: async hubId => {
        state.checks.push(hubId);
        if (state.fail) throw state.fail;
      },
      busy: () => state.busy,
    },
  };
  return state;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('publishing poll scheduler', () => {
  it('checks immediately and then at the configured interval', async () => {
    const fake = fakeService();
    const scheduler = new SharingPollScheduler({ service: fake.service });
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.checks).toEqual(['hub']);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fake.checks).toEqual(['hub', 'hub']);
    scheduler.dispose();
  });

  it('follows a per-Hub interval change', async () => {
    const fake = fakeService();
    const scheduler = new SharingPollScheduler({ service: fake.service });
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.checks).toHaveLength(1);
    fake.published[0]!.intervalMinutes = 10;
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.checks).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fake.checks).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fake.checks).toHaveLength(3);
    scheduler.dispose();
  });

  it('performs no automatic check when the interval is zero', async () => {
    const fake = fakeService();
    fake.published[0]!.intervalMinutes = 0;
    const scheduler = new SharingPollScheduler({ service: fake.service });
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fake.checks).toEqual([]);
    scheduler.dispose();
  });

  it('waits briefly while the Hub lane is busy', async () => {
    const fake = fakeService();
    const scheduler = new SharingPollScheduler({ service: fake.service });
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.checks).toHaveLength(1);
    fake.busy = true;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fake.checks).toHaveLength(1);
    fake.busy = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.checks).toHaveLength(2);
    scheduler.dispose();
  });

  it('reports a failed check and keeps the schedule', async () => {
    const fake = fakeService();
    fake.fail = new Error('unreachable');
    const reported: unknown[] = [];
    const scheduler = new SharingPollScheduler({ service: fake.service, report: error => reported.push(error) });
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toHaveLength(1);
    fake.fail = undefined;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fake.checks).toHaveLength(2);
    scheduler.dispose();
  });

  it('stops every timer on dispose', async () => {
    const fake = fakeService();
    const scheduler = new SharingPollScheduler({ service: fake.service });
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fake.checks).toHaveLength(1);
  });
});
