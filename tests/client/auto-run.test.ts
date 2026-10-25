import { describe, expect, it, vi } from 'vitest';
import { AutoRunController, type AutoRunClock, type AutoRunInput } from '../../src/client/auto-run.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { deferred, fixture } from './helpers.js';

class FakeClock implements AutoRunClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  now = (): number => this.time;
  setTimeout = (callback: () => void, delay: number): unknown => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimeout = (handle: unknown): void => { this.timers.delete(handle as number); };
  pending(): number { return this.timers.size; }
  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of [...this.timers].filter(([, value]) => value.at <= this.time).sort((left, right) => left[1].at - right[1].at)) {
      if (!this.timers.has(id)) continue;
      this.timers.delete(id);
      timer.callback();
    }
  }
}

const input = (overrides: Partial<AutoRunInput> = {}): AutoRunInput => ({ taskId: 't1', columnId: 'review', enteredAt: 42, instruction: 'Review **carefully**.', ...overrides });
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

function create(overrides: { clock?: FakeClock; run?: ReturnType<typeof vi.fn> } = {}) {
  const clock = overrides.clock ?? new FakeClock();
  const run = overrides.run ?? vi.fn(async () => fixture());
  const controller = new AutoRunController({ clock, run });
  return { clock, run, controller };
}

async function advance(clock: FakeClock, ms: number) { clock.advance(ms); await flush(); }

describe('auto-run controller', () => {
  it('arms one window and sends exactly the captured entry identity at expiry', async () => {
    const { clock, run, controller } = create();
    controller.arm(input());
    expect(clock.pending()).toBe(1);
    expect(controller.getSnapshot().t1).toMatchObject({ status: 'counting', deadline: 5000, instruction: 'Review **carefully**.', enteredAt: 42 });
    await advance(clock, 4999);
    expect(run).not.toHaveBeenCalled();
    await advance(clock, 1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({ type: 'task.runInstruction', taskId: 't1', columnId: 'review', expectedEnteredAt: 42, expectedInstruction: 'Review **carefully**.' });
    expect(controller.getSnapshot().t1).toBeUndefined();
  });

  it('cancels without sending and clears the deadline', async () => {
    const { clock, run, controller } = create();
    controller.arm(input());
    controller.cancel('t1');
    expect(controller.getSnapshot().t1).toBeUndefined();
    await advance(clock, 5000);
    expect(run).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  it('replaces an older entry and keeps independent tasks independent', async () => {
    const { clock, run, controller } = create();
    controller.arm(input({ enteredAt: 1, instruction: 'First.' }));
    controller.arm(input({ enteredAt: 2, instruction: 'Second.' }));
    controller.arm(input({ taskId: 't2', columnId: 'plan', enteredAt: 3, instruction: 'Plan.' }));
    controller.cancel('t2');
    await advance(clock, 5000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toMatchObject({ taskId: 't1', expectedEnteredAt: 2, expectedInstruction: 'Second.' });
  });

  it('disposes every timer and ignores later expiry', async () => {
    const { clock, run, controller } = create();
    controller.arm(input());
    controller.dispose();
    await advance(clock, 5000);
    expect(run).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({});
  });

  it('reconciles deleted tasks, removed markers, and replaced markers without sending', async () => {
    const { clock, run, controller } = create();
    controller.arm(input({ taskId: 't1' }));
    controller.reconcile([{ id: 't1', columnId: 'review', instructionPending: { columnId: 'review', enteredAt: 42 } }]);
    expect(controller.getSnapshot().t1).toBeDefined();
    controller.reconcile([{ id: 't1', columnId: 'review', instructionPending: { columnId: 'review', enteredAt: 43 } }]);
    expect(controller.getSnapshot().t1).toBeUndefined();
    controller.arm(input({ taskId: 't2' }));
    controller.reconcile([{ id: 't2', columnId: 'review' }]);
    controller.arm(input({ taskId: 't3' }));
    controller.reconcile([]);
    await advance(clock, 5000);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps a failed record, does not retry automatically, and retries only through runNow', async () => {
    const failing = vi.fn()
      .mockRejectedValueOnce({ code: 'SEND_FAILED', message: 'The instruction could not be sent.' })
      .mockResolvedValueOnce(fixture());
    const { clock, controller } = create({ run: failing });
    controller.arm(input());
    await advance(clock, 5000);
    expect(controller.getSnapshot().t1).toMatchObject({ status: 'failed', error: { code: 'SEND_FAILED' } });
    await advance(clock, 10_000);
    expect(failing).toHaveBeenCalledTimes(1);
    await controller.runNow(input());
    expect(failing).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().t1).toBeUndefined();
  });

  it('treats an already-resolved rejection as a silent end', async () => {
    const run = vi.fn().mockRejectedValue({ code: 'INSTRUCTION_ALREADY_RESOLVED', message: 'Already resolved.' });
    const { clock, controller } = create({ run });
    controller.arm(input());
    await advance(clock, 5000);
    expect(controller.getSnapshot().t1).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale failed send overwrite a newer entry', async () => {
    const pending = deferred<KanbanSnapshot>();
    const run = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(fixture());
    const { clock, controller } = create({ run });
    controller.arm(input({ enteredAt: 1, instruction: 'First.' }));
    await advance(clock, 5000);
    expect(controller.getSnapshot().t1?.status).toBe('sending');
    controller.arm(input({ enteredAt: 2, instruction: 'Second.' }));
    pending.reject({ code: 'SEND_FAILED', message: 'The old send failed.' });
    await flush();
    expect(controller.getSnapshot().t1).toMatchObject({ status: 'counting', enteredAt: 2, instruction: 'Second.' });
    await advance(clock, 5000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toMatchObject({ expectedEnteredAt: 2, expectedInstruction: 'Second.' });
  });

  it('does not let a stale success remove a newer entry', async () => {
    const pending = deferred<KanbanSnapshot>();
    const run = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(fixture());
    const { clock, controller } = create({ run });
    controller.arm(input({ enteredAt: 1, instruction: 'First.' }));
    await advance(clock, 5000);
    controller.arm(input({ enteredAt: 2, instruction: 'Second.' }));
    pending.resolve(fixture());
    await flush();
    expect(controller.getSnapshot().t1).toMatchObject({ status: 'counting', enteredAt: 2 });
    await advance(clock, 5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not let an old already-resolved rejection remove a newer entry', async () => {
    const pending = deferred<KanbanSnapshot>();
    const run = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(fixture());
    const { clock, controller } = create({ run });
    controller.arm(input({ enteredAt: 1, instruction: 'First.' }));
    await advance(clock, 5000);
    controller.arm(input({ enteredAt: 2, instruction: 'Second.' }));
    pending.reject({ code: 'INSTRUCTION_ALREADY_RESOLVED', message: 'The old entry was resolved.' });
    await flush();
    expect(controller.getSnapshot().t1).toMatchObject({ status: 'counting', enteredAt: 2 });
    await advance(clock, 5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancels the pending window when running immediately and ignores concurrent runs', async () => {
    let release!: (value: ReturnType<typeof fixture>) => void;
    const run = vi.fn(() => new Promise<ReturnType<typeof fixture>>(resolve => { release = resolve; }));
    const { clock, controller } = create({ run });
    controller.arm(input());
    const first = controller.runNow(input());
    expect(clock.pending()).toBe(0);
    expect(controller.getSnapshot().t1?.status).toBe('sending');
    await expect(controller.runNow(input())).resolves.toBeNull();
    release(fixture());
    await first;
    expect(run).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().t1).toBeUndefined();
  });
});
