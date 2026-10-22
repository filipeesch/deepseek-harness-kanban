import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context, type Fiber } from '@deepseek-ai/cordis';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as KanbanHost from '../../src/index.js';
import { KanbanApp } from '../../src/host/app.js';
import { WorktreeCoordinator } from '../../src/host/worktrees.js';
import { initialState } from '../../src/domain/schema.js';
import type { BoardState } from '../../src/shared/types.js';
import type { GitPort } from '../../src/shared/ports.js';
import { TestGit } from './helpers.js';

const isolated = vi.hoisted(() => ({ git: undefined as GitPort | undefined, spawn: vi.fn() }));
vi.mock('../../src/host/git.js', async original => ({
  ...await original<typeof import('../../src/host/git.js')>(),
  // Preserve real path helpers and replace only the external Git boundary.
  GitAdapter: vi.fn(function () { return isolated.git; }),
}));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: isolated.spawn,
}));

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function runtime() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-kanban-schedule-wake-')));
  const gitRoot = path.join(directory, 'repo');
  const projectPath = path.join(gitRoot, 'apps', 'api');
  await mkdir(projectPath, { recursive: true });
  const root = new Context();
  const fibers: Fiber[] = [];
  let offActivity = () => {};
  cleanup.push(async () => {
    try { for (const fiber of fibers.reverse()) await fiber.dispose(); }
    finally {
      offActivity();
      vi.useRealTimers();
      const temporaryRoot = await realpath(os.tmpdir());
      if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith('dsh-kanban-schedule-wake-') || await realpath(directory) !== directory) throw new Error('Unsafe schedule test cleanup target');
      await rm(directory, { recursive: true, force: true });
    }
  });

  const git = new TestGit();
  isolated.git = git;
  isolated.spawn.mockReset().mockImplementation(() => { throw new Error('A source-only schedule test must never spawn an executor.'); });
  let persisted: BoardState = initialState();
  const questionTables = new Map<string, Map<string, unknown>>();
  root.provide('storageDomain', {
    open: async (spec: { name: string }) => spec.name === 'kanban'
      ? {
        global: { get: () => structuredClone(persisted), set: async (value: BoardState) => { persisted = structuredClone(value); } },
        close: async () => {},
      }
      : {
        table: (name: string) => {
          const table = questionTables.get(name) ?? new Map<string, unknown>();
          questionTables.set(name, table);
          return {
            get: (key: string) => table.get(key),
            entries: () => table.entries(),
            keys: () => table.keys(),
            size: table.size,
            put: async (key: string, value: unknown) => { table.set(key, structuredClone(value)); },
            delete: async (key: string) => table.delete(key),
            update: async () => { throw new Error('unused'); },
          };
        },
        close: async () => {},
      },
  } as never);

  const sessions = new Map<string, Session>();
  const directories = new Map<string, string>();
  const agents = new Map<string, { id: string; session: Session; status: 'idle'; inbox: { nextTurn: unknown[]; nextStep: unknown[] } }>();
  let nextSession = 0;
  const prompt = vi.fn(async () => ({ accepted: true }));
  const archive = vi.fn(async () => {});
  const resolveAgent = vi.fn(async (id: string) => ({ agent: agents.get(id)! }));
  const workspaceByPath = new Map<string, { id: string; path: string; title: string; sessionIds: string[] }>();
  const workspaceById = new Map<string, { id: string; path: string; title: string; sessionIds: string[] }>();
  const workspaceFor = (path: string, title = path) => { const existing = workspaceByPath.get(path); if (existing) return existing; const workspace = { id: 'workspace-source-only-' + (workspaceById.size + 1), path, title, sessionIds: [] as string[] }; workspaceByPath.set(path, workspace); workspaceById.set(workspace.id, workspace); return workspace; };
  root.provide('sessionController', {
    create: async ({ cwd, workspaceId }: { cwd?: string; workspaceId?: string }) => {
      const id = SessionId('session-source-only-' + ++nextSession);
      const directory = workspaceId ? workspaceById.get(workspaceId)?.path ?? cwd : cwd;
      // A public-service fake only: no canonical Native Session history is created or appended.
      const session = { id } as Session;
      sessions.set(id, session); directories.set(id, directory as string);
      agents.set(id, { id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } });
      return { sessionId: id };
    },
    inspect: async (id: string) => ({ meta: { cwd: directories.get(id) }, events: [], inheritedEventCount: 0 }),
    projections: async () => ({ kind: 'sequenced', asOfSeq: -1, values: {} }),
    resolveAgent, prompt,
    list: async () => ({ items: [...sessions.keys()].map(sessionId => ({ sessionId })) }),
  } as never);
  root.provide('sessions', { get: (id: string) => sessions.get(id), list: () => [...sessions.values()] } as never);
  root.provide('agents', { get: (id: string) => agents.get(id) } as never);
  root.provide('workingDirectory', {
    get: (session: Session) => directories.get(session.id),
    set: async (agent: { id: string }, cwd: string) => { directories.set(agent.id, cwd); return cwd; },
  } as never);
  root.provide('workspaceRegistry', {
    archiveSession: archive,
    resolveByPath: async (path: string) => workspaceFor(path),
    create: async (path: string, title: string) => workspaceFor(path, title),
    get: (id: string) => workspaceById.get(id),
    delete: async (id: string) => { const value = workspaceById.get(id); if (!value) return false; workspaceById.delete(id); workspaceByPath.delete(value.path); return true; },
  } as never);
  root.provide('sandboxPolicy', { resolve: vi.fn(() => { throw new Error('No native executor or policy operation is allowed.'); }) } as never);
  root.provide('tools', { get: () => undefined, register: () => () => {} } as never);

  let scheduleActive = false;
  let owner = '';
  const scheduleList = vi.fn(async ({ sessionId }: { sessionId: string }) => scheduleActive && sessionId === owner ? [{ id: 'source-only-future-once', title: 'Source-only schedule activity' }] : []);
  // Exact public activity shape from dsh-schedule: active future one-shots are busy before due delivery.
  offActivity = root.on('workspace/session-activity', async ({ sessionId }, next) => {
    const active = await scheduleList({ sessionId });
    const rest = await next();
    // The optional schedule SDK augments this activity union at runtime; this package's test typings only include Native turns.
    const contribution = { kind: 'schedule', items: active.map(record => ({ id: record.id, label: record.title })) };
    return active.length ? [contribution as unknown as (typeof rest)[number], ...rest] : rest;
  });

  const registry = root.plugin(TypertRegistry); fibers.push(registry); await registry;
  let app!: KanbanApp;
  const initialize = KanbanApp.prototype.initialize;
  vi.spyOn(KanbanApp.prototype, 'initialize').mockImplementation(function (this: KanbanApp) { app = this; return initialize.call(this); });
  const resume = vi.spyOn(WorktreeCoordinator.prototype, 'resumePending');
  const host = root.plugin(KanbanHost); fibers.push(host); await host;
  const project = await app.store.saveProject({ name: 'Source-only schedule fixture', projectPath, gitRootPath: gitRoot });
  const task = await app.createTask({ projectId: project.id, title: 'Wait for owned future schedule', description: '' });
  owner = task.sessionIds[0]!;
  let nativeNotifications = 0;
  const nativeNotification = () => {
    nativeNotifications++;
    // Only notify the actual public subscription. Never append this notification to a canonical Native log.
    root.emit('session/event', sessions.get(owner)!, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } } as unknown as SessionEvent);
  };
  const scheduleChanged = () => {
    // Notify the public payloadless event only; no Native reminder or canonical record exists.
    root.emit('schedule/changed');
  };
  const worktreePath = path.join(directory, 'tree');
  return { root, app, task, git, resume, prompt, archive, resolveAgent, agents, scheduleList, worktreePath, projectPath,
    nativeNotification, scheduleChanged, nativeNotifications: () => nativeNotifications, disposeHost: () => host.dispose(),
    setScheduleActive: (value: boolean) => { scheduleActive = value; },
  };
}

async function waitForActiveSchedule(f: Awaited<ReturnType<typeof runtime>>) {
  f.setScheduleActive(true);
  expect([...f.agents.values()].every(agent => agent.status === 'idle' && agent.inbox.nextTurn.length === 0)).toBe(true);
  expect(await f.app.sessions.isIdle(f.task.sessionIds[0]!)).toBe(false);
  await f.app.command({ type: 'worktree.create', taskId: f.task.id, mode: 'new', path: f.worktreePath, branchName: 'task/schedule-wake', sourceBranch: 'main' });
  expect(f.app.store.requireTask(f.task.id).operation?.phase).toBe('waiting');
  expect(f.git.created).toBe(0);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const before = f.resume.mock.calls.length;
  f.nativeNotification();
  await vi.advanceTimersByTimeAsync(51);
  await f.app.worktrees.settle();
  expect(f.resume.mock.calls.length).toBe(before + 1);
  expect(f.app.store.requireTask(f.task.id).operation?.phase).toBe('waiting');
  expect(f.git.created).toBe(0);
}

describe('production schedule activity wake registration', () => {
  it('naturally resumes a waiting operation when schedule inactivity commits after the last Native debounce', async () => {
    const f = await runtime();
    await waitForActiveSchedule(f);
    f.setScheduleActive(false);
    expect(await f.app.sessions.isIdle(f.task.sessionIds[0]!)).toBe(true);
    f.scheduleChanged();
    await vi.advanceTimersByTimeAsync(51);
    await f.app.worktrees.settle();
    expect(f.nativeNotifications()).toBe(1);
    expect(f.prompt).not.toHaveBeenCalled();
    expect(f.archive).not.toHaveBeenCalled();
    expect(isolated.spawn).not.toHaveBeenCalled();
    const current = f.app.store.requireTask(f.task.id);
    expect({ phase: current.operation?.phase ?? null, worktreeStatus: current.worktree?.status ?? null }).toEqual({ phase: null, worktreeStatus: 'ready' });
    expect(f.git.created).toBe(1);
  });

  it('withdraws the schedule listener and pending retry with the actual host fiber', async () => {
    const f = await runtime();
    expect(KanbanHost.inject).not.toContain('schedule');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const changed = vi.spyOn(f.app, 'activityChanged');
    f.scheduleChanged();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await f.disposeHost();
    expect(vi.getTimerCount()).toBe(0);
    const before = f.app.store.snapshot();
    const resumed = f.resume.mock.calls.length;
    f.scheduleChanged();
    await vi.advanceTimersByTimeAsync(100);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(f.resume.mock.calls.length).toBe(resumed);
    expect(f.app.store.snapshot()).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.prompt).not.toHaveBeenCalled();
    expect(f.archive).not.toHaveBeenCalled();
    expect(isolated.spawn).not.toHaveBeenCalled();
  });

  it('confirms the unchanged registration can complete if another Native notification arrives after inactivity', async () => {
    const f = await runtime();
    await waitForActiveSchedule(f);
    f.setScheduleActive(false);
    f.nativeNotification();
    await vi.advanceTimersByTimeAsync(51);
    await f.app.worktrees.settle();
    expect(f.app.store.requireTask(f.task.id).worktree?.status).toBe('ready');
    expect(f.app.store.requireTask(f.task.id).operation).toBeNull();
    expect(f.nativeNotifications()).toBe(2);
    expect(f.git.created).toBe(1);
    expect(f.prompt).not.toHaveBeenCalled();
    expect(f.archive).not.toHaveBeenCalled();
    expect(isolated.spawn).not.toHaveBeenCalled();
  });
});
