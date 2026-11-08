import { describe, expect, it, vi } from 'vitest';
import { abortableSleep, ForkAdopter, type ForkAdoptionPorts } from '../../src/host/conversation-adoption.js';
import { KanbanError } from '../../src/shared/errors.js';

function setup(overrides: Partial<ForkAdoptionPorts> = {}) {
  const attached: string[] = [];
  const expected: string[] = [];
  const set: Array<{ sessionId: string; directory: string }> = [];
  const report = vi.fn();
  const ports: ForkAdoptionPorts = {
    locate: sessionId => sessionId === 'parent' ? { hubId: 'hub', taskId: 'task', effectiveCwd: '/task' } : undefined,
    directory: async () => '/task',
    setDirectory: async (sessionId, directory) => { set.push({ sessionId, directory }); },
    attach: async (hubId, taskId, sessionId, expectedEffectiveCwd) => {
      attached.push(`${hubId}/${taskId}/${sessionId}`);
      expected.push(expectedEffectiveCwd);
    },
    sleep: async () => undefined,
    report,
    ...overrides,
  };
  return { ports, attached, expected, set, report };
}

describe('ForkAdopter', () => {
  it('adopts a fork of a retained task conversation', async () => {
    const f = setup();
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('adopted');
    expect(f.attached).toEqual(['hub/task/child']);
    expect(f.expected).toEqual(['/task']);
    expect(f.set).toEqual([]);
    expect(f.report).not.toHaveBeenCalled();
  });

  it('ignores a subagent child', async () => {
    const f = setup();
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent', origin: 'subagent' })).resolves.toBe('ignored');
    expect(f.attached).toEqual([]);
  });

  it('ignores a root session', async () => {
    const f = setup();
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child' })).resolves.toBe('ignored');
    expect(f.attached).toEqual([]);
  });

  it('ignores a fork whose direct parent no task retains', async () => {
    const f = setup({ locate: () => undefined });
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'outside' })).resolves.toBe('ignored');
    expect(f.attached).toEqual([]);
  });

  it('ignores a session already retained by a task', async () => {
    const f = setup({ locate: sessionId => ({ hubId: 'hub', taskId: sessionId === 'child' ? 'other' : 'task', effectiveCwd: '/task' }) });
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('ignored');
    expect(f.attached).toEqual([]);
    expect(f.set).toEqual([]);
  });

  it('aligns a fork whose effective directory differs from the task directory', async () => {
    const f = setup({ directory: async () => '/other' });
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('adopted');
    expect(f.set).toEqual([{ sessionId: 'child', directory: '/task' }]);
    expect(f.attached).toEqual(['hub/task/child']);
  });

  it('does not attach when the directory alignment fails', async () => {
    const failure = new KanbanError('SESSION_ACTIVE', 'The conversation is active.');
    const f = setup({ directory: async () => '/other', setDirectory: async () => { throw failure; } });
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('failed');
    expect(f.attached).toEqual([]);
    expect(f.report).toHaveBeenCalledWith(failure);
  });

  it('cancels while the directory alignment is in flight', async () => {
    const controller = new AbortController();
    let started = false;
    const f = setup({
      directory: async () => '/other',
      setDirectory: (_sessionId, _directory, signal) => new Promise<void>((_resolve, reject) => {
        started = true;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    });
    const adoption = new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' }, controller.signal);
    await vi.waitFor(() => expect(started).toBe(true));
    controller.abort();
    await expect(adoption).resolves.toBe('cancelled');
    expect(f.attached).toEqual([]);
    expect(f.report).not.toHaveBeenCalled();
  });

  it('reports a directory read failure without attaching', async () => {
    const failure = new KanbanError('SESSION_NOT_FOUND', 'Missing conversation.');
    const f = setup({ directory: async () => { throw failure; } });
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('failed');
    expect(f.attached).toEqual([]);
    expect(f.report).toHaveBeenCalledWith(failure);
  });

  it('retries while the task is busy and adopts once it is available', async () => {
    let busy = true;
    const f = setup({ attach: async (_hubId, _taskId, sessionId) => { if (busy) throw new KanbanError('TASK_BUSY', 'Busy.'); f.attached.push(sessionId); } });
    const sleep = vi.fn(async () => { busy = false; });
    const adopter = new ForkAdopter({ ...f.ports, sleep }, { attempts: 3, retryDelayMs: 10 });
    await expect(adopter.adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('adopted');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(f.attached).toEqual(['child']);
    expect(f.report).not.toHaveBeenCalled();
  });

  it('reports after exhausting the bounded retry budget', async () => {
    const failure = new KanbanError('TASK_BUSY', 'Busy.');
    const attach = vi.fn(async () => { throw failure; });
    const sleep = vi.fn(async () => undefined);
    const f = setup({ attach });
    const adopter = new ForkAdopter({ ...f.ports, sleep }, { attempts: 3, retryDelayMs: 10 });
    await expect(adopter.adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('failed');
    expect(attach).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(f.report).toHaveBeenCalledWith(failure);
  });

  it('re-resolves and re-aligns the task directory before a retried attach', async () => {
    let effectiveCwd = '/old';
    let directory = '/old';
    let attempt = 0;
    const set: Array<{ sessionId: string; directory: string }> = [];
    const attach = vi.fn(async (_hubId: string, _taskId: string, _sessionId: string, expected: string) => {
      attempt += 1;
      if (attempt === 1) {
        // A pending switch completes after the first refusal and moves the task.
        effectiveCwd = '/new';
        throw new KanbanError('TASK_BUSY', 'Busy.');
      }
      expect(expected).toBe('/new');
    });
    const f = setup({
      locate: sessionId => sessionId === 'parent' ? { hubId: 'hub', taskId: 'task', effectiveCwd } : undefined,
      directory: async () => directory,
      setDirectory: async (sessionId, path) => { set.push({ sessionId, directory: path }); directory = path; },
      attach,
    });
    await expect(new ForkAdopter(f.ports, { attempts: 3, retryDelayMs: 0 }).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('adopted');
    expect(set).toEqual([{ sessionId: 'child', directory: '/new' }]);
    expect(attach).toHaveBeenLastCalledWith('hub', 'task', 'child', '/new');
  });

  it('reports a non-busy attachment failure immediately', async () => {
    const failure = new KanbanError('SESSION_IN_USE', 'Already associated.');
    const attach = vi.fn(async () => { throw failure; });
    const sleep = vi.fn(async () => undefined);
    const f = setup({ attach });
    const adopter = new ForkAdopter({ ...f.ports, sleep }, { attempts: 3, retryDelayMs: 10 });
    await expect(adopter.adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('failed');
    expect(attach).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledWith(failure);
  });

  it('cancels a waiting retry when the caller aborts', async () => {
    const controller = new AbortController();
    const f = setup({
      attach: async () => { throw new KanbanError('TASK_BUSY', 'Busy.'); },
      sleep: async () => { controller.abort(); throw new Error('aborted'); },
    });
    await expect(new ForkAdopter(f.ports, { attempts: 3, retryDelayMs: 10 }).adopt({ sessionId: 'child', parentSessionId: 'parent' }, controller.signal)).resolves.toBe('cancelled');
    expect(f.report).not.toHaveBeenCalled();
  });

  it('reports a non-abort failure while waiting to retry', async () => {
    const failure = new Error('timer failed');
    const f = setup({
      attach: async () => { throw new KanbanError('TASK_BUSY', 'Busy.'); },
      sleep: async () => { throw failure; },
    });
    await expect(new ForkAdopter(f.ports, { attempts: 3, retryDelayMs: 10 }).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('failed');
    expect(f.report).toHaveBeenCalledWith(failure);
  });

  it('stops before any work when the caller already aborted', async () => {
    const f = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' }, controller.signal)).resolves.toBe('cancelled');
    expect(f.attached).toEqual([]);
  });

  it('reports a throwing port instead of rejecting the caller', async () => {
    const failure = new Error('Lookup failed.');
    const f = setup({ locate: () => { throw failure; } });
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('failed');
    expect(f.report).toHaveBeenCalledWith(failure);
  });

  it('contains a throwing reporter', async () => {
    const f = setup({ directory: async () => { throw new Error('read failed'); }, report: () => { throw new Error('report failed'); } });
    await expect(new ForkAdopter(f.ports).adopt({ sessionId: 'child', parentSessionId: 'parent' })).resolves.toBe('failed');
  });
});

describe('abortableSleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    try {
      const pending = abortableSleep(50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('rejects when the caller aborts before the delay', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = abortableSleep(1000, controller.signal);
      controller.abort();
      await expect(pending).rejects.toBeInstanceOf(Error);
    } finally { vi.useRealTimers(); }
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(10, controller.signal)).rejects.toBeInstanceOf(Error);
  });
});
