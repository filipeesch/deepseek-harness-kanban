import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context, type Fiber } from '@deepseek-ai/cordis';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as KanbanHost from '../../src/index.js';
import { KanbanApp } from '../../src/host/app.js';
import { initialState } from '../../src/domain/schema.js';
import type { BoardState } from '../../src/shared/types.js';
import type { GitPort } from '../../src/shared/ports.js';
import { TestGit } from './helpers.js';

type Family = { kind: string; items?: Array<{ id: string; label?: string }> };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** One real Cordis context with fake native ports; the plugin and its event wiring are real. */
async function runtime() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-kanban-attention-')));
  const gitRoot = path.join(directory, 'repo');
  const projectPath = path.join(gitRoot, 'apps', 'web');
  await mkdir(projectPath, { recursive: true });
  const root = new Context();
  const fibers: Fiber[] = [];
  cleanup.push(async () => {
    try { for (const fiber of fibers.reverse()) await fiber.dispose(); }
    finally {
      vi.useRealTimers();
      const temporaryRoot = await realpath(os.tmpdir());
      if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith('dsh-kanban-attention-') || await realpath(directory) !== directory) throw new Error('Unsafe attention test cleanup target');
      await rm(directory, { recursive: true, force: true });
    }
  });

  const git = new TestGit();
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
            get: (key: string) => table.get(key), entries: () => table.entries(), keys: () => table.keys(), size: table.size,
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
  const agents = new Map<string, { id: string; session: Session; status: 'idle' | 'running'; inbox: { nextTurn: unknown[]; nextStep: unknown[] } }>();
  const inspections = new Map<string, { meta: { cwd: string }; events: unknown[]; inheritedEventCount: number }>();
  const families = new Map<string, Family[]>();
  let nextSession = 0;
  const prompt = vi.fn(async () => ({ accepted: true }));
  const archive = vi.fn(async () => {});
  const resolveAgent = vi.fn(async (id: string) => ({ agent: agents.get(id)! }));
  const workspaceByPath = new Map<string, { id: string; path: string; title: string; sessionIds: string[] }>();
  const workspaceById = new Map<string, { id: string; path: string; title: string; sessionIds: string[] }>();
  const workspaceFor = (value: string, title = value) => {
    const existing = workspaceByPath.get(value);
    if (existing) return existing;
    const workspace = { id: 'workspace-attention-' + (workspaceById.size + 1), path: value, title, sessionIds: [] as string[] };
    workspaceByPath.set(value, workspace); workspaceById.set(workspace.id, workspace); return workspace;
  };
  const createSession = (id: SessionId, cwd: string) => {
    const session = Session.create(id, [], { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, cwd } as never);
    sessions.set(id, session);
    directories.set(id, cwd);
    inspections.set(id, { meta: { cwd }, events: [], inheritedEventCount: 0 });
    return session;
  };
  root.provide('sessionController', {
    create: async ({ cwd, workspaceId }: { cwd?: string; workspaceId?: string }) => {
      const id = SessionId('session-attention-' + ++nextSession);
      const target = workspaceId ? workspaceById.get(workspaceId)?.path ?? cwd : cwd;
      const session = createSession(id, target as string);
      agents.set(id, { id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } });
      return { sessionId: id };
    },
    inspect: async (id: string) => inspections.get(id) ?? { meta: { cwd: directory }, events: [], inheritedEventCount: 0 },
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
    resolveByPath: async (value: string) => workspaceFor(value),
    create: async (value: string, title: string) => workspaceFor(value, title),
    get: (id: string) => workspaceById.get(id),
    delete: async (id: string) => { const value = workspaceById.get(id); if (!value) return false; workspaceById.delete(id); workspaceByPath.delete(value.path); return true; },
  } as never);
  root.provide('sandboxPolicy', { resolve: vi.fn(() => { throw new Error('No native executor is used.'); }) } as never);
  root.provide('tools', { get: () => undefined, register: () => () => {} } as never);
  root.on('workspace/session-activity', async ({ sessionId }, next) => {
    const rest = await next();
    const active = families.get(sessionId) ?? [];
    return active.length > 0 ? [...active, ...rest] as never : rest;
  });

  const registry = root.plugin(TypertRegistry); fibers.push(registry); await registry;
  let app!: KanbanApp;
  const initialize = KanbanApp.prototype.initialize;
  vi.spyOn(KanbanApp.prototype, 'initialize').mockImplementation(function (this: KanbanApp) { app = this; return initialize.call(this); });
  const host = root.plugin(KanbanHost); fibers.push(host); await host;
  const project = await app.store.saveProject({ name: 'Attention fixture', projectPath, gitRootPath: gitRoot });
  const task = await app.createTask({ projectId: project.id, title: 'Attention lifecycle', description: '' });
  const sessionId = task.sessionIds[0]!;
  const session = sessions.get(sessionId)!;
  const agent = agents.get(sessionId)!;
  const emitSessionEvent = (event: unknown) => root.emit('session/event', session, event as never);
  const emitAgentStatus = (status: 'idle' | 'running') => { agent.status = status; root.emit('agent/status', { agent: agent as never, status }); };
  return { root, app, task, sessionId, session, agent, sessions, agents, families, git, gitRoot, projectPath, directory, emitSessionEvent, emitAgentStatus, disposeHost: () => host.dispose() };
}

describe('attention activity lifecycle', () => {
  it('clears the early running read only on the idle edge, with no further session event', async () => {
    const f = await runtime();
    const notify = vi.fn(); f.app.subscribe(notify);
    f.families.set(f.sessionId, [{ kind: 'turn' }]);
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(true);

    f.emitSessionEvent({ type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } });
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(true);

    notify.mockClear();
    f.families.set(f.sessionId, []);
    f.emitAgentStatus('idle');
    expect(notify).toHaveBeenCalled();
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(false);
  });

  it('exposes background families and clears them through the schedule edge', async () => {
    const f = await runtime();
    f.families.set(f.sessionId, [{ kind: 'job', items: [{ id: 'job-1', label: 'Run tests' }] }]);
    expect((await f.app.snapshot()).attention[f.task.id]).toMatchObject({
      running: false,
      background: [{ kind: 'job', label: 'Run tests' }],
    });

    f.families.set(f.sessionId, []);
    f.root.emit('schedule/changed');
    expect((await f.app.snapshot()).attention[f.task.id]?.background).toEqual([]);
  });

  it('clears a subagent background family through the parent conversation edge', async () => {
    const f = await runtime();
    const childId = SessionId('session-attention-child');
    f.sessions.set(childId, { id: childId, header: { parentSession: SessionId(f.sessionId) } } as never);
    f.families.set(f.sessionId, [{ kind: 'subagent', items: [{ id: childId, label: 'Research' }] }]);
    expect((await f.app.snapshot()).attention[f.task.id]?.background).toEqual([{ kind: 'subagent', label: 'Research' }]);
    f.families.set(f.sessionId, []);
    f.root.emit('subagent/end', { id: childId } as never);
    expect((await f.app.snapshot()).attention[f.task.id]?.background).toEqual([]);
  });

  it('invalidates the parent when a subagent starts outside a turn', async () => {
    const f = await runtime();
    const childId = SessionId('session-attention-start');
    f.sessions.set(childId, { id: childId, header: { parentSession: SessionId(f.sessionId) } } as never);
    expect((await f.app.snapshot()).attention[f.task.id]?.background).toEqual([]);
    f.families.set(f.sessionId, [{ kind: 'subagent', items: [{ id: childId, label: 'Research' }] }]);
    f.root.emit('subagent/start', { id: childId } as never);
    expect((await f.app.snapshot()).attention[f.task.id]?.background).toEqual([{ kind: 'subagent', label: 'Research' }]);
  });

  it('publishes one change and resumes once when a cached running read clears on the idle edge', async () => {
    const f = await runtime();
    const notify = vi.fn(); f.app.subscribe(notify);
    f.families.set(f.sessionId, [{ kind: 'turn' }]);
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(true);
    f.emitSessionEvent({ type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } });
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(true);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const resume = vi.spyOn(f.app.worktrees, 'resumePending');
    notify.mockClear();
    f.families.set(f.sessionId, []);
    f.emitAgentStatus('idle');
    expect(notify).toHaveBeenCalledOnce();
    await f.app.snapshot();
    notify.mockClear();
    await vi.advanceTimersByTimeAsync(50);
    expect(resume).toHaveBeenCalledOnce();
    // The coalesced tick sees the projection the edge already published.
    expect(notify).not.toHaveBeenCalled();
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(false);
  });

  it('resumes pending worktrees in the same coalesced tick as the invalidation', async () => {
    const f = await runtime();
    const resume = vi.spyOn(f.app.worktrees, 'resumePending');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.emitAgentStatus('running');
    await vi.advanceTimersByTimeAsync(50);
    expect(resume).toHaveBeenCalledOnce();
  });

  it('withdraws every activity edge with the host fiber', async () => {
    const f = await runtime();
    const activity = vi.spyOn(f.app, 'sessionActivity');
    const changed = vi.spyOn(f.app, 'activityChanged');
    await f.disposeHost();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.root.emit('agent/status', { agent: f.agent as never, status: 'idle' });
    f.root.emit('subagent/start', { id: SessionId('session-attention-orphan') } as never);
    f.root.emit('subagent/end', { id: SessionId('session-attention-orphan') } as never);
    f.root.emit('schedule/changed');
    expect(activity).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
