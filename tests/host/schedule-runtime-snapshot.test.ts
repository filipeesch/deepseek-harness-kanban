import { describe, expect, it } from 'vitest';
import { ScheduleModelCatalogSchema } from '../../src/remote.js';
import { ScheduleRunRegistry } from '../../src/host/schedule-runs.js';
import { fixture } from './helpers.js';
import { memoryRunStorage } from './schedule-helpers.js';
import type { ScheduleRuntimePort } from '../../src/host/schedule-port.js';
import type { ScheduleModelCatalog } from '../../src/shared/types.js';

const catalog: ScheduleModelCatalog = { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }], failures: [] };

describe('schedule runtime projection', () => {
  it('publishes the live registry without changing the state revision', async () => {
    const harnessed = await fixture();
    const opened = await memoryRunStorage();
    const registry = new ScheduleRunRegistry({ storage: opened.storage, now: () => '2026-01-01T09:00:00.000Z' });
    const port: ScheduleRuntimePort = {
      runNow: async () => {},
      scheduleDeleted: async scheduleId => { await registry.remove(scheduleId); },
      runtime: () => registry.runtimeByHub(),
      modelCatalog: async () => catalog,
    };
    harnessed.app.attachScheduleRuntime(port);
    const hubId = harnessed.hubs.defaultHubId();
    const first = await harnessed.app.snapshot({}, 'cache');
    const revision = first.stateRevision;
    await registry.begin(hubId, 'schedule', false);
    const running = await harnessed.app.snapshot({}, 'cache');
    expect(running.scheduleRuntime?.[hubId]?.schedule).toEqual({ running: true });
    await registry.finish('schedule', { status: 'sent', at: '2026-01-01T09:00:00.000Z', manual: false, sessionId: 'session' });
    const finished = await harnessed.app.snapshot({}, 'cache');
    expect(finished.stateRevision).toBe(revision);
    expect(finished.stateRevision).toBe(running.stateRevision);
    expect(finished.scheduleRuntime?.[hubId]?.schedule).toEqual({ running: false, lastRun: { status: 'sent', at: '2026-01-01T09:00:00.000Z', manual: false, sessionId: 'session' } });
    expect(await harnessed.app.modelCatalog()).toEqual(catalog);
    expect(ScheduleModelCatalogSchema.safeParse(catalog).success).toBe(true);
    await opened.close();
    await harnessed.close();
  });

  it('omits the runtime field when no schedule has run state', async () => {
    const harnessed = await fixture();
    const port: ScheduleRuntimePort = {
      runNow: async () => {},
      scheduleDeleted: async () => {},
      runtime: () => ({}),
      modelCatalog: async () => catalog,
    };
    harnessed.app.attachScheduleRuntime(port);
    expect('scheduleRuntime' in await harnessed.app.snapshot({}, 'cache')).toBe(false);
    await harnessed.close();
  });

  it('rejects a malformed catalog payload at the transport boundary', () => {
    expect(ScheduleModelCatalogSchema.safeParse({ default: { provider: '', model: 'chat' }, providers: [], failures: [] }).success).toBe(false);
    expect(ScheduleModelCatalogSchema.safeParse({ ...catalog, extra: true }).success).toBe(false);
  });
});
