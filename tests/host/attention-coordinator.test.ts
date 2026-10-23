import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionCoordinator, MAX_READ_RETRIES, normalizeBackground, type AttentionCoordinatorOptions, type AttentionTask } from '../../src/host/attention.js';
import type { BackgroundActivity, SessionFacts } from '../../src/shared/types.js';

const tasks = (...sessionIds: string[]): AttentionTask[] => [{ id: 't1', sessionIds }];
function facts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return { turn: false, background: [], awaitingReply: false, failed: false, ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const coordinators: AttentionCoordinator[] = [];
function fixture(overrides: Partial<AttentionCoordinatorOptions> = {}) {
  const values = new Map<string, SessionFacts>();
  const source = { read: vi.fn(async (sessionId: string) => values.get(sessionId) ?? facts()) };
  const refreshWorktrees = vi.fn(async () => {});
  const onChange = vi.fn();
  const report = vi.fn();
  const coordinator = new AttentionCoordinator({
    source, tasks: () => tasks('s1'), pendingQuestion: () => false,
    refreshWorktrees, onChange, report, debounceMs: 50, ...overrides,
  });
  coordinators.push(coordinator);
  return { coordinator, source, values, refreshWorktrees, onChange, report };
}
afterEach(() => { for (const coordinator of coordinators.splice(0)) coordinator.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('attention coordination cache', () => {
  it('reuses one read per conversation until it is invalidated', async () => {
    const f = fixture({ tasks: () => tasks('s1', 's2') });
    await f.coordinator.project();
    await f.coordinator.project();
    expect(f.source.read).toHaveBeenCalledTimes(2);
    f.coordinator.invalidate('s1');
    await f.coordinator.project();
    expect(f.source.read.mock.calls.filter(([id]) => id === 's1')).toHaveLength(2);
    expect(f.source.read.mock.calls.filter(([id]) => id === 's2')).toHaveLength(1);
    f.coordinator.invalidate();
    await f.coordinator.project();
    expect(f.source.read.mock.calls.filter(([id]) => id === 's1')).toHaveLength(3);
    expect(f.source.read.mock.calls.filter(([id]) => id === 's2')).toHaveLength(2);
  });

  it('prunes conversations no longer present on the board', async () => {
    const f = fixture({ tasks: () => tasks('s1', 's2') });
    await f.coordinator.project();
    expect(f.source.read).toHaveBeenCalledTimes(2);
    await f.coordinator.project(tasks('s1'));
    await f.coordinator.project(tasks('s1'));
    expect(f.source.read.mock.calls.filter(([id]) => id === 's2')).toHaveLength(1);
  });

  it('never returns a stale read after dispose', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.coordinator.touch();
    expect(vi.getTimerCount()).toBe(1);
    f.coordinator.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(await f.coordinator.project()).toEqual({});
    expect(f.source.read).not.toHaveBeenCalled();
  });
});

describe('task attention aggregation', () => {
  it('combines turn, background, awaiting reply, and failure across conversations', async () => {
    const f = fixture({ tasks: () => tasks('s1', 's2') });
    f.values.set('s1', facts({ turn: true, awaitingReply: true }));
    f.values.set('s2', facts({ background: [{ kind: 'job', label: 'Run tests' }], failed: true }));
    expect((await f.coordinator.project()).t1).toEqual({
      running: true,
      background: [{ kind: 'job', label: 'Run tests' }],
      unread: false,
      awaitingReply: true,
      failed: true,
    });
  });

  it('orders by family, bounds labels, and keeps every activity so the count is exact', async () => {
    const many: BackgroundActivity[] = Array.from({ length: 15 }, (_, index) => ({ kind: 'job', label: 'job ' + index }));
    expect(normalizeBackground([
      { kind: 'schedule', label: 'Wake later' },
      { kind: 'job', label: 'Run tests' },
      { kind: 'job', label: 'Run tests' },
      { kind: 'subagent', label: 'Research' },
    ])).toEqual([
      { kind: 'job', label: 'Run tests' },
      { kind: 'job', label: 'Run tests' },
      { kind: 'subagent', label: 'Research' },
      { kind: 'schedule', label: 'Wake later' },
    ]);
    expect(normalizeBackground(many)).toHaveLength(15);
    expect(normalizeBackground([{ kind: 'job', label: 'x'.repeat(130) }])[0]?.label).toHaveLength(120);
    expect(normalizeBackground([{ kind: 'job', label: 'x'.repeat(130) }])[0]?.label.endsWith('…')).toBe(true);
  });

  it('evaluates the plugin question state on every projection without re-reading native facts', async () => {
    let pending = false;
    const f = fixture({ pendingQuestion: () => pending });
    expect((await f.coordinator.project()).t1?.awaitingReply).toBe(false);
    pending = true;
    expect((await f.coordinator.project()).t1?.awaitingReply).toBe(true);
    expect(f.source.read).toHaveBeenCalledOnce();
  });
});

describe('failed native reads', () => {
  it('marks the task failed and recovers on the next projection', async () => {
    const f = fixture();
    f.source.read.mockRejectedValueOnce(new Error('Transient read failure'));
    expect((await f.coordinator.project()).t1?.failed).toBe(true);
    expect((await f.coordinator.project()).t1?.failed).toBe(false);
    expect(f.report).not.toHaveBeenCalled();
  });

  it('recovers a transient read failure on the bounded reconcile without another event', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.source.read.mockRejectedValueOnce(new Error('Transient read failure')).mockResolvedValue(facts());
    expect((await f.coordinator.project()).t1?.failed).toBe(true);
    expect(f.onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.source.read).toHaveBeenCalledTimes(2);
    expect(f.onChange).toHaveBeenCalledOnce();
    expect((await f.coordinator.project()).t1?.failed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a permanently failing read and retries it after a new activity edge', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.source.read.mockRejectedValue(new Error('Read unavailable'));
    expect((await f.coordinator.project()).t1?.failed).toBe(true);
    for (let index = 1; index < MAX_READ_RETRIES; index += 1) await vi.advanceTimersByTimeAsync(2_000);
    expect(f.source.read).toHaveBeenCalledTimes(MAX_READ_RETRIES);
    expect(vi.getTimerCount()).toBe(0);
    f.source.read.mockResolvedValue(facts());
    f.coordinator.touch('s1');
    await vi.advanceTimersByTimeAsync(50);
    expect((await f.coordinator.project()).t1?.failed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a late old rejection evict a newer successful read', async () => {
    const f = fixture();
    const old = deferred<SessionFacts>();
    f.source.read.mockImplementationOnce(() => old.promise).mockResolvedValue(facts());
    const first = f.coordinator.project();
    f.coordinator.invalidate();
    const fresh = await f.coordinator.project();
    old.reject(new Error('Late old rejection'));
    expect((await first).t1?.failed).toBe(true);
    expect(fresh.t1?.failed).toBe(false);
    expect((await f.coordinator.project()).t1?.failed).toBe(false);
    expect(f.source.read).toHaveBeenCalledTimes(2);
  });
});

describe('bounded reconcile', () => {
  it('self-heals a missed activity edge within two seconds', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.values.set('s1', facts({ turn: true }));
    expect((await f.coordinator.project()).t1?.running).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    f.values.set('s1', facts());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(f.onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.onChange).toHaveBeenCalledOnce();
    expect((await f.coordinator.project()).t1?.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not publish quiet ticks and keeps reconciling while active', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.values.set('s1', facts({ background: [{ kind: 'job', label: 'Run tests' }] }));
    expect((await f.coordinator.project()).t1?.background).toHaveLength(1);
    expect(f.onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.onChange).not.toHaveBeenCalled();
  });

  it('clears an early true read on the idle edge and stops the reconcile timer', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.values.set('s1', facts({ turn: true }));
    expect((await f.coordinator.project()).t1?.running).toBe(true);
    f.values.set('s1', facts());
    f.coordinator.touch('s1');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.onChange).toHaveBeenCalledOnce();
    expect((await f.coordinator.project()).t1?.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops reconciling on dispose', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.values.set('s1', facts({ turn: true }));
    await f.coordinator.project();
    expect(vi.getTimerCount()).toBe(1);
    f.coordinator.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('coalesced activity refresh', () => {
  it('coalesces touches into one refresh and one change notification', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.coordinator.touch('s1');
    f.coordinator.touch('s1');
    f.coordinator.touch();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(f.refreshWorktrees).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.refreshWorktrees).toHaveBeenCalledOnce();
    expect(f.onChange).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a failed worktree refresh and still publishes the invalidation', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const failure = new Error('Memory retry failure');
    f.refreshWorktrees.mockRejectedValueOnce(failure);
    f.coordinator.touch();
    await vi.advanceTimersByTimeAsync(50);
    expect(f.report).toHaveBeenCalledWith(failure);
    expect(f.onChange).toHaveBeenCalledOnce();
  });

  it('ignores a late refresh after close without publishing or reading', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const retry = deferred<void>();
    f.refreshWorktrees.mockImplementationOnce(() => retry.promise);
    f.coordinator.touch();
    await vi.advanceTimersByTimeAsync(50);
    f.coordinator.dispose();
    retry.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.onChange).not.toHaveBeenCalled();
    expect(await f.coordinator.project()).toEqual({});
    expect(f.source.read).not.toHaveBeenCalled();
  });
});
