import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { openScheduleRunStorage, type ScheduleRunStorage } from '../../src/host/schedule-run-storage.js';
import { ScheduleRunRegistry } from '../../src/host/schedule-runs.js';

function fakeFacility() {
  const specs: Array<{ name: string; version: number; layout?: string }> = [];
  const state = new Map<string, Map<string, Map<string, unknown>>>();
  return {
    specs,
    async open(spec: { name: string; version: number; layout?: string; tables: Record<string, unknown> }) {
      specs.push(spec);
      let tables = state.get(spec.name);
      if (!tables) {
        tables = new Map();
        for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
        state.set(spec.name, tables);
      }
      return {
        name: spec.name,
        table(name: string) {
          const map = tables!.get(name);
          if (!map) throw new Error('Unknown table ' + name);
          return {
            get: (key: string) => map.get(key),
            entries: () => map.entries(),
            keys: () => map.keys(),
            get size() { return map.size; },
            put: async (key: string, value: unknown) => { map.set(key, structuredClone(value)); },
            delete: async (key: string) => map.delete(key),
            update: async () => { throw new Error('unused'); },
          };
        },
        async close() {},
      };
    },
  };
}

async function memoryStorage(): Promise<{ storage: ScheduleRunStorage; close: () => Promise<void> }> {
  const ctx = { storageDomain: fakeFacility() } as unknown as Context;
  return openScheduleRunStorage(ctx);
}

const now = () => '2026-01-01T00:00:00.000Z';

describe('schedule run storage', () => {
  it('declares a per-record schedule runtime domain and survives a reopen', async () => {
    const facility = fakeFacility();
    const ctx = { storageDomain: facility } as unknown as Context;
    const first = await openScheduleRunStorage(ctx);
    expect(facility.specs[0]).toMatchObject({ name: 'kanban_schedule_runs', version: 1, layout: 'per-record' });
    await first.storage.save({ version: 1, hubId: 'hub', scheduleId: 'schedule', continuousSessionId: 'session' });
    expect(first.storage.load('schedule')).toEqual({ version: 1, hubId: 'hub', scheduleId: 'schedule', continuousSessionId: 'session' });
    expect(first.storage.loadAll()).toHaveLength(1);
    await first.close();
    const second = await openScheduleRunStorage(ctx);
    expect(second.storage.loadAll()).toHaveLength(1);
    await second.storage.delete('schedule');
    expect(second.storage.loadAll()).toEqual([]);
    await second.close();
  });

  it('propagates a domain open failure so the plugin fails loud', async () => {
    const ctx = { storageDomain: { open: async () => { throw new Error('backend down'); } } } as unknown as Context;
    await expect(openScheduleRunStorage(ctx)).rejects.toThrow('backend down');
  });
});

describe('schedule run registry', () => {
  it('marks a run running before any session exists and records the outcome', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    expect(registry.isRunning('schedule')).toBe(false);
    await registry.begin('hub', 'schedule', false);
    expect(registry.isRunning('schedule')).toBe(true);
    expect(registry.runtime('hub').schedule).toEqual({ running: true });
    await registry.finish('schedule', { status: 'sent', at: now(), manual: false, sessionId: 'session' });
    expect(registry.isRunning('schedule')).toBe(false);
    expect(registry.runtime('hub').schedule).toEqual({ running: false, lastRun: { status: 'sent', at: now(), manual: false, sessionId: 'session' } });
    await registry.settle();
    expect(storage.load('schedule')?.lastRun?.status).toBe('sent');
    await close();
  });

  it('turns a started but unfinished record into an interrupted failure', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    await registry.begin('hub', 'schedule', true);
    await registry.settle();
    // A new process reads the persisted running marker as an interrupted run.
    const reopened = new ScheduleRunRegistry({ storage, now });
    await reopened.finalizeInterrupted();
    const record = reopened.record('schedule');
    expect(record?.running).toBeUndefined();
    expect(record?.lastRun?.status).toBe('failed');
    expect(record?.lastRun?.manual).toBe(true);
    expect(record?.lastRun?.error?.code).toBe('SCHEDULE_RUN_INTERRUPTED');
    await close();
  });

  it('keeps the continuous session binding and its project across a finish', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    const binding = { sessionId: 'continuous-session', projectId: 'project', projectPath: '/repo/app' };
    await registry.begin('hub', 'schedule', false);
    await registry.bindContinuousSession('hub', 'schedule', binding);
    await registry.finish('schedule', { status: 'sent', at: now(), manual: false });
    expect(registry.continuousSession('schedule')).toEqual(binding);
    await registry.settle();
    expect(storage.load('schedule')?.continuousSession).toEqual(binding);
    await close();
  });

  it('treats a pre-release binding without a project as absent', async () => {
    const { storage, close } = await memoryStorage();
    await storage.save({ version: 1, hubId: 'hub', scheduleId: 'schedule', continuousSessionId: 'legacy-session' });
    const registry = new ScheduleRunRegistry({ storage, now });
    expect(registry.continuousSession('schedule')).toBeUndefined();
    await close();
  });

  it('projects each Hub separately and prunes removed Hubs', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    await registry.begin('hub-a', 'schedule-a', false);
    await registry.begin('hub-b', 'schedule-b', false);
    expect(Object.keys(registry.runtimeByHub())).toEqual(['hub-a', 'hub-b']);
    await registry.pruneHubs(new Set(['hub-a']));
    expect(registry.record('schedule-b')).toBeUndefined();
    expect(registry.runtimeByHub()).toEqual({ 'hub-a': { 'schedule-a': { running: true } } });
    await registry.remove('schedule-a');
    expect(registry.runtimeByHub()).toEqual({});
    await close();
  });
});
class ControllingStorage {
  hold = false;
  failNext = false;
  saves = 0;
  private release: (() => void) | undefined;
  constructor(private readonly inner: import('../../src/host/schedule-run-storage.js').ScheduleRunStorage) {}
  load = (scheduleId: string) => this.inner.load(scheduleId);
  loadAll = () => this.inner.loadAll();
  delete = (scheduleId: string) => this.inner.delete(scheduleId);
  async save(record: Parameters<typeof this.inner.save>[0]): Promise<void> {
    this.saves += 1;
    if (this.failNext) { this.failNext = false; throw new Error('disk full'); }
    if (this.hold) await new Promise<void>(resolve => { this.release = resolve; });
    return this.inner.save(record);
  }
  releaseSave(): void { const release = this.release; this.release = undefined; this.hold = false; release?.(); }
}

describe('schedule run durability', () => {
  it('does not expose a durable reservation until the marker is saved', async () => {
    const { storage, close } = await memoryStorage();
    const controlling = new ControllingStorage(storage);
    const registry = new ScheduleRunRegistry({ storage: controlling, now });
    controlling.hold = true;
    const beginning = registry.begin('hub', 'schedule', false);
    await Promise.resolve();
    expect(controlling.saves).toBe(1);
    expect(registry.isRunning('schedule')).toBe(true);
    controlling.releaseSave();
    await beginning;
    expect(storage.load('schedule')?.running?.manual).toBe(false);
    await close();
  });

  it('rolls the reservation back when the running marker cannot be saved', async () => {
    const { storage, close } = await memoryStorage();
    const controlling = new ControllingStorage(storage);
    const registry = new ScheduleRunRegistry({ storage: controlling, now });
    controlling.failNext = true;
    await expect(registry.begin('hub', 'schedule', false)).rejects.toThrow('disk full');
    expect(registry.isRunning('schedule')).toBe(false);
    expect(registry.record('schedule')).toBeUndefined();
    await close();
  });

  it('refuses a duplicate admission', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    await registry.begin('hub', 'schedule', false);
    await expect(registry.begin('hub', 'schedule', false)).rejects.toThrowError(/already running/);
    await close();
  });

  it('records the running session and preserves it through an interrupted run', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    await registry.begin('hub', 'schedule', false);
    await registry.markSession('schedule', 'session-1');
    await registry.settle();
    expect(storage.load('schedule')?.running?.sessionId).toBe('session-1');
    const reopened = new ScheduleRunRegistry({ storage, now });
    await reopened.finalizeInterrupted();
    expect(reopened.record('schedule')?.lastRun).toMatchObject({ status: 'failed', sessionId: 'session-1', error: { code: 'SCHEDULE_RUN_INTERRUPTED' } });
    await close();
  });

  it('never resurrects a removed schedule through a late write', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    await registry.begin('hub', 'schedule', false);
    await registry.remove('schedule');
    await expect(registry.bindContinuousSession('hub', 'schedule', { sessionId: 's', projectId: 'p', projectPath: '/repo' })).rejects.toThrowError(/deleted/);
    await registry.finish('schedule', { status: 'sent', at: now(), manual: false });
    await registry.settle();
    expect(registry.record('schedule')).toBeUndefined();
    expect(storage.load('schedule')).toBeUndefined();
    await close();
  });

  it('prunes runtime whose schedule or Hub no longer exists', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    await registry.begin('hub', 'schedule-a', false);
    await registry.begin('hub', 'schedule-b', false);
    await registry.finish('schedule-a', { status: 'sent', at: now(), manual: false });
    await registry.finish('schedule-b', { status: 'sent', at: now(), manual: false });
    await registry.pruneSchedules(new Set(['schedule-a']));
    expect(registry.record('schedule-b')).toBeUndefined();
    await registry.settle();
    expect(storage.load('schedule-b')).toBeUndefined();
    await registry.pruneHubs(new Set(['other-hub']));
    expect(registry.record('schedule-a')).toBeUndefined();
    await close();
  });

  it('attaches an archive failure to the run it belongs to and ignores older conversations', async () => {
    const { storage, close } = await memoryStorage();
    const registry = new ScheduleRunRegistry({ storage, now });
    await registry.begin('hub', 'schedule', false);
    await registry.markSession('schedule', 'session-1');
    await registry.recordArchiveFailure('schedule', 'session-1', Object.assign(new Error('archive refused'), { code: 'ARCHIVE_REFUSED' }));
    await registry.finish('schedule', { status: 'sent', at: now(), manual: false, sessionId: 'session-1' });
    expect(registry.record('schedule')?.lastRun).toMatchObject({ status: 'sent', archiveError: { code: 'ARCHIVE_REFUSED' } });
    await registry.recordArchiveFailure('schedule', 'older-session', new Error('stale'));
    expect(registry.record('schedule')?.lastRun?.archiveError?.code).toBe('ARCHIVE_REFUSED');
    await registry.clearArchiveFailure('schedule', 'session-1');
    expect(registry.record('schedule')?.lastRun?.archiveError).toBeUndefined();
    // A failure that arrives after finalization patches the run it names.
    await registry.recordArchiveFailure('schedule', 'session-1', new Error('still active'));
    expect(registry.record('schedule')?.lastRun?.archiveError?.code).toBe('SCHEDULE_ARCHIVE_FAILED');
    await close();
  });
});
