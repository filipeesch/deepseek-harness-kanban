import { describe, expect, it } from 'vitest';
import { OperationQueue } from '../../src/host/operation-queue.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('OperationQueue', () => {
  it('runs jobs in admission order, one at a time', async () => {
    const queue = new OperationQueue(); const order: string[] = [];
    const first = deferred();
    queue.enqueue({ taskId: 'a', operationId: '1', run: async () => { order.push('a'); await first.promise; } });
    queue.enqueue({ taskId: 'b', operationId: '2', run: async () => { order.push('b'); } });
    await Promise.resolve();
    expect(order).toEqual(['a']);
    first.resolve();
    await queue.settle();
    expect(order).toEqual(['a', 'b']);
  });

  it('deduplicates the same operation and settles after disposal', async () => {
    const queue = new OperationQueue(); const gate = deferred(); let started = 0;
    expect(queue.enqueue({ taskId: 'a', operationId: '1', run: async () => { started += 1; await gate.promise; } })).toBe(true);
    expect(queue.enqueue({ taskId: 'a', operationId: '1', run: async () => { started += 1; } })).toBe(true);
    queue.enqueue({ taskId: 'b', operationId: '2', run: async () => { started += 1; } });
    queue.dispose();
    gate.resolve();
    await queue.settle();
    expect(started).toBe(1);
    expect(queue.enqueue({ taskId: 'c', operationId: '3', run: async () => {} })).toBe(false);
  });
});
