import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishScheduler } from '../../src/host/publish-scheduler.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('host publication coalescing', () => {
  it('publishes leading, coalesces a burst, and publishes the final state once', async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const scheduler = new PublishScheduler({ publish, windowMs: 50 });
    scheduler.request();
    expect(publish).toHaveBeenCalledOnce();
    scheduler.request();
    scheduler.request();
    expect(publish).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);
    expect(publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('bounds a continuous burst to one publication per window', async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const scheduler = new PublishScheduler({ publish, windowMs: 50 });
    for (let index = 0; index < 10; index += 1) {
      scheduler.request();
      await vi.advanceTimersByTimeAsync(5);
    }
    expect(publish.mock.calls.length).toBeLessThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(500);
    scheduler.dispose();
  });

  it('flushes a dirty state immediately and stops after disposal', async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const scheduler = new PublishScheduler({ publish, windowMs: 50 });
    scheduler.request();
    scheduler.request();
    scheduler.flush();
    expect(publish).toHaveBeenCalledTimes(2);
    scheduler.dispose();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
