import { describe, expect, it, vi } from 'vitest';
import { createStageDelivery, type StageDeliveryDeps } from '../../src/host/stage-delivery.js';

const delivery = { requestId: 'request-1', text: 'Review it.', summary: 'Stage: REVIEW' };

function recorded(requestId: string): unknown {
  return { type: 'user/message', data: { id: 'message-1', source: { kind: 'stage-instruction', form: 'notice', summary: 'Stage: REVIEW', requestId } } };
}

function target(pending: (deliveryId: string) => boolean) {
  return { pending };
}

function deps(overrides: Partial<StageDeliveryDeps<ReturnType<typeof target>>> = {}): StageDeliveryDeps<ReturnType<typeof target>> {
  return {
    resolve: async () => target(() => false),
    events: async () => [],
    deliver: async () => {},
    ...overrides,
  };
}

describe('stage instruction delivery', () => {
  it('delivers a fresh identity once', async () => {
    const deliver = vi.fn(async () => {});
    const send = createStageDelivery(deps({ deliver }));
    await send('s1', delivery);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ pending: expect.any(Function) }), delivery);
  });

  it('skips an identity the log already records', async () => {
    const deliver = vi.fn(async () => {});
    const send = createStageDelivery(deps({ deliver, events: async () => [recorded('request-1')] }));
    await send('s1', delivery);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivers again when only another identity is recorded', async () => {
    const deliver = vi.fn(async () => {});
    const send = createStageDelivery(deps({ deliver, events: async () => [recorded('request-2')] }));
    await send('s1', delivery);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('skips an identity the resolved inbox restored from a cold conversation', async () => {
    const deliver = vi.fn(async () => {});
    const events = vi.fn(async () => []);
    const resolve = vi.fn(async () => target(id => id === 'request-1'));
    const send = createStageDelivery(deps({ deliver, events, resolve }));
    await send('s1', delivery);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it('resolves the conversation before reading the durable log', async () => {
    const order: string[] = [];
    const send = createStageDelivery(deps({
      resolve: async () => { order.push('resolve'); return target(() => false); },
      events: async () => { order.push('events'); return []; },
      deliver: async () => { order.push('deliver'); },
    }));
    await send('s1', delivery);
    expect(order).toEqual(['resolve', 'events', 'deliver']);
  });

  it('rechecks the resolved inbox after the durable read', async () => {
    const deliver = vi.fn(async () => {});
    let pending = false;
    const send = createStageDelivery(deps({
      deliver,
      resolve: async () => target(() => pending),
      events: async () => { pending = true; return []; },
    }));
    await send('s1', delivery);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('joins a concurrent duplicate instead of delivering twice', async () => {
    let release = (): void => {};
    const gate = new Promise<void>(resolveGate => { release = resolveGate; });
    const deliver = vi.fn(async () => { await gate; });
    const send = createStageDelivery(deps({ deliver }));
    const first = send('s1', delivery);
    const second = send('s1', delivery);
    release();
    await Promise.all([first, second]);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('reports a failed delivery and allows a later retry', async () => {
    const deliver = vi.fn<(value: ReturnType<typeof target>, entry: typeof delivery) => Promise<void>>();
    deliver.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const send = createStageDelivery(deps({ deliver }));
    await expect(send('s1', delivery)).rejects.toThrow('boom');
    await send('s1', delivery);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('keeps conversations independent for the same identity', async () => {
    const deliver = vi.fn(async () => {});
    const send = createStageDelivery(deps({ deliver }));
    await send('s1', delivery);
    await send('s2', delivery);
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
