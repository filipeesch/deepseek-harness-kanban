import { describe, expect, it } from 'vitest';
import { OperationQueue } from '../../src/host/operation-queue.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('OperationQueue', () => {
  it('runs jobs in admission order, one at a time per lane', async () => {
    const queue = new OperationQueue(); const order: string[] = [];
    const first = deferred();
    queue.enqueue({ lane: 'repo', taskId: 'a', operationId: '1', run: async () => { order.push('a'); await first.promise; } });
    queue.enqueue({ lane: 'repo', taskId: 'b', operationId: '2', run: async () => { order.push('b'); } });
    await Promise.resolve();
    expect(order).toEqual(['a']);
    first.resolve();
    await queue.settle();
    expect(order).toEqual(['a', 'b']);
  });

  it('overlaps different lanes and keeps a busy lane queueing', async () => {
    const queue = new OperationQueue(); const order: string[] = [];
    const release = deferred();
    queue.enqueue({ lane: 'repo-a', taskId: 'a', operationId: '1', run: async () => { order.push('a'); await release.promise; } });
    queue.enqueue({ lane: 'repo-a', taskId: 'b', operationId: '2', run: async () => { order.push('b'); } });
    queue.enqueue({ lane: 'repo-b', taskId: 'c', operationId: '3', run: async () => { order.push('c'); } });
    await Promise.resolve();
    expect(order).toEqual(['a', 'c']);
    // One running job per lane plus the job queued behind lane A.
    expect(queue.size).toBe(3);
    release.resolve();
    await queue.settle();
    expect(order).toEqual(['a', 'c', 'b']);
    expect(queue.size).toBe(0);
  });

  it('deduplicates the same operation and settles after disposal', async () => {
    const queue = new OperationQueue(); const gate = deferred(); let started = 0;
    expect(queue.enqueue({ lane: 'repo', taskId: 'a', operationId: '1', run: async () => { started += 1; await gate.promise; } })).toBe(true);
    expect(queue.enqueue({ lane: 'repo', taskId: 'a', operationId: '1', run: async () => { started += 1; } })).toBe(true);
    queue.enqueue({ lane: 'repo', taskId: 'b', operationId: '2', run: async () => { started += 1; } });
    queue.dispose();
    gate.resolve();
    await queue.settle();
    expect(started).toBe(1);
    expect(queue.enqueue({ lane: 'repo', taskId: 'c', operationId: '3', run: async () => {} })).toBe(false);
  });

  it('keeps a lane alive when a job rejects and still runs the next job', async () => {
    const queue = new OperationQueue(); const order: string[] = [];
    queue.enqueue({ lane: 'repo', taskId: 'a', operationId: '1', run: async () => { throw new Error('boom'); } });
    queue.enqueue({ lane: 'repo', taskId: 'b', operationId: '2', run: async () => { order.push('b'); } });
    await queue.settle();
    expect(order).toEqual(['b']);
    expect(queue.size).toBe(0);
  });

  it('drops a not-yet-started job on disposal so it stays queued for a restart', async () => {
    const queue = new OperationQueue(); const gate = deferred(); const started: string[] = [];
    queue.enqueue({ lane: 'repo', taskId: 'a', operationId: '1', run: async () => { started.push('a'); await gate.promise; } });
    queue.enqueue({ lane: 'repo', taskId: 'b', operationId: '2', run: async () => { started.push('b'); } });
    queue.dispose();
    gate.resolve();
    await queue.settle();
    expect(started).toEqual(['a']);
  });

  it('settles after disposal only once the running job finishes', async () => {
    const queue = new OperationQueue(); const gate = deferred(); let finished = false; let settled = false;
    queue.enqueue({ lane: 'repo', taskId: 'a', operationId: '1', run: async () => { await gate.promise; finished = true; } });
    queue.dispose();
    const settling = queue.settle().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    await settling;
    expect(finished).toBe(true);
    expect(settled).toBe(true);
  });
});
