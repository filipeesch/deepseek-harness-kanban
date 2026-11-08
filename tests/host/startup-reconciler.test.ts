import { describe, expect, it, vi } from 'vitest';
import { StartupReconciler } from '../../src/host/startup-reconciler.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('startup reconciler', () => {
  it('runs background jobs with bounded concurrency and settles', async () => {
    const running: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const job = () => { active += 1; peak = Math.max(peak, active); return new Promise<void>(resolve => { running.push(() => { active -= 1; resolve(); }); }); };
    const reconciler = new StartupReconciler({ concurrency: 2 });
    reconciler.run([job, job, job, job]);
    await flush();
    expect(peak).toBe(2);
    while (running.length > 0) {
      running.shift()!();
      await flush();
    }
    await reconciler.whenSettled();
    expect(active).toBe(0);
  });

  it('reports one failure and keeps the remaining jobs', async () => {
    const report = vi.fn();
    const done = vi.fn();
    const reconciler = new StartupReconciler({ report });
    reconciler.run([
      async () => { throw new Error('history unavailable'); },
      async () => { done(); },
    ]);
    await reconciler.whenSettled();
    expect(report).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight job before settling', async () => {
    const first = deferred();
    const reconciler = new StartupReconciler({ concurrency: 1 });
    reconciler.run([() => first.promise]);
    await flush();
    let settled = false;
    const settledPromise = reconciler.whenSettled().then(() => { settled = true; });
    reconciler.dispose();
    await flush();
    expect(settled).toBe(false);
    first.resolve();
    await settledPromise;
    expect(settled).toBe(true);
  });

  it('settles after an aborted job reports its failure', async () => {
    const report = vi.fn();
    const started = deferred();
    const signal = new AbortController();
    const reconciler = new StartupReconciler({ report, signal: signal.signal });
    reconciler.run([() => new Promise<void>((_resolve, reject) => {
      signal.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      started.resolve();
    })]);
    await started.promise;
    signal.abort();
    await reconciler.whenSettled();
    expect(report).toHaveBeenCalledOnce();
  });

  it('stops scheduling new jobs after disposal and still settles', async () => {
    const first = deferred();
    const second = vi.fn();
    const reconciler = new StartupReconciler({ concurrency: 1 });
    reconciler.run([() => first.promise, async () => { second(); }]);
    await flush();
    reconciler.dispose();
    first.resolve();
    await reconciler.whenSettled();
    expect(second).not.toHaveBeenCalled();
  });
});
