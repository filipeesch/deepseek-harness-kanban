import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteStream, carrierFailure, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client';
import type { RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { ClientBridge, unwrap, type BridgeRemote } from '../../src/client-bridge.js';
import type { HubTask, KanbanSnapshot, QuestionRound } from '../../src/shared/types.js';
function source<T>(initial: T) {
  let value = initial; const listeners = new Set<() => void>();
  const observable: HostObservable<T> = { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { observable, set(next: T) { value = next; for (const listener of listeners) listener(); }, listeners };
}
class Feed<T> implements RemoteStreamHandle<T, never>, AsyncIterator<T> {
  private values: T[] = []; private done = false; private error: unknown;
  private waiter: { resolve: (value: IteratorResult<T>) => void; reject: (reason: unknown) => void } | undefined;
  push(value: T) { if (this.waiter) { this.waiter.resolve({ done: false, value }); this.waiter = undefined; } else this.values.push(value); }
  fail(error: unknown) { this.error = error; this.waiter?.reject(error); this.waiter = undefined; }
  send(_value: never): void { throw new Error('No uplink supported'); }
  end(): void { this.dispose(); }
  dispose(): void { this.done = true; this.waiter?.resolve({ done: true, value: undefined }); this.waiter = undefined; }
  next(): Promise<IteratorResult<T>> {
    if (this.values.length) return Promise.resolve({ done: false, value: this.values.shift()! });
    if (this.error) return Promise.reject(this.error);
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }
  return(): Promise<IteratorResult<T>> { this.dispose(); return Promise.resolve({ done: true, value: undefined }); }
  [Symbol.asyncIterator](): AsyncIterator<T> { return this; }
}
const task = (id: string, sessionIds: string[]): HubTask => ({ id, boardId: 'board', projectId: 'p', title: id, description: '', columnId: 'backlog', position: 0, sessionIds, closedSessionIds: [], effectiveCwd: '/project', worktree: null, operation: null, createdAt: '', updatedAt: '' });
function snapshot(sequence = 1, questionRounds?: QuestionRound[]): KanbanSnapshot {
  const now = '2026-10-21T00:00:00Z';
  return { sequence, state: { hubs: [{ id: 'hub', name: 'Hub', revision: sequence, projects: [], boards: [{ id: 'board', name: 'Board', workflowYaml: '', workflow: { name: 'Default', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, createdAt: now, updatedAt: now }], tasks: [task('t1', ['a', 'b']), task('t2', ['c'])], notes: [], createdAt: now, updatedAt: now }], settings: { revision: 0 } }, attention: {}, ...(questionRounds ? { questionRounds } : {}) };
}
const round = (answered = false): QuestionRound => ({ id: 'round', sessionId: 'a', turnId: 'turn', pages: [{ callId: 'call', sequence: 1, page: { type: 'freetext', question: 'Which approach?' } }], complete: true, answered });
const alive = new Set<ClientBridge>();
afterEach(async () => { await Promise.all([...alive].map(bridge => bridge.dispose())); alive.clear(); });
function fixture() {
  const status = source<SessionStatusSnapshot>(new Map());
  const generation = source<ConnectionGeneration | undefined>({ id: 1, host: { home: '/home' } });
  const feeds: Feed<KanbanSnapshot>[] = [];
  const remote: BridgeRemote = {
    kanban: {
      snapshot: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot() } }),
      command: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot(2) } }),
      branches: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: ['main'] } }),
      worktreeDefault: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: { branchName: 'task', path: '' } } }),
      detectProject: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: { kind: 'git', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' } } }),
      questions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [round()] } }),
      dismissQuestions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [] } }),
      follow: vi.fn((signal?: AbortSignal) => { const feed = new Feed<KanbanSnapshot>(); feeds.push(feed); signal?.addEventListener('abort', () => feed.dispose(), { once: true }); return feed; }),
    },
    $stream<Item>(options: RemoteStreamOptions<Item>) { return new RemoteStream({ generation: generation.observable }, options); },
  };
  const bridge = new ClientBridge(remote, status.observable); alive.add(bridge);
  return { bridge, remote, status, generation, feeds };
}
function native(running = false, completionUnread = false): SessionStatus { return { running, completionUnread, pendingInteraction: undefined }; }
function states(values: Array<[string, SessionStatus]>): SessionStatusSnapshot { return new Map(values.map(([id, value]) => [id as SessionId, value])); }

describe('real native stream bridge', () => {
  it('unwraps native transport and plugin business errors independently', async () => {
    const f = fixture();
    expect(unwrap({ ok: true, value: { ok: true, value: 3 } })).toBe(3);
    expect(() => unwrap(carrierFailure('kanban/snapshot', new Error('offline')))).toThrow('offline');
    expect(() => unwrap({ ok: true, value: { ok: false, error: { code: 'BAD_COMMAND', message: 'Not allowed' } } })).toThrow('Not allowed');
    vi.mocked(f.remote.kanban.command).mockResolvedValue({ ok: true, value: { ok: false, error: { code: 'BAD_COMMAND', message: 'Not allowed' } } });
    await expect(f.bridge.api.command({ type: 'task.edit', taskId: 't1', title: 'Changed' })).rejects.toMatchObject({ code: 'BAD_COMMAND' });
    expect(f.bridge.status.getSnapshot().error?.message).toBe('Not allowed');
    expect(await f.bridge.api.branches('t1')).toEqual(['main']);
    expect(f.remote.kanban.branches).toHaveBeenCalledWith({ taskId: 't1' });
  });
  it('forwards the worktree default lookup and unwraps its result', async () => {
    const f = fixture();
    vi.mocked(f.remote.kanban.worktreeDefault).mockResolvedValueOnce({ ok: true, value: { ok: true, value: { branchName: 'fix-login', path: '/worktrees/fix-login' } } });
    await expect(f.bridge.api.worktreeDefault('t1')).resolves.toEqual({ branchName: 'fix-login', path: '/worktrees/fix-login' });
    expect(f.remote.kanban.worktreeDefault).toHaveBeenCalledWith({ taskId: 't1' });
  });

  it('uses native RemoteSnapshotStream with a baseline per physical generation and full-state updates', async () => {
    const f = fixture(); const accept = vi.fn(); f.bridge.api.subscribe(accept); f.bridge.start();
    await vi.waitFor(() => expect(f.feeds).toHaveLength(1));
    f.feeds[0]!.push(snapshot(7)); await vi.waitFor(() => expect(accept.mock.calls.at(-1)?.[0].sequence).toBe(7));
    f.feeds[0]!.push(snapshot(8)); await vi.waitFor(() => expect(accept.mock.calls.at(-1)?.[0].sequence).toBe(8));
    // A host process restart legitimately resets its sequence; a NEW baseline must replace it.
    f.bridge.retry(); await vi.waitFor(() => expect(f.feeds).toHaveLength(2));
    f.feeds[1]!.push(snapshot(0)); await vi.waitFor(() => expect(accept.mock.calls.at(-1)?.[0].sequence).toBe(0));
    expect(f.bridge.status.getSnapshot()).toEqual({ error: null, connected: true });
  });
  it('does not let stale unary snapshots overwrite newer stream state', async () => {
    const f = fixture(); f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1));
    const accept = vi.fn(); f.bridge.api.subscribe(accept); f.feeds[0]!.push(snapshot(10));
    await vi.waitFor(() => expect(accept).toHaveBeenCalled());
    expect((await f.bridge.api.snapshot()).sequence).toBe(10);
  });
  it('returns the exact command receipt even when a newer feed model supersedes its snapshot', async () => {
    const f = fixture(); const accepted = vi.fn(); f.bridge.api.subscribe(accepted); f.bridge.start();
    await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(10));
    await vi.waitFor(() => expect(accepted).toHaveBeenCalled());
    const response = { ...snapshot(9), commandReceipt: { kind: 'task' as const, id: 'created-exactly' } };
    vi.mocked(f.remote.kanban.command).mockResolvedValue({ ok: true, value: { ok: true, value: response } });
    const result = await f.bridge.api.command({ type: 'task.create', projectId: 'p', title: 'New', description: '' });
    expect(result.sequence).toBe(10); expect(result.commandReceipt).toEqual({ kind: 'task', id: 'created-exactly' });
    expect(accepted.mock.calls.at(-1)?.[0].commandReceipt).toBeUndefined();
    expect((await f.bridge.api.snapshot()).commandReceipt).toBeUndefined();
  });
  it('surfaces a terminal follow error while preserving the last board; disposing stops all callbacks', async () => {
    const f = fixture(); const accept = vi.fn(); f.bridge.api.subscribe(accept); f.bridge.start();
    await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(5));
    await vi.waitFor(() => expect(accept).toHaveBeenCalled());
    f.feeds[0]!.fail(new Error('Host stream failed'));
    await vi.waitFor(() => expect(f.bridge.status.getSnapshot().error?.message).toBe('Host stream failed'));
    expect(accept.mock.calls.at(-1)?.[0].sequence).toBe(5);
    await f.bridge.dispose(); const calls = accept.mock.calls.length;
    f.status.set(states([['a', native(true, true)]])); expect(accept).toHaveBeenCalledTimes(calls);
    expect(f.status.listeners.size).toBe(0);
  });
  it('can retry after terminal failure by replacing the completed native supervisor', async () => {
    const f = fixture(); const accept = vi.fn(); f.bridge.api.subscribe(accept); f.bridge.start();
    await vi.waitFor(() => expect(f.feeds).toHaveLength(1));
    f.feeds[0]!.push(snapshot(1)); await vi.waitFor(() => expect(accept).toHaveBeenCalled());
    f.feeds[0]!.fail(new Error('Terminal host fault'));
    await vi.waitFor(() => expect(f.bridge.status.getSnapshot().error).not.toBeNull());
    f.bridge.retry(); await vi.waitFor(() => expect(f.feeds).toHaveLength(2));
    f.feeds[1]!.push(snapshot(2)); await vi.waitFor(() => expect(accept.mock.calls.at(-1)?.[0].sequence).toBe(2));
    expect(f.bridge.status.getSnapshot()).toEqual({ connected: true, error: null });
  });
  it('stamps epochs only for accepted physical baselines, not updates or local attention notifications', async () => {
    const f = fixture(); const accepted = vi.fn(); f.bridge.api.subscribe(accepted);
    expect((await f.bridge.api.snapshot()).clientEpoch).toBe(0);
    f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1));
    f.feeds[0]!.push(snapshot(7)); await vi.waitFor(() => expect(accepted.mock.calls.at(-1)?.[0].clientEpoch).toBe(1));
    f.status.set(states([['a', native(true, true)]]));
    expect(accepted.mock.calls.at(-1)?.[0].clientEpoch).toBe(1);
    f.feeds[0]!.push(snapshot(8)); await vi.waitFor(() => expect(accepted.mock.calls.at(-1)?.[0].sequence).toBe(8));
    expect(accepted.mock.calls.at(-1)?.[0].clientEpoch).toBe(1);
    f.bridge.retry(); await vi.waitFor(() => expect(f.feeds).toHaveLength(2));
    f.feeds[1]!.push(snapshot(0)); await vi.waitFor(() => expect(accepted.mock.calls.at(-1)?.[0]).toMatchObject({ clientEpoch: 2, sequence: 0 }));
  });
  it('gates only new rich-form submissions during active migration, not waiting or failed recovery', async () => {
    const f = fixture(); const current = snapshot();
    current.state.hubs[0]!.tasks[0]!.operation = { id: 'operation', request: { kind: 'return' }, phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '' };
    vi.mocked(f.remote.kanban.snapshot).mockResolvedValue({ ok: true, value: { ok: true, value: current } });
    await f.bridge.api.snapshot(); expect(() => f.bridge.assertSubmissionAllowed('a')).not.toThrow();
    current.state.hubs[0]!.tasks[0]!.operation.phase = 'switching';
    expect(() => f.bridge.assertSubmissionAllowed('a')).toThrow('switching project context');
    expect(() => f.bridge.assertSubmissionAllowed('c')).not.toThrow();
    current.state.hubs[0]!.tasks[0]!.operation.phase = 'failed'; expect(() => f.bridge.assertSubmissionAllowed('a')).not.toThrow();
  });
  it('keeps clientApi identity and methods stable while native attention changes', async () => {
    const f = fixture(); const api = f.bridge.api; const notify = vi.fn(); api.subscribe(notify);
    await api.snapshot(); f.status.set(states([['a', native(true, true)]]));
    // Native status still owns unread, while turn execution is host-only.
    expect(f.bridge.api).toBe(api); expect(notify.mock.calls.at(-1)?.[0].attention.t1).toMatchObject({ running: false, unread: true });
  });
});

describe('honest local view acknowledgement', () => {
  it('merges every task conversation without acknowledging unrelated sessions or mutating native status', async () => {
    const f = fixture(); const notify = vi.fn(); f.bridge.api.subscribe(notify); await f.bridge.api.snapshot();
    const original = states([['a', native(false, true)], ['b', native(false, true)], ['c', native(false, true)]]); f.status.set(original);
    const stopA = f.bridge.viewSession('a');
    expect(notify.mock.calls.at(-1)?.[0].attention.t1.unread).toBe(true); // B is still unread.
    expect(notify.mock.calls.at(-1)?.[0].attention.t2.unread).toBe(true);
    const stopB = f.bridge.viewSession('b'); expect(notify.mock.calls.at(-1)?.[0].attention.t1.unread).toBe(false);
    expect(f.status.observable.getSnapshot()).toBe(original); expect(original.get('a' as SessionId)?.completionUnread).toBe(true);
    stopA(); stopB();
  });
  it('does not acknowledge anything by opening Info/snapshot and resets a local read on a new running cycle', async () => {
    const f = fixture(); const notify = vi.fn(); f.bridge.api.subscribe(notify); await f.bridge.api.snapshot();
    f.status.set(states([['a', native(false, true)]])); expect(notify.mock.calls.at(-1)?.[0].attention.t1.unread).toBe(true);
    const stop = f.bridge.viewSession('a'); expect(notify.mock.calls.at(-1)?.[0].attention.t1.unread).toBe(false); stop();
    f.status.set(states([['a', native(true, true)]])); f.status.set(states([['a', native(false, true)]]));
    expect(notify.mock.calls.at(-1)?.[0].attention.t1.unread).toBe(true);
  });
  it('acknowledges completion while actually viewed, but surfaces a later new unread edge after closing', async () => {
    const f = fixture(); const notify = vi.fn(); f.bridge.api.subscribe(notify); await f.bridge.api.snapshot();
    const stop = f.bridge.viewSession('a');
    f.status.set(states([['a', native(true)]])); f.status.set(states([['a', native(false, true)]]));
    expect(notify.mock.calls.at(-1)?.[0].attention.t1.unread).toBe(false); stop();
    f.status.set(states([['a', native(false, false)]])); f.status.set(states([['a', native(false, true)]]));
    expect(notify.mock.calls.at(-1)?.[0].attention.t1.unread).toBe(true);
  });
  it('owns at most one plugin composer per Session and releases the ownership idempotently', () => {
    const f = fixture(); const release = f.bridge.claimComposer('a'); expect(release).toBeTypeOf('function');
    expect(f.bridge.claimComposer('a')).toBeUndefined(); expect(f.bridge.claimComposer('b')).toBeTypeOf('function');
    release?.(); release?.(); expect(f.bridge.claimComposer('a')).toBeTypeOf('function');
  });
});

describe('one-shot cold question preparation', () => {
  it('queries once, then follows host-projected round updates rather than polling', async () => {
    const f = fixture(); await f.bridge.api.snapshot();
    await Promise.all([f.bridge.prepareQuestions('a'), f.bridge.prepareQuestions('a')]);
    await f.bridge.prepareQuestions('a'); expect(f.remote.kanban.questions).toHaveBeenCalledOnce();
    expect(f.bridge.questionsView.getSnapshot().rounds).toEqual([round()]);
    f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(3, [round(true)]));
    await vi.waitFor(() => expect(f.bridge.questionsView.getSnapshot().rounds[0]?.answered).toBe(true));
    expect(f.remote.kanban.questions).toHaveBeenCalledTimes(2); // First physical baseline starts a new preparation epoch.
  });
  it('rehydrates an ordinary pending round after a physical host baseline reset', async () => {
    const f = fixture(); f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(7, []));
    await vi.waitFor(() => expect(f.bridge.status.getSnapshot().connected).toBe(true)); await f.bridge.prepareQuestions('a');
    expect(f.bridge.questionsView.getSnapshot().rounds).toHaveLength(1);
    f.bridge.retry(); await vi.waitFor(() => expect(f.feeds).toHaveLength(2)); f.feeds[1]!.push(snapshot(0, []));
    await vi.waitFor(() => expect(f.remote.kanban.questions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(f.bridge.questionsView.getSnapshot().rounds).toHaveLength(1));
    expect(f.bridge.questionsView.getSnapshot().rounds[0]?.answered).toBe(false);
  });
  it('fences an old history response and retires a round answered in the current host epoch', async () => {
    const f = fixture(); f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(7, []));
    await vi.waitFor(() => expect(f.bridge.status.getSnapshot().connected).toBe(true)); let resolve!: (value: Awaited<ReturnType<BridgeRemote['kanban']['questions']>>) => void;
    vi.mocked(f.remote.kanban.questions).mockImplementationOnce(() => new Promise(done => { resolve = done; })); const old = f.bridge.prepareQuestions('a');
    await vi.waitFor(() => expect(f.remote.kanban.questions).toHaveBeenCalledOnce());
    vi.mocked(f.remote.kanban.questions).mockResolvedValueOnce({ ok: true, value: { ok: true, value: [round(true)] } });
    f.bridge.retry(); await vi.waitFor(() => expect(f.feeds).toHaveLength(2)); f.feeds[1]!.push(snapshot(0, []));
    await vi.waitFor(() => expect(f.bridge.questionsView.getSnapshot().rounds[0]?.answered).toBe(true));
    resolve({ ok: true, value: { ok: true, value: [round(false)] } }); expect((await old)[0]?.answered).toBe(true);
    expect(f.bridge.questionsView.getSnapshot().rounds[0]?.answered).toBe(true); expect(f.remote.kanban.questions).toHaveBeenCalledTimes(2);
  });
  it('never rewinds an answered current-host round with a cold history result', async () => {
    const f = fixture(); f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(7, [round(true)]));
    await vi.waitFor(() => expect(f.bridge.questionsView.getSnapshot().rounds[0]?.answered).toBe(true));
    expect((await f.bridge.prepareQuestions('a'))[0]?.answered).toBe(true);
  });
  it('exposes background history errors per session and permits a safe retry', async () => {
    const f = fixture(); await f.bridge.prepareQuestions('a'); vi.mocked(f.remote.kanban.questions).mockRejectedValueOnce(new Error('History unavailable'));
    f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(0, []));
    await vi.waitFor(() => expect(f.bridge.questionsView.getSnapshot().errors.get('a')?.message).toBe('History unavailable'));
    expect(f.bridge.status.getSnapshot().connected).toBe(true); await f.bridge.prepareQuestions('a');
    expect(f.bridge.questionsView.getSnapshot().errors.has('a')).toBe(false); expect(f.bridge.questionsView.getSnapshot().rounds).toHaveLength(1);
  });
  it('can retry a failed initial preparation without marking the round answered', async () => {
    const f = fixture(); vi.mocked(f.remote.kanban.questions).mockRejectedValueOnce(new Error('History unavailable'));
    await expect(f.bridge.prepareQuestions('a')).rejects.toThrow('History unavailable');
    await f.bridge.prepareQuestions('a');
    expect(f.bridge.questionsView.getSnapshot().rounds[0]?.answered).toBe(false);
    expect(f.remote.kanban.questions).toHaveBeenCalledTimes(2);
  });
});

describe('question dismissal bridge', () => {
  it('removes the round locally and fences a late preparation merge', async () => {
    const f = fixture(); await f.bridge.prepareQuestions('a');
    expect(f.bridge.questionsView.getSnapshot().rounds).toHaveLength(1);
    let resolve!: (value: Awaited<ReturnType<BridgeRemote['kanban']['questions']>>) => void;
    vi.mocked(f.remote.kanban.questions).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const stale = f.bridge.prepareQuestions('b');
    await vi.waitFor(() => expect(f.remote.kanban.questions).toHaveBeenCalledTimes(2));
    vi.mocked(f.remote.kanban.dismissQuestions).mockResolvedValueOnce({ ok: true, value: { ok: true, value: [] } });
    await f.bridge.dismissQuestions('a', 'round');
    expect(f.remote.kanban.dismissQuestions).toHaveBeenCalledWith({ sessionId: 'a', roundId: 'round' });
    expect(f.bridge.questionsView.getSnapshot().rounds).toEqual([]);
    await expect(f.bridge.prepareQuestions('a')).resolves.toEqual([]);
    resolve({ ok: true, value: { ok: true, value: [{ ...round(), sessionId: 'b' }] } });
    await stale;
    expect(f.bridge.questionsView.getSnapshot().rounds.filter(value => value.sessionId === 'a')).toEqual([]);
  });

  it('keeps the round when the host rejects the dismissal', async () => {
    const f = fixture(); await f.bridge.prepareQuestions('a');
    vi.mocked(f.remote.kanban.dismissQuestions).mockRejectedValueOnce(Object.assign(new Error('No such round'), { code: 'OTHER_FAILURE' }));
    await expect(f.bridge.dismissQuestions('a', 'round')).rejects.toThrow('No such round');
    expect(f.bridge.questionsView.getSnapshot().rounds).toHaveLength(1);
  });

  it('treats an already dismissed round as success and filters a later snapshot', async () => {
    const f = fixture(); await f.bridge.prepareQuestions('a');
    vi.mocked(f.remote.kanban.dismissQuestions).mockResolvedValueOnce({ ok: true, value: { ok: false, error: { code: 'QUESTION_ROUND_NOT_FOUND', message: 'Already dismissed' } } });
    await expect(f.bridge.dismissQuestions('a', 'round')).resolves.toEqual([]);
    f.bridge.start(); await vi.waitFor(() => expect(f.feeds).toHaveLength(1)); f.feeds[0]!.push(snapshot(7, [round()]));
    await vi.waitFor(() => expect(f.bridge.questionsView.getSnapshot().rounds).toEqual([]));
  });

  it('does not hide unrelated unresolved rounds when the trigger is missing', async () => {
    const f = fixture();
    vi.mocked(f.remote.kanban.questions).mockResolvedValueOnce({ ok: true, value: { ok: true, value: [round(), { ...round(), id: 'round-2' }] } });
    await f.bridge.prepareQuestions('a');
    vi.mocked(f.remote.kanban.dismissQuestions).mockResolvedValueOnce({ ok: true, value: { ok: false, error: { code: 'QUESTION_ROUND_NOT_FOUND', message: 'Already answered' } } });
    await expect(f.bridge.dismissQuestions('a', 'round')).resolves.toMatchObject([{ id: 'round-2' }]);
    expect(f.bridge.questionsView.getSnapshot().rounds.map(value => value.id)).toEqual(['round-2']);
  });
});
