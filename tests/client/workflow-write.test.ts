import { describe, expect, it, vi } from 'vitest';
import { workflowWriteQueue } from '../../src/client/workflow-write.js';

describe('workflow write queue', () => {
  it('runs writes in the order they were queued', async () => {
    const queue = workflowWriteQueue(1);
    const order: string[] = [];
    const slow = queue.write(async () => { await new Promise(resolve => setTimeout(resolve, 5)); order.push('first'); });
    const fast = queue.write(async () => { order.push('second'); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
  });

  it('targets the revision the previous write acknowledged', async () => {
    const queue = workflowWriteQueue(3);
    const targeted: number[] = [];
    await queue.write(async () => { targeted.push(queue.revision()); queue.adopt(4); });
    await queue.write(async () => { targeted.push(queue.revision()); queue.adopt(5); });
    await queue.write(async () => { targeted.push(queue.revision()); });
    expect(targeted).toEqual([3, 4, 5]);
  });

  it('never moves the target backwards and ignores a missing revision', () => {
    const queue = workflowWriteQueue(5);
    queue.adopt(4);
    queue.adopt(undefined);
    queue.adopt(Number.NaN);
    expect(queue.revision()).toBe(5);
  });

  it('keeps running after a rejected write', async () => {
    const queue = workflowWriteQueue(1);
    const failing = queue.write(async () => { throw new Error('rejected'); });
    const next = queue.write(async () => 'ran');
    await expect(failing).rejects.toThrow('rejected');
    await expect(next).resolves.toBe('ran');
  });

  it('resolves drain once every queued write settled', async () => {
    const queue = workflowWriteQueue(1);
    const seen = vi.fn();
    queue.write(async () => { await new Promise(resolve => setTimeout(resolve, 5)); seen(); });
    await queue.drain();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('drains a queue whose write rejected', async () => {
    const queue = workflowWriteQueue(1);
    void queue.write(async () => { throw new Error('rejected'); });
    await expect(queue.drain()).resolves.toBeUndefined();
  });
});
