import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { HubRepository } from '../../src/host/hub-repository.js';
import { openHubSharing } from '../../src/index.js';
import { MemoryHubStorage } from './helpers.js';

function facility() {
  let closings = 0;
  const ctx = {
    storageDomain: {
      async open() {
        return {
          table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator](), keys: () => [][Symbol.iterator](), get size() { return 0; }, put: async () => {}, delete: async () => {}, update: async () => {} }),
          close: async () => { closings++; },
        };
      },
    },
  } as unknown as Context;
  return { ctx, get closings() { return closings; } };
}

afterEach(() => { vi.useRealTimers(); });

describe('publishing runtime wiring', () => {
  it('opens the publishing domain and closes the domain and timers as one unit', async () => {
    vi.useFakeTimers();
    const f = facility();
    const hubs = await HubRepository.open(new MemoryHubStorage());
    const runtime = await openHubSharing(f.ctx, hubs, { root: '/tmp/dsh-sharing-runtime', report: () => {} });
    expect(runtime.service.views()).toEqual({});
    runtime.scheduler.sync();
    await runtime.close();
    expect(f.closings).toBe(1);
    await hubs.close();
  });
});
