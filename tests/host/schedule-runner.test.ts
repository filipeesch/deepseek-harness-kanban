import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleArchiveWatcher } from '../../src/host/schedule-archive.js';
import type { ScheduleModelPort } from '../../src/host/schedule-model.js';
import { ScheduleRunner } from '../../src/host/schedule-runner.js';
import { ScheduleRunRegistry } from '../../src/host/schedule-runs.js';
import { KanbanError } from '../../src/shared/errors.js';
import { fixture } from './helpers.js';
import { memoryRunStorage } from './schedule-helpers.js';

const now = '2026-01-01T09:00:00.000Z';

interface HarnessOptions { modelFailure?: boolean; signal?: AbortSignal; afterModel?: (sessionId: string) => void; runsStorage?: import('../../src/host/schedule-run-storage.js').ScheduleRunStorage }

async function harness(options: HarnessOptions = {}) {
  const value = await fixture();
  const opened = options.runsStorage === undefined ? await memoryRunStorage() : { storage: options.runsStorage, close: async () => {} };
  const runs = new ScheduleRunRegistry({ storage: opened.storage, now: () => now });
  const errors: unknown[] = [];
  const watcher = new ScheduleArchiveWatcher({
    facts: sessionId => value.sessions.facts(sessionId),
    archive: async sessionId => { await value.sessions.archive(sessionId); },
    report: error => errors.push(error),
  });
  const applied: string[] = [];
  const titles: Array<{ sessionId: string; title: string }> = [];
  const models: ScheduleModelPort = {
    catalog: async () => ({ default: { provider: 'deepseek', model: 'chat' }, providers: [], failures: [] }),
    apply: async (sessionId, selection) => {
      if (options.modelFailure) throw new KanbanError('SESSION_MODEL_UNAVAILABLE', 'The stored model is unavailable.');
      applied.push(sessionId + ':' + selection.provider + '/' + selection.model);
      options.afterModel?.(sessionId);
    },
  };
  const runner = new ScheduleRunner({
    now: () => now,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    requireHub: hubId => value.hubs.requireHub(hubId),
    ensureProjectWorkspace: (hubId, project) => value.app.ensureProjectWorkspace(hubId, project.id),
    createSession: async (projectPath, workspaceId) => {
      if (!(await stat(projectPath)).isDirectory()) throw new KanbanError('INVALID_DIRECTORY', 'The project directory is unavailable.');
      return value.sessions.create(projectPath, workspaceId);
    },
    validateDirectory: (sessionId, expected) => value.sessions.validateDirectory(sessionId, expected),
    renameSession: async (sessionId, title) => { titles.push({ sessionId, title }); },
    send: (sessionId, prompt, requestId) => value.sessions.send(sessionId, prompt, requestId),
    models,
    runs,
    watcher,
    report: error => errors.push(error),
  });
  async function createSchedule(overrides: Partial<Parameters<typeof value.store.saveSchedule>[0]> = {}) {
    return value.store.saveSchedule({
      title: 'Morning review', prompt: 'Summarize the pull requests.', cron: '0 9 * * *', timeZone: 'Europe/Lisbon',
      projectId: value.project.id, newConversation: true, archiveWhenIdle: true, ...overrides,
    });
  }
  return {
    ...value, opened, runs, watcher, runner, models, applied, titles, errors, createSchedule,
    occurrence: (occurrenceAt = now) => ({ hubId: value.hubs.defaultHubId(), scheduleId: '', manual: false, occurrenceAt }),
    closeAll: async () => { await opened.close(); await value.close(); },
  };
}

const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

afterEach(() => { /* each test closes its own fixture */ });

describe('ScheduleRunner', () => {
  it('creates one session in the project workspace, applies the model, titles it, and sends the prompt', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule({ model: { provider: 'deepseek', model: 'reason' } });
    await harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(1);
    expect(harnessed.sessions.sent[0]!.text).toBe('Summarize the pull requests.');
    const lastRun = harnessed.runs.record(schedule.id)?.lastRun;
    expect(lastRun).toMatchObject({ status: 'sent', manual: false });
    const sessionId = lastRun!.sessionId!;
    expect(harnessed.applied).toEqual([sessionId + ':deepseek/reason']);
    expect(harnessed.titles).toEqual([{ sessionId, title: 'Morning review · 2026-01-01 09:00' }]);
    expect(harnessed.workspaces.byPath.get(harnessed.projectPath)?.id).toBe(harnessed.sessions.workspaceIds.get(sessionId));
    expect(harnessed.hubs.requireHub(harnessed.hubs.defaultHubId()).tasks).toHaveLength(0);
    harnessed.watcher.observe(sessionId);
    await flush();
    expect(harnessed.sessions.archived).toEqual([sessionId]);
    await harnessed.closeAll();
  });

  it('reuses one continuous conversation and never archives it', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule({ newConversation: false, archiveWhenIdle: true });
    expect(schedule.archiveWhenIdle).toBe(false);
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-01T09:00:00.000Z'), scheduleId: schedule.id });
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-02T09:00:00.000Z'), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(2);
    const binding = harnessed.runs.continuousSession(schedule.id)!;
    const sessionId = binding.sessionId;
    expect(binding).toMatchObject({ projectId: harnessed.project.id, projectPath: harnessed.projectPath });
    expect(harnessed.sessions.workspaceIds.has(sessionId)).toBe(true);
    expect(harnessed.sessions.dirs.get(sessionId)).toBe(harnessed.projectPath);
    expect(harnessed.watcher.size).toBe(0);
    expect(harnessed.runs.record(schedule.id)?.lastRun).toMatchObject({ status: 'sent' });
    await harnessed.closeAll();
  });

  it('records a failure when the project workspace cannot be resolved and sends nothing', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule();
    const failing = new ScheduleRunner({
      now: () => now,
      requireHub: hubId => harnessed.hubs.requireHub(hubId),
      ensureProjectWorkspace: async () => { throw new KanbanError('INVALID_DIRECTORY', 'The project directory is unavailable.'); },
      createSession: (projectPath, workspaceId) => harnessed.sessions.create(projectPath, workspaceId),
      validateDirectory: (sessionId, expected) => harnessed.sessions.validateDirectory(sessionId, expected),
      renameSession: async () => {},
      send: (sessionId, prompt, requestId) => harnessed.sessions.send(sessionId, prompt, requestId),
      models: harnessed.models,
      runs: harnessed.runs,
      watcher: harnessed.watcher,
    });
    await failing.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(0);
    const lastRun = harnessed.runs.record(schedule.id)?.lastRun;
    expect(lastRun?.status).toBe('failed');
    expect(lastRun?.error?.code).toBe('INVALID_DIRECTORY');
    await expect(harnessed.store.deleteProject(harnessed.project.id)).rejects.toThrowError(/schedules in this project/);
    await harnessed.closeAll();
  });

  it('creates a fresh continuous conversation when the schedule moves to another project', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule({ newConversation: false, archiveWhenIdle: true });
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-01T09:00:00.000Z'), scheduleId: schedule.id });
    const first = harnessed.runs.continuousSession(schedule.id)!;
    expect(harnessed.sessions.dirs.get(first.sessionId)).toBe(harnessed.projectPath);
    const secondPath = path.join(harnessed.root, 'repo2');
    await mkdir(secondPath, { recursive: true });
    const second = await harnessed.store.saveProject({ name: 'Second', projectPath: secondPath });
    await harnessed.store.saveSchedule({
      id: schedule.id, title: schedule.title, prompt: schedule.prompt, cron: schedule.cron, timeZone: schedule.timeZone,
      projectId: second.id, newConversation: false, archiveWhenIdle: true,
    });
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-02T09:00:00.000Z'), scheduleId: schedule.id });
    const rebound = harnessed.runs.continuousSession(schedule.id)!;
    expect(rebound.sessionId).not.toBe(first.sessionId);
    expect(rebound).toMatchObject({ projectId: second.id, projectPath: secondPath });
    expect(harnessed.sessions.dirs.get(rebound.sessionId)).toBe(secondPath);
    expect(harnessed.sessions.dirs.get(first.sessionId)).toBe(harnessed.projectPath);
    expect(harnessed.sessions.sent).toHaveLength(2);
    await harnessed.closeAll();
  });

  it('creates a fresh continuous conversation when the reused conversation left the project directory', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule({ newConversation: false, archiveWhenIdle: true });
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-01T09:00:00.000Z'), scheduleId: schedule.id });
    const first = harnessed.runs.continuousSession(schedule.id)!;
    await harnessed.sessions.setDirectory(first.sessionId, '/somewhere/else');
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-02T09:00:00.000Z'), scheduleId: schedule.id });
    const rebound = harnessed.runs.continuousSession(schedule.id)!;
    expect(rebound.sessionId).not.toBe(first.sessionId);
    expect(harnessed.sessions.dirs.get(rebound.sessionId)).toBe(harnessed.projectPath);
    expect(harnessed.sessions.dirs.get(first.sessionId)).toBe('/somewhere/else');
    await harnessed.closeAll();
  });


  it('fails a reused continuous occurrence when the project directory disappeared', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule({ newConversation: false, archiveWhenIdle: true });
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-01T09:00:00.000Z'), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(1);
    await rm(harnessed.projectPath, { recursive: true, force: true });
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-02T09:00:00.000Z'), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(1);
    expect(harnessed.runs.record(schedule.id)?.lastRun?.status).toBe('failed');
    expect(harnessed.runs.record(schedule.id)?.lastRun?.sessionId).toBeUndefined();
    await harnessed.closeAll();
  });

  it('fails before creating a session while the project is relocating', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule();
    await harnessed.store.transact(draft => {
      draft.projects[0]!.operation = {
        id: 'relocation', request: { from: { projectPath: harnessed.projectPath }, to: { name: 'Moved', projectPath: '/moved/project' } },
        phase: 'queued', migratedSessionIds: [], started: false, createdAt: now,
      };
    });
    await harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(0);
    expect(harnessed.sessions.dirs.size).toBe(0);
    expect(harnessed.runs.record(schedule.id)?.lastRun?.error?.code).toBe('PROJECT_RELOCATING');
    await harnessed.closeAll();
  });

  it('revalidates the conversation directory immediately before sending', async () => {
    const harnessed = await harness({ afterModel: sessionId => { harnessed.sessions.dirs.set(sessionId, '/somewhere/else'); } });
    const schedule = await harnessed.createSchedule({ model: { provider: 'deepseek', model: 'reason' } });
    await harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(0);
    expect(harnessed.runs.record(schedule.id)?.lastRun?.status).toBe('failed');
    await harnessed.closeAll();
  });

  it('stops before any native side effect when the host lifetime aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const harnessed = await harness({ signal: controller.signal });
    const schedule = await harnessed.createSchedule();
    await harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(0);
    expect(harnessed.sessions.dirs.size).toBe(0);
    expect(harnessed.runs.record(schedule.id)?.lastRun?.status).toBe('failed');
    await harnessed.closeAll();
  });


  it('creates no session until the running marker is durable', async () => {
    const memory = await memoryRunStorage();
    let release: (() => void) | undefined;
    let hold = false;
    const gated = {
      ...memory.storage,
      save: async (record: Parameters<typeof memory.storage.save>[0]) => {
        if (hold) await new Promise<void>(resolve => { release = resolve; });
        return memory.storage.save(record);
      },
    };
    const harnessed = await harness({ runsStorage: gated });
    const schedule = await harnessed.createSchedule();
    hold = true;
    const run = harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(harnessed.sessions.dirs.size).toBe(0);
    expect(harnessed.sessions.sent).toHaveLength(0);
    hold = false;
    release?.();
    await run;
    expect(harnessed.sessions.sent).toHaveLength(1);
    await harnessed.closeAll();
    await memory.close();
  });

  it('fails before sending when the stored model is unavailable and archives the empty session', async () => {
    const harnessed = await harness({ modelFailure: true });
    const schedule = await harnessed.createSchedule({ model: { provider: 'deepseek', model: 'gone' } });
    await harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    expect(harnessed.sessions.sent).toHaveLength(0);
    const lastRun = harnessed.runs.record(schedule.id)?.lastRun;
    expect(lastRun?.status).toBe('failed');
    expect(lastRun?.error?.code).toBe('SESSION_MODEL_UNAVAILABLE');
    harnessed.watcher.observe(lastRun!.sessionId!);
    await flush();
    expect(harnessed.sessions.archived).toEqual([lastRun!.sessionId]);
    await harnessed.closeAll();
  });

  it('records a failed prompt admission and keeps the schedule usable', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule();
    harnessed.sessions.failSend = true;
    await harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id });
    harnessed.sessions.failSend = false;
    const failed = harnessed.runs.record(schedule.id)?.lastRun;
    expect(failed?.status).toBe('failed');
    expect(failed?.error?.code).toBe('SEND_FAILED');
    await harnessed.runner.run({ ...harnessed.occurrence('2026-01-02T09:00:00.000Z'), scheduleId: schedule.id });
    expect(harnessed.runs.record(schedule.id)?.lastRun?.status).toBe('sent');
    expect(harnessed.hubs.requireHub(harnessed.hubs.defaultHubId()).schedules?.[0]?.enabled).toBe(true);
    await harnessed.closeAll();
  });

  it('marks a run-now occurrence as manual', async () => {
    const harnessed = await harness();
    const schedule = await harnessed.createSchedule();
    await harnessed.runner.run({ ...harnessed.occurrence(), scheduleId: schedule.id, manual: true });
    expect(harnessed.runs.record(schedule.id)?.lastRun?.manual).toBe(true);
    await harnessed.closeAll();
  });
});