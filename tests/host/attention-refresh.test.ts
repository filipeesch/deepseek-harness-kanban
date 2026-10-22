import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardStore } from '../../src/domain/store.js';
import { KanbanApp } from '../../src/host/app.js';
import type { Attention } from '../../src/shared/types.js';
import { MemoryStorage, TestGit, TestSessions } from './helpers.js';

// Actual app/store and public memory ports only: no host runtime, filesystem, jobs or models.
const apps: KanbanApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture() {
  vi.useFakeTimers();
  const store = await BoardStore.open(new MemoryStorage());
  const project = await store.saveProject({ name: 'Memory project', projectPath: '/memory/repo/app', gitRootPath: '/memory/repo' });
  const sessions = new TestSessions();
  const report = vi.fn();
  const app = new KanbanApp(store, sessions, new TestGit(), { report });
  apps.push(app);
  const task = await app.createTask({ projectId: project.id, title: 'Attention fixture', description: '' });
  const sessionId = task.sessionIds[0]!;
  const attention = vi.spyOn(sessions, 'attention');
  const notify = vi.fn();
  app.subscribe(notify);
  return { app, store, sessions, task, sessionId, attention, notify, report };
}

const idle: Attention = { running: false, unread: false, awaitingReply: false, failed: false };
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
    expect(early.attention[f.task.id]?.running).toBe(true);
    f.notify.mockClear();
    f.sessions.busy.clear();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.notify).toHaveBeenCalledOnce();
    const fresh = await f.app.snapshot();
    expect(fresh.attention[f.task.id]?.running).toBe(false);
    expect(fresh.sequence).toBeGreaterThan(early.sequence);
    expect(f.attention).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.attention).toHaveBeenCalledTimes(2);
    expect(f.notify).toHaveBeenCalledOnce();
  });

  it('CR11 recovers a rejected initial read on the next ordinary snapshot without any event or timer', async () => {
    const f = await fixture();
    f.attention.mockRejectedValueOnce(new Error('Initial memory-port failure'));
    expect((await f.app.snapshot()).attention[f.task.id]?.failed).toBe(true);
    expect(f.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect((await f.app.snapshot()).attention[f.task.id]).toEqual(idle);
    expect(f.attention).toHaveBeenCalledTimes(2);
    expect(f.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CR11 does not let a late old rejection evict a newer successful cached read', async () => {
    const f = await fixture();
    const old = deferred<Attention>();
    f.attention.mockImplementationOnce(() => old.promise).mockResolvedValue(idle);
    const pending = f.app.snapshot();
    f.app.activityChanged();
    const fresh = await f.app.snapshot();
    old.reject(new Error('Old memory-port rejection'));
    const stale = await pending;
    expect(stale.attention[f.task.id]?.failed).toBe(true);
    expect(stale.sequence).toBeLessThan(fresh.sequence);
    expect(fresh.attention[f.task.id]).toEqual(idle);
    expect((await f.app.snapshot()).attention[f.task.id]).toEqual(idle);
    expect(f.attention).toHaveBeenCalledTimes(2);
  });

  it('recovers an early failed attention read on the existing debounce', async () => {
    const f = await fixture();
    f.attention.mockRejectedValueOnce(new Error('Transient memory-port failure'));
    event(f.app, f.sessionId);
    expect((await f.app.snapshot()).attention[f.task.id]?.failed).toBe(true);
    f.notify.mockClear();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.notify).toHaveBeenCalledOnce();
    expect((await f.app.snapshot()).attention[f.task.id]).toEqual(idle);
    expect(f.attention).toHaveBeenCalledTimes(2);
  });

  it('keeps delayed stale snapshots older than the refreshed sequence and out of the new cache', async () => {
    const f = await fixture();
    const old = deferred<Attention>();
    f.attention.mockImplementationOnce(() => old.promise).mockResolvedValue(idle);
    event(f.app, f.sessionId);
    const pending = f.app.snapshot();
    await vi.advanceTimersByTimeAsync(50);
    const refreshed = f.app.snapshot();
    old.resolve({ ...idle, running: true });
    const [stale, fresh] = await Promise.all([pending, refreshed]);
    expect(stale.attention[f.task.id]?.running).toBe(true);
    expect(stale.sequence).toBeLessThan(fresh.sequence);
    expect(fresh.attention[f.task.id]?.running).toBe(false);
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(false);
    expect(f.attention).toHaveBeenCalledTimes(2);
  });

  it('coalesces observe and activity changes into the same worktree retry and final notification', async () => {
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
    expect(f.notify).toHaveBeenCalledOnce();
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
    expect((await f.app.snapshot()).attention[f.task.id]?.running).toBe(false);
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
    expect(f.attention).toHaveBeenCalledOnce();
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
    expect(f.attention).toHaveBeenCalledOnce();
    expect(f.notify).toHaveBeenCalledTimes(notifications);
  });
});
