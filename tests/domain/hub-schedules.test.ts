import { describe, expect, it } from 'vitest';
import * as operations from '../../src/domain/hub-operations.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import type { HubState } from '../../src/shared/types.js';
import { MemoryHubStorage, operationDeps, sampleHub } from './hub-helpers.js';

function input(overrides: Partial<operations.ScheduleInput> = {}): operations.ScheduleInput {
  return {
    title: 'Morning review', prompt: 'Summarize the open pull requests.', cron: '@daily', timeZone: 'Europe/Lisbon',
    projectId: 'project', newConversation: true, archiveWhenIdle: true, ...overrides,
  };
}

describe('Hub schedule operations', () => {
  it('creates a schedule with a normalized expression and defaults', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const schedule = operations.saveSchedule(hub, input(), deps);
    expect(schedule.cron).toBe('0 0 * * *');
    expect(schedule.enabled).toBe(true);
    expect(schedule.createdAt).toBe(schedule.updatedAt);
    expect(hub.schedules).toHaveLength(1);
    expect(hub.updatedAt).toBe(schedule.updatedAt);
  });

  it('normalizes a continuous schedule by disabling archiving', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const schedule = operations.saveSchedule(hub, input({ newConversation: false, archiveWhenIdle: true }), deps);
    expect(schedule.newConversation).toBe(false);
    expect(schedule.archiveWhenIdle).toBe(false);
  });

  it('updates a schedule without losing its identity, creation time, or enabled state', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const created = operations.saveSchedule(hub, input(), deps);
    operations.setScheduleEnabled(hub, created.id, false, deps);
    const updated = operations.saveSchedule(hub, input({ id: created.id, title: 'Weekly review', cron: '0 9 * * MON', model: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } }), deps);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.enabled).toBe(false);
    expect(updated.cron).toBe('0 9 * * MON');
    expect(updated.model).toEqual({ provider: 'deepseek', model: 'chat', reasoningEffort: 'high' });
    expect(hub.schedules).toHaveLength(1);
  });

  it('rejects a project from another Hub and an unknown schedule', () => {
    const hub = sampleHub(); const deps = operationDeps();
    expect(() => operations.saveSchedule(hub, input({ projectId: 'missing' }), deps)).toThrowError(/Project does not exist/);
    expect(() => operations.saveSchedule(hub, input({ id: 'missing' }), deps)).toThrowError(/Schedule does not exist/);
    expect(() => operations.deleteSchedule(hub, 'missing', deps)).toThrowError(/Schedule does not exist/);
  });

  it('rejects invalid fields and impossible schedules', () => {
    const hub = sampleHub(); const deps = operationDeps();
    expect(() => operations.saveSchedule(hub, input({ title: '   ' }), deps)).toThrowError(/title/);
    expect(() => operations.saveSchedule(hub, input({ prompt: '' }), deps)).toThrowError(/prompt/);
    expect(() => operations.saveSchedule(hub, input({ title: 'x'.repeat(operations.MAX_SCHEDULE_TITLE + 1) }), deps)).toThrowError(/at most/);
    expect(() => operations.saveSchedule(hub, input({ cron: '0 0 30 2 *' }), deps)).toThrowError(/never fires/);
    expect(() => operations.saveSchedule(hub, input({ timeZone: 'Mars/Olympus' }), deps)).toThrowError(/time zone/);
    expect(() => operations.saveSchedule(hub, input({ model: { provider: '', model: 'chat' } }), deps)).toThrowError(/provider/);
  });

  it('caps the number of schedules in one Hub', () => {
    const hub = sampleHub(); const deps = operationDeps();
    for (let index = 0; index < operations.MAX_SCHEDULES_PER_HUB; index += 1) operations.saveSchedule(hub, input({ title: 'Schedule ' + index }), deps);
    expect(hub.schedules).toHaveLength(operations.MAX_SCHEDULES_PER_HUB);
    expect(() => operations.saveSchedule(hub, input({ title: 'One more' }), deps)).toThrowError(/at most 50/);
  });

  it('enables, pauses, and deletes a schedule', () => {
    const hub = sampleHub(); const deps = operationDeps();
    const schedule = operations.saveSchedule(hub, input(), deps);
    expect(operations.setScheduleEnabled(hub, schedule.id, false, deps).enabled).toBe(false);
    expect(operations.setScheduleEnabled(hub, schedule.id, false, deps).enabled).toBe(false);
    expect(operations.setScheduleEnabled(hub, schedule.id, true, deps).enabled).toBe(true);
    const removed = operations.deleteSchedule(hub, schedule.id, deps);
    expect(removed.id).toBe(schedule.id);
    // Removing the last schedule removes the optional collection for a strict older schema.
    expect('schedules' in hub).toBe(false);
  });

  it('enforces the Hub revision through the repository', async () => {
    const storage = new MemoryHubStorage();
    const repository = await HubRepository.open(storage, { id: (() => { let index = 0; return () => 'id-' + (++index); })(), now: () => '2026-01-01T00:00:00.000Z' });
    const store = repository.defaultHub();
    await store.saveProject({ id: 'project', name: 'Project', projectPath: '/repo/app' });
    const created = await store.saveSchedule(input());
    await expect(store.saveSchedule(input({ id: created.id, title: 'Stale' }), 0)).rejects.toThrowError(/changed since this revision/);
    await repository.close();
  });

  it('blocks deleting a project a schedule still targets', () => {
    const hub = sampleHub(); const deps = operationDeps();
    operations.saveSchedule(hub, input(), deps);
    expect(() => operations.deleteProject(hub, 'project', deps)).toThrowError(/schedules in this project/);
  });

  it('keeps schedules local: the Hub record round-trips without a shared document', () => {
    const hub: HubState = sampleHub(); const deps = operationDeps();
    operations.saveSchedule(hub, input(), deps);
    const parsed = operations.requireSchedule(hub, hub.schedules![0]!.id);
    expect(parsed.prompt).toContain('pull requests');
  });
});
describe('Hub schedule identity ownership', () => {
  it('rejects the same schedule identity in two Hubs', async () => {
    const storage = new MemoryHubStorage();
    const at = '2026-01-01T00:00:00.000Z';
    const schedule = {
      id: 'shared', title: 'Shared', prompt: 'Do it', cron: '0 9 * * *', timeZone: 'UTC', projectId: 'project',
      newConversation: true, archiveWhenIdle: true, enabled: true, createdAt: at, updatedAt: at,
    };
    const first = sampleHub('hub-a', 'First');
    const second = sampleHub('hub-b', 'Second');
    first.projects[0]!.id = 'project-a'; first.tasks = []; first.notes = []; first.schedules = [{ ...schedule, projectId: 'project-a' }];
    second.projects[0]!.id = 'project-b'; second.boards[0]!.id = 'board-b'; second.tasks = []; second.notes = []; second.schedules = [{ ...schedule, projectId: 'project-b' }];
    storage.hubs.set(first.id, first); storage.hubs.set(second.id, second);
    await expect(HubRepository.open(storage)).rejects.toThrowError(/schedule identifier is owned by more than one Hub/);
  });
});