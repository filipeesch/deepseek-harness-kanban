import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { ForkAdopter } from '../../src/host/conversation-adoption.js';
import { registerForkAdoption } from '../../src/index.js';
import { fixture, taskWithConversation } from './helpers.js';

interface AnnouncedSession {
  id: string;
  header: { parentSession?: string; origin?: 'subagent' };
}

interface CreatedPayload {
  agent: { id: string; session: AnnouncedSession };
}

type Listener = (payload: CreatedPayload) => unknown;

function context() {
  const listeners = new Set<Listener>();
  const ctx = {
    on: (name: string, listener: Listener) => {
      expect(name).toBe('agent/created');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } as unknown as Pick<Context, 'on'>;
  const emit = (payload: CreatedPayload) => { for (const listener of listeners) listener(payload); };
  return { ctx, emit };
}

function announced(sessionId: string, parentSession?: string, origin?: 'subagent'): CreatedPayload {
  return {
    agent: {
      id: sessionId,
      session: {
        id: sessionId,
        header: {
          ...(parentSession === undefined ? {} : { parentSession }),
          ...(origin === undefined ? {} : { origin }),
        },
      },
    },
  };
}

/** The same native ports the plugin entry composes for adoption. */
function adopterFor(app: Awaited<ReturnType<typeof fixture>>['app']): ForkAdopter {
  return new ForkAdopter({
    locate: sessionId => {
      const located = app.locator.bySession(sessionId);
      return located === undefined ? undefined : { hubId: located.hubId, taskId: located.task.id, effectiveCwd: located.task.effectiveCwd };
    },
    directory: sessionId => app.sessions.directory(sessionId),
    setDirectory: (sessionId, directory) => app.sessions.setDirectory(sessionId, directory),
    attach: (hubId, taskId, sessionId, expectedEffectiveCwd) => app.hubs.hub(hubId).addSession(taskId, sessionId, expectedEffectiveCwd).then(() => undefined),
    sleep: async () => undefined,
  });
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 5));
}

describe('fork adoption over the real app', () => {
  it('adopts a fork as an open task conversation and aligns its directory', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Fork task', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', f.root);
      const { ctx, emit } = context();
      const dispose = registerForkAdoption(ctx, adopterFor(f.app));
      emit(announced(fork, parent));

      await vi.waitFor(() => expect(f.app.hubs.requireTask(task.id).task.sessionIds).toContain(fork));
      const stored = f.app.hubs.requireTask(task.id).task;
      expect(stored.sessionIds).toEqual([parent, fork]);
      expect(stored.closedSessionIds).not.toContain(fork);
      expect(await f.sessions.directory(fork)).toBe(task.effectiveCwd);

      const snapshot = await f.app.snapshot();
      const projected = snapshot.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === task.id)!;
      expect(projected.sessionIds).toContain(fork);
      expect(projected.closedSessionIds).not.toContain(fork);
      dispose();
    } finally { await f.close(); }
  });

  it('adopts a fork of a closed conversation as an open conversation', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Closed parent', description: '' });
      const parent = task.sessionIds[0]!;
      await f.app.command({ type: 'conversation.close', taskId: task.id, sessionId: parent });
      const fork = f.sessions.seedFork(parent, 'fork', task.effectiveCwd);
      const { ctx, emit } = context();
      const dispose = registerForkAdoption(ctx, adopterFor(f.app));
      emit(announced(fork, parent));
      await vi.waitFor(() => expect(f.app.hubs.requireTask(task.id).task.sessionIds).toContain(fork));
      const stored = f.app.hubs.requireTask(task.id).task;
      expect(stored.sessionIds).toEqual([parent, fork]);
      expect(stored.closedSessionIds).toEqual([parent]);
      expect(stored.closedSessionIds).not.toContain(fork);
      dispose();
    } finally { await f.close(); }
  });

  it('does not adopt a fork twice', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Fork twice', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', task.effectiveCwd);
      const { ctx, emit } = context();
      const dispose = registerForkAdoption(ctx, adopterFor(f.app));
      emit(announced(fork, parent));
      await vi.waitFor(() => expect(f.app.hubs.requireTask(task.id).task.sessionIds).toContain(fork));
      emit(announced(fork, parent));
      await settle();
      expect(f.app.hubs.requireTask(task.id).task.sessionIds.filter(id => id === fork)).toHaveLength(1);
      dispose();
    } finally { await f.close(); }
  });

  it('does not adopt a subagent child', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Subagent child', description: '' });
      const parent = task.sessionIds[0]!;
      const child = f.sessions.seedSubagent(parent, 'child', task.effectiveCwd);
      const { ctx, emit } = context();
      const dispose = registerForkAdoption(ctx, adopterFor(f.app));
      emit(announced(child, parent, 'subagent'));
      await settle();
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
      dispose();
    } finally { await f.close(); }
  });

  it('does not adopt a fork of a subagent descendant', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Subagent fork', description: '' });
      const parent = task.sessionIds[0]!;
      const child = f.sessions.seedSubagent(parent, 'child', task.effectiveCwd);
      const fork = f.sessions.seedFork(child, 'fork-of-child', task.effectiveCwd);
      const { ctx, emit } = context();
      const dispose = registerForkAdoption(ctx, adopterFor(f.app));
      emit(announced(fork, child));
      await settle();
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
      dispose();
    } finally { await f.close(); }
  });

  it('does not adopt a fork whose direct parent no task retains', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Outside parent', description: '' });
      const outside = f.sessions.seedFork('outside', 'outside-fork', task.effectiveCwd);
      const { ctx, emit } = context();
      const dispose = registerForkAdoption(ctx, adopterFor(f.app));
      emit(announced(outside, 'outside'));
      await settle();
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual(task.sessionIds);
      expect(f.sessions.archived).toEqual([]);
      dispose();
    } finally { await f.close(); }
  });

  it('leaves the fork foreign when the task directory alignment fails', async () => {
    const f = await fixture();
    try {
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Alignment failure', description: '' });
      const parent = task.sessionIds[0]!;
      const fork = f.sessions.seedFork(parent, 'fork', f.root);
      const report = vi.fn();
      const { ctx, emit } = context();
      const failing = new ForkAdopter({
        locate: sessionId => {
          const located = f.app.locator.bySession(sessionId);
          return located === undefined ? undefined : { hubId: located.hubId, taskId: located.task.id, effectiveCwd: located.task.effectiveCwd };
        },
        directory: sessionId => f.sessions.directory(sessionId),
        setDirectory: async () => { throw new Error('Injected directory failure.'); },
        attach: (hubId, taskId, sessionId, expectedEffectiveCwd) => f.app.hubs.hub(hubId).addSession(taskId, sessionId, expectedEffectiveCwd).then(() => undefined),
        sleep: async () => undefined,
        report,
      });
      const dispose = registerForkAdoption(ctx, failing, { report });
      emit(announced(fork, parent));
      await vi.waitFor(() => expect(report).toHaveBeenCalled());
      expect(f.app.hubs.requireTask(task.id).task.sessionIds).toEqual([parent]);
      dispose();
    } finally { await f.close(); }
  });
});
