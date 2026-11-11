import { describe, expect, it } from 'vitest';
import { LaneRegistry } from '../../src/host/sharing/lanes.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('sharing lanes', () => {
  it('runs one Hub operations in submission order', async () => {
    const lanes = new LaneRegistry();
    const order: string[] = [];
    const first = lanes.run('hub', async () => { order.push('first:start'); await Promise.resolve(); order.push('first:end'); });
    const second = lanes.run('hub', async () => { order.push('second'); });
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not serialize two Hubs against each other', async () => {
    const lanes = new LaneRegistry();
    const gate = deferred<void>();
    const started: string[] = [];
    const blocked = lanes.run('one', async () => { started.push('one'); await gate.promise; });
    await lanes.run('two', async () => { started.push('two'); });
    gate.resolve();
    await blocked;
    expect(started).toEqual(['one', 'two']);
  });

  it('refuses a nested operation instead of deadlocking', async () => {
    const lanes = new LaneRegistry();
    await expect(lanes.run('hub', async () => lanes.run('hub', async () => undefined))).rejects.toThrow(expect.objectContaining({ code: 'SHARING_REENTRANT' }));
  });

  it('lets an exclusive caller reuse its own lane', async () => {
    const lanes = new LaneRegistry();
    const value = await lanes.run('hub', async () => lanes.exclusive('hub', async () => 7));
    expect(value).toBe(7);
    expect(await lanes.exclusive('hub', async () => 8)).toBe(8);
  });

  it('reports a lane as busy while queued and idle once drained', async () => {
    const lanes = new LaneRegistry();
    const gate = deferred<void>();
    const running = lanes.run('hub', async () => { await gate.promise; });
    expect(lanes.busy('hub')).toBe(true);
    const queued = lanes.run('hub', async () => undefined);
    expect(lanes.busy('hub')).toBe(true);
    gate.resolve();
    await Promise.all([running, queued]);
    expect(lanes.busy('hub')).toBe(false);
  });

  it('notifies once when the lane becomes busy and once when it drains', async () => {
    let changes = 0;
    const lanes = new LaneRegistry({ onChange: () => { changes += 1; } });
    const gate = deferred<void>();
    const running = lanes.run('hub', async () => { await gate.promise; });
    const queued = lanes.run('hub', async () => undefined);
    expect(changes).toBe(1);
    gate.resolve();
    await Promise.all([running, queued]);
    expect(changes).toBe(2);
  });

  it('leaves the lane context so work scheduled from it is not treated as nested', async () => {
    const lanes = new LaneRegistry();
    let schedule: (() => Promise<string>) | undefined;
    await lanes.run('hub', async () => {
      // A timer scheduled inside a lane runs later; it must not inherit the lane.
      lanes.outside(() => { schedule = () => lanes.run('hub', async () => 'outside'); });
    });
    expect(schedule).toBeDefined();
    await expect(schedule!()).resolves.toBe('outside');
  });

  it('waits for every lane when closed and refuses new work', async () => {
    const lanes = new LaneRegistry();
    const gate = deferred<void>();
    let finished = false;
    const running = lanes.run('hub', async () => { await gate.promise; finished = true; });
    const closing = lanes.close();
    gate.resolve();
    await Promise.all([running, closing]);
    expect(finished).toBe(true);
    expect(() => lanes.run('hub', async () => undefined)).toThrow(expect.objectContaining({ code: 'PLUGIN_DISPOSED' }));
  });
});
