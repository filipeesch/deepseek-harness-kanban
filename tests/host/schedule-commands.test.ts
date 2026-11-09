import { describe, expect, it } from 'vitest';
import { fixture } from './helpers.js';
import type { ScheduleRuntimePort } from '../../src/host/schedule-port.js';

async function harness() {
  const value = await fixture();
  const runtime = {
    runNowCalls: [] as Array<{ hubId: string; scheduleId: string }>,
    deleted: [] as string[],
    runtime: {},
    catalogCalls: 0,
    failRunNow: undefined as Error | undefined,
  };
  const port: ScheduleRuntimePort = {
    runNow: async (hubId, scheduleId) => {
      if (runtime.failRunNow !== undefined) throw runtime.failRunNow;
      runtime.runNowCalls.push({ hubId, scheduleId });
    },
    scheduleDeleted: async scheduleId => { runtime.deleted.push(scheduleId); },
    runtime: () => runtime.runtime,
    modelCatalog: async () => { runtime.catalogCalls += 1; return { default: { provider: 'deepseek', model: 'chat' }, providers: [], failures: [] }; },
  };
  value.app.attachScheduleRuntime(port);
  return { ...value, runtime };
}

function scheduleInput(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    title: 'Morning review', prompt: 'Summarize the pull requests.', cron: '0 9 * * *', timeZone: 'Europe/Lisbon',
    projectId, newConversation: true, archiveWhenIdle: true, ...overrides,
  };
}

describe('schedule commands', () => {
  it('creates a schedule and returns its creation receipt', async () => {
    const harnessed = await harness();
    const hubId = harnessed.hubs.defaultHubId();
    const result = await harnessed.app.command({ type: 'schedule.save', hubId, ...scheduleInput(harnessed.project.id) } as never);
    const receipt = result.commandReceipt;
    expect(receipt?.kind).toBe('schedule');
    const stored = harnessed.hubs.requireHub(hubId).schedules ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(receipt?.id);
    expect(stored[0]!.cron).toBe('0 9 * * *');
    await harnessed.close();
  });

  it('updates, pauses, and deletes a schedule', async () => {
    const harnessed = await harness();
    const hubId = harnessed.hubs.defaultHubId();
    const created = await harnessed.app.command({ type: 'schedule.save', hubId, ...scheduleInput(harnessed.project.id) } as never);
    const scheduleId = created.commandReceipt!.id;
    await harnessed.app.command({ type: 'schedule.save', hubId, scheduleId, ...scheduleInput(harnessed.project.id, { title: 'Weekly review', cron: '0 9 * * MON' }) } as never);
    expect(harnessed.hubs.requireHub(hubId).schedules?.[0]?.title).toBe('Weekly review');
    await harnessed.app.command({ type: 'schedule.setEnabled', hubId, scheduleId, enabled: false });
    expect(harnessed.hubs.requireHub(hubId).schedules?.[0]?.enabled).toBe(false);
    await expect(harnessed.app.command({ type: 'schedule.delete', hubId, scheduleId, confirmed: false })).rejects.toThrowError(/Confirm/);
    await harnessed.app.command({ type: 'schedule.delete', hubId, scheduleId, confirmed: true });
    expect('schedules' in harnessed.hubs.requireHub(hubId)).toBe(false);
    expect(harnessed.runtime.deleted).toEqual([scheduleId]);
    await harnessed.close();
  });

  it('rejects an invalid cron and a stale revision', async () => {
    const harnessed = await harness();
    const hubId = harnessed.hubs.defaultHubId();
    await expect(harnessed.app.command({ type: 'schedule.save', hubId, ...scheduleInput(harnessed.project.id, { cron: '61 * * * *' }) } as never)).rejects.toThrowError(/minute/);
    await harnessed.app.command({ type: 'schedule.save', hubId, ...scheduleInput(harnessed.project.id) } as never);
    await expect(harnessed.app.command({ type: 'schedule.save', hubId, ...scheduleInput(harnessed.project.id, { expectedRevision: 0 }) } as never)).rejects.toThrowError(/changed since this revision/);
    await harnessed.close();
  });

  it('runs a saved schedule now and surfaces the runtime rejection', async () => {
    const harnessed = await harness();
    const hubId = harnessed.hubs.defaultHubId();
    const created = await harnessed.app.command({ type: 'schedule.save', hubId, ...scheduleInput(harnessed.project.id) } as never);
    const scheduleId = created.commandReceipt!.id;
    await harnessed.app.command({ type: 'schedule.runNow', hubId, scheduleId });
    expect(harnessed.runtime.runNowCalls).toEqual([{ hubId, scheduleId }]);
    harnessed.runtime.failRunNow = Object.assign(new Error('This schedule is already running.'), { code: 'SCHEDULE_RUNNING' });
    await expect(harnessed.app.command({ type: 'schedule.runNow', hubId, scheduleId })).rejects.toThrowError(/already running/);
    await expect(harnessed.app.command({ type: 'schedule.runNow', hubId, scheduleId: 'missing' })).rejects.toThrowError(/does not exist/);
    await harnessed.close();
  });

  it('reports the missing runtime instead of pretending to run', async () => {
    const harnessed = await fixture();
    const hubId = harnessed.hubs.defaultHubId();
    const created = await harnessed.app.command({ type: 'schedule.save', hubId, ...scheduleInput(harnessed.project.id) } as never);
    await expect(harnessed.app.command({ type: 'schedule.runNow', hubId, scheduleId: created.commandReceipt!.id })).rejects.toThrowError(/unavailable/);
    await expect(harnessed.app.modelCatalog()).rejects.toThrowError(/unavailable/);
    await harnessed.close();
  });
});
