import { describe, expect, it, vi } from 'vitest';
import { ConversationFactsCache, MAX_READ_RETRIES } from '../../src/host/conversation-facts-cache.js';
import type { ConversationFacts } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';

function facts(overrides: Partial<ConversationFacts> = {}): ConversationFacts {
  return { running: false, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null, ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('conversation facts cache', () => {
  it('reuses one read per conversation until it is invalidated', async () => {
    const source = { read: vi.fn(async () => facts()) };
    const cache = new ConversationFactsCache({ source });
    await cache.read('s1');
    await cache.read('s1');
    expect(source.read).toHaveBeenCalledTimes(1);
    cache.invalidate('s1');
    await cache.read('s1');
    expect(source.read).toHaveBeenCalledTimes(2);
  });

  it('keeps the last known facts when a transient read fails', async () => {
    const source = { read: vi.fn(async () => facts({ running: true })) };
    const cache = new ConversationFactsCache({ source });
    await cache.read('s1');
    source.read.mockRejectedValueOnce(new Error('transient'));
    cache.invalidate('s1');
    expect(await cache.read('s1')).toEqual(facts({ running: true }));
    await flush();
    expect(cache.resolvedFor(['s1']).s1).toEqual(facts({ running: true }));
    expect(cache.failedIds()).toEqual(['s1']);
  });

  it('retries a failed conversation only until the bounded allowance', async () => {
    const source = { read: vi.fn(async () => { throw new Error('unavailable'); }) };
    const cache = new ConversationFactsCache({ source });
    for (let attempt = 0; attempt < MAX_READ_RETRIES; attempt += 1) {
      cache.invalidate('s1');
      await cache.read('s1');
    }
    expect(cache.retrying()).toBe(false);
    expect(cache.failedIds()).toEqual([]);
  });

  it('does not let a late old read overwrite the newest successful projection', async () => {
    const old = deferred<ConversationFacts>();
    const source = { read: vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(facts({ running: false })) };
    const cache = new ConversationFactsCache({ source });
    const first = cache.read('s1');
    cache.invalidate('s1');
    const second = cache.read('s1');
    old.resolve(facts({ running: true }));
    await Promise.all([first, second]);
    await flush();
    expect(cache.resolvedFor(['s1']).s1).toEqual(facts({ running: false }));
  });

  it('does not re-queue a conversation whose background read failed', async () => {
    const source = { read: vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(facts()) };
    const cache = new ConversationFactsCache({ source });
    cache.ensure(['s1'], 'normal');
    await flush();
    expect(cache.failedIds()).toEqual(['s1']);
    // The publication caused by the failure must not start another immediate read.
    cache.ensure(['s1'], 'normal');
    await flush();
    expect(source.read).toHaveBeenCalledTimes(1);
  });

  it('prunes conversations no longer present on the board', async () => {
    const source = { read: vi.fn(async () => facts()) };
    const cache = new ConversationFactsCache({ source });
    await cache.read('s1');
    await cache.read('s2');
    cache.prune(new Set(['s1']));
    expect(cache.resolvedFor(['s1', 's2'])).toEqual({ s1: facts() });
  });
});

describe('background read queue', () => {
  it('resolves queued conversations by priority with one batch notification', async () => {
    const order: string[] = [];
    const first = deferred<ConversationFacts>();
    const source = { read: vi.fn(async (sessionId: string) => { order.push(sessionId); return sessionId === 'normal' ? first.promise : facts(); }) };
    const notify = vi.fn();
    const cache = new ConversationFactsCache({ source, notify, concurrency: 1 });
    cache.ensure(['normal'], 'normal');
    cache.ensure(['historical'], 'historical');
    cache.ensure(['active'], 'active');
    await flush();
    expect(order).toEqual(['normal']);
    first.resolve(facts());
    await flush();
    expect(order).toEqual(['normal', 'active', 'historical']);
    expect(cache.resolvedFor(['active', 'normal', 'historical'])).toEqual({ active: facts(), normal: facts(), historical: facts() });
  });

  it('publishes one batch notification when a wave of reads resolves together', async () => {
    const gates = Array.from({ length: 4 }, () => deferred<ConversationFacts>());
    const source = { read: vi.fn((sessionId: string) => gates[Number(sessionId.slice(1))]!.promise) };
    const notify = vi.fn();
    const cache = new ConversationFactsCache({ source, notify, concurrency: 4 });
    cache.ensure(['s0', 's1', 's2', 's3'], 'normal');
    await flush();
    for (const gate of gates) gate.resolve(facts());
    await flush();
    expect(notify).toHaveBeenCalledOnce();
  });

  it('bounds how many background reads run at once', async () => {
    let activeReads = 0;
    let peak = 0;
    const gates = Array.from({ length: 4 }, () => deferred<ConversationFacts>());
    const source = { read: vi.fn(async (sessionId: string) => { activeReads += 1; peak = Math.max(peak, activeReads); const value = await gates[Number(sessionId.slice(1))]!.promise; activeReads -= 1; return value; }) };
    const cache = new ConversationFactsCache({ source, concurrency: 2 });
    cache.ensure(['s0', 's1', 's2', 's3'], 'normal');
    await flush();
    expect(peak).toBe(2);
    for (const gate of gates) gate.resolve(facts());
    await flush();
    expect(cache.resolvedFor(['s0', 's1', 's2', 's3'])).toHaveProperty('s3');
  });

  it('does not leak a worker slot when a queued conversation starts directly', async () => {
    const gates = Array.from({ length: 3 }, () => deferred<ConversationFacts>());
    const source = { read: vi.fn((sessionId: string) => gates[Number(sessionId.slice(1))]!.promise) };
    const cache = new ConversationFactsCache({ source, concurrency: 1 });
    cache.ensure(['s0', 's1'], 'normal');
    await flush();
    const direct = cache.read('s1');
    await flush();
    gates[0]!.resolve(facts());
    await flush();
    cache.ensure(['s2'], 'normal');
    await flush();
    expect(source.read).toHaveBeenCalledWith('s2');
    gates[1]!.resolve(facts());
    gates[2]!.resolve(facts());
    await direct;
    await flush();
    expect(cache.resolvedFor(['s0', 's1', 's2'])).toEqual({ s0: facts(), s1: facts(), s2: facts() });
  });

  it('never starts a queued read after disposal', async () => {
    const source = { read: vi.fn(async () => facts()) };
    const cache = new ConversationFactsCache({ source });
    cache.dispose();
    cache.ensure(['s1'], 'normal');
    await flush();
    expect(source.read).not.toHaveBeenCalled();
  });
});
