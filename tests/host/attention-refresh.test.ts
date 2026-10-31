import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { KanbanApp } from '../../src/host/app.js';
import type { ConversationFacts } from '../../src/shared/types.js';
import { MemoryHubStorage, TestGit, TestSessions } from './helpers.js';

// Actual app/store and public memory ports only: no host runtime, filesystem, jobs or models.
const apps: KanbanApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture() {
  vi.useFakeTimers();
  const hubs = await HubRepository.open(new MemoryHubStorage());
  const store = hubs.defaultHub();
  const project = await store.saveProject({ name: 'Memory project', projectPath: '/memory/repo/app', gitRootPath: '/memory/repo' });
  const sessions = new TestSessions();
  const report = vi.fn();
  const app = new KanbanApp(hubs, sessions, new TestGit(), { report });
  apps.push(app);
  const created = await app.createTask({ projectId: project.id, title: 'Attention fixture', description: '' });
  await store.addSession(created.id, 'attention-session');
  const task = store.requireTask(created.id);
  const sessionId = task.sessionIds[0]!;
  const facts = vi.spyOn(sessions, 'facts');
  const notify = vi.fn();
  app.subscribe(notify);
  return { app, hubs, store, sessions, task, sessionId, facts, notify, report };
}

const idleFacts: ConversationFacts = { running: false, background: [], awaitingReply: false, settledTurn: null };
function event(app: KanbanApp, sessionId: string) {
  app.observe(sessionId, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'blocked' } } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('coalesced public attention refresh', () => {
  it.each(['observe', 'activityChanged'] as const)('refreshes an early running result after %s without another event and notifies subscribers', async source => {
    const f = await fixture();
    f.sessions.busy.add(f.sessionId);
    if (source === 'observe') event(f.app, f.sessionId); else f.app.activityChanged();
    const early = await f.app.snapshot();
    expect(early.conversations[f.sessionId]?.running).toBe(true);
    f.notify.mockClear();
    f.sessions.busy.clear();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.notify).toHaveBeenCalledOnce();
    const fresh = await f.app.snapshot();
    expect(fresh.conversations[f.sessionId]?.running).toBe(false);
    expect(fresh.sequence).toBeGreaterThan(early.sequence);
    expect(f.facts).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.facts).toHaveBeenCalledTimes(2);
    expect(f.notify).toHaveBeenCalledOnce();
  });

  it('CR11 recovers a rejected initial read on the bounded retry without an event', async () => {
    const f = await fixture();
    f.facts.mockRejectedValueOnce(new Error('Initial memory-port failure'));
    expect((await f.app.snapshot()).conversations[f.sessionId]).toEqual(idleFacts);
    expect(f.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    f.notify.mockClear();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.notify).not.toHaveBeenCalled();
    expect((await f.app.snapshot()).conversations[f.sessionId]).toEqual(idleFacts);
    expect(f.facts).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CR11 does not let a late old rejection evict a newer successful cached read', async () => {
    const f = await fixture();
    const old = deferred<ConversationFacts>();
    f.facts.mockImplementationOnce(() => old.promise).mockResolvedValue(idleFacts);
    const pending = f.app.snapshot();
    f.app.activityChanged();
    const fresh = await f.app.snapshot();
    old.reject(new Error('Old memory-port rejection'));
    const stale = await pending;
    expect(stale.conversations[f.sessionId]).toEqual(idleFacts);
    expect(stale.sequence).toBeLessThan(fresh.sequence);
    expect(fresh.conversations[f.sessionId]).toEqual(idleFacts);
    expect((await f.app.snapshot()).conversations[f.sessionId]).toEqual(idleFacts);
    expect(f.facts).toHaveBeenCalledTimes(2);
  });

  it('recovers an early failed attention read on the existing debounce', async () => {
    const f = await fixture();
    f.facts.mockRejectedValueOnce(new Error('Transient memory-port failure'));
    event(f.app, f.sessionId);
    expect((await f.app.snapshot()).conversations[f.sessionId]).toEqual(idleFacts);
    f.notify.mockClear();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.notify).not.toHaveBeenCalled();
    expect((await f.app.snapshot()).conversations[f.sessionId]).toEqual(idleFacts);
    expect(f.facts).toHaveBeenCalledTimes(2);
  });

  it('keeps delayed stale snapshots older than the refreshed sequence and out of the new cache', async () => {
    const f = await fixture();
    const old = deferred<ConversationFacts>();
    f.facts.mockImplementationOnce(() => old.promise).mockResolvedValue(idleFacts);
    event(f.app, f.sessionId);
    const pending = f.app.snapshot();
    await vi.advanceTimersByTimeAsync(50);
    const refreshed = f.app.snapshot();
    old.resolve({ ...idleFacts, running: true });
    const [stale, fresh] = await Promise.all([pending, refreshed]);
    expect(stale.conversations[f.sessionId]?.running).toBe(true);
    expect(stale.sequence).toBeLessThan(fresh.sequence);
    expect(fresh.conversations[f.sessionId]?.running).toBe(false);
    expect((await f.app.snapshot()).conversations[f.sessionId]?.running).toBe(false);
    expect(f.facts).toHaveBeenCalledTimes(2);
  });

  it('coalesces observe and activity changes into the same worktree retry without a quiet publish', async () => {
    const f = await fixture();
    const retry = vi.spyOn(f.app.worktrees, 'resumePending');
    event(f.app, f.sessionId);
    event(f.app, f.sessionId);
    f.app.activityChanged();
    await f.app.snapshot();
    f.notify.mockClear();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(retry).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(retry).toHaveBeenCalledOnce();
    // The projection is idle before and after, so the coalesced tick publishes nothing.
    expect(f.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still invalidates and republishes attention when the existing retry reports an error', async () => {
    const f = await fixture();
    const failure = new Error('Memory retry failure');
    vi.spyOn(f.app.worktrees, 'resumePending').mockRejectedValueOnce(failure);
    f.sessions.busy.add(f.sessionId);
    event(f.app, f.sessionId);
    await f.app.snapshot();
    f.sessions.busy.clear();
    f.notify.mockClear();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.report).toHaveBeenCalledWith(failure);
    expect(f.notify).toHaveBeenCalledOnce();
    expect((await f.app.snapshot()).conversations[f.sessionId]?.running).toBe(false);
  });

  it('does not publish or invalidate cached attention after an in-flight retry outlives close', async () => {
    const f = await fixture();
    const retry = deferred<void>();
    vi.spyOn(f.app.worktrees, 'resumePending').mockImplementationOnce(() => retry.promise);
    event(f.app, f.sessionId);
    const before = await f.app.snapshot();
    await vi.advanceTimersByTimeAsync(50);
    await f.app.close();
    const notifications = f.notify.mock.calls.length;
    retry.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.notify).toHaveBeenCalledTimes(notifications);
    expect((await f.app.snapshot()).sequence).toBe(before.sequence);
    expect(f.facts).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a pending timer on close and ignores later observer callbacks', async () => {
    const f = await fixture();
    const retry = vi.spyOn(f.app.worktrees, 'resumePending');
    event(f.app, f.sessionId);
    await f.app.snapshot();
    await f.app.close();
    const notifications = f.notify.mock.calls.length;
    expect(vi.getTimerCount()).toBe(0);
    event(f.app, f.sessionId);
    f.app.activityChanged();
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(0);
    expect(retry).not.toHaveBeenCalled();
    expect(f.facts).toHaveBeenCalledOnce();
    expect(f.notify).toHaveBeenCalledTimes(notifications);
  });
});
