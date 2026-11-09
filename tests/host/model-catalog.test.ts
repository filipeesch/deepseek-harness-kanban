import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import { createScheduleModelPort } from '../../src/host/schedule-model.js';

const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  routableProviders: ['deepseek'],
  groups: [{
    id: 'deepseek', name: 'DeepSeek',
    models: [{
      id: 'chat', name: 'Chat', description: 'Fast',
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
    }],
  }],
  failures: [{ id: 'other', name: 'Other', message: 'offline' }],
};

function harness(options: { fail?: boolean; catalog?: ModelCatalog } = {}) {
  let now = 1_000;
  const calls = { count: 0 };
  const ctx = {
    sessionController: {
      modelCatalog: async () => {
        calls.count += 1;
        if (options.fail === true) throw new Error('catalog offline');
        return options.catalog ?? catalog;
      },
    },
  } as unknown as Context;
  return { ctx, calls, setNow: (value: number) => { now = value; }, now: () => now };
}

describe('schedule model catalog projection', () => {
  it('projects providers, models, reasoning metadata, and failures', async () => {
    const port = createScheduleModelPort(harness().ctx);
    const value = await port.catalog();
    expect(value.default).toEqual({ provider: 'deepseek', model: 'chat' });
    expect(value.providers).toEqual([{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat', description: 'Fast', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }]);
    expect(value.failures).toEqual([{ id: 'other', name: 'Other', message: 'offline' }]);
  });

  it('caches within the TTL and rebuilds on refresh or expiry', async () => {
    let clock = 0;
    const harnessed = harness();
    const port = createScheduleModelPort(harnessed.ctx, { now: () => clock, ttlMs: 100 });
    await port.catalog();
    await port.catalog();
    expect(harnessed.calls.count).toBe(1);
    clock = 101;
    await port.catalog();
    expect(harnessed.calls.count).toBe(2);
    await port.catalog(true);
    expect(harnessed.calls.count).toBe(3);
  });

  it('propagates a catalog read failure to the editor', async () => {
    const port = createScheduleModelPort(harness({ fail: true }).ctx);
    await expect(port.catalog()).rejects.toThrow('catalog offline');
  });
});
