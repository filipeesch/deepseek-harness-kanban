import { describe, expect, it, vi } from 'vitest';
import { DECISION_WINDOW_MS, DecisionWindowController, type DecisionClock } from '../../src/client/decision-window.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';

function clock() {
  let now = 1_000;
  const timers: Array<{ at: number; callback: () => void }> = [];
  const value: DecisionClock = {
    now: () => now,
    setTimeout: (callback, delay) => { const handle = { at: now + delay, callback }; timers.push(handle); return handle; },
    clearTimeout: handle => { const index = timers.indexOf(handle as { at: number; callback: () => void }); if (index >= 0) timers.splice(index, 1); },
  };
  return {
    value,
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers].filter(candidate => candidate.at <= now)) {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
        timer.callback();
      }
    },
  };
}

const snapshot = {} as KanbanSnapshot;
const input = { taskId: 'task-1', entryId: 'entry-1', optionId: 'ship', note: 'Please ship.', destinationId: 'done', destinationIdentity: 'done-key',
    destinationName: 'Done' };

describe('decision window', () => {
  it('submits the chosen option only when the window closes', async () => {
    const time = clock();
    const run = vi.fn(async () => snapshot);
    const controller = new DecisionWindowController({ run, clock: time.value });
    controller.arm(input);
    expect(controller.entryFor('task-1')).toMatchObject({ status: 'counting', deadline: 1_000 + DECISION_WINDOW_MS, destinationIdentity: 'done-key',
    destinationName: 'Done' });
    time.advance(DECISION_WINDOW_MS - 1);
    expect(run).not.toHaveBeenCalled();
    time.advance(1);
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith({ type: 'task.decide', taskId: 'task-1', entryId: 'entry-1', optionId: 'ship', destinationIdentity: 'done-key', note: 'Please ship.' });
    expect(controller.entryFor('task-1')).toBeUndefined();
    controller.dispose();
  });

  it('cancels without submitting', async () => {
    const time = clock();
    const run = vi.fn(async () => snapshot);
    const controller = new DecisionWindowController({ run, clock: time.value });
    controller.arm(input);
    controller.cancel('task-1');
    time.advance(DECISION_WINDOW_MS + 1_000);
    expect(run).not.toHaveBeenCalled();
    expect(controller.entryFor('task-1')).toBeUndefined();
    controller.dispose();
  });

  it('keeps a refusal visible and replaces it on a new confirmation', async () => {
    const time = clock();
    const run = vi.fn(async () => { throw Object.assign(new Error('The entry changed.'), { code: 'STALE_DECISION' }); });
    const controller = new DecisionWindowController({ run, clock: time.value });
    controller.arm(input);
    time.advance(DECISION_WINDOW_MS);
    await Promise.resolve();
    expect(controller.entryFor('task-1')).toMatchObject({ status: 'failed', error: { code: 'STALE_DECISION', message: 'The entry changed.' } });
    const next = vi.fn(async () => snapshot);
    const controller2 = new DecisionWindowController({ run: next, clock: time.value });
    controller2.arm({ ...input, optionId: 'fix', destinationId: 'review', destinationIdentity: 'review-key',
    destinationName: 'Review' });
    expect(controller2.entryFor('task-1')).toMatchObject({ status: 'counting', optionId: 'fix' });
    controller.dispose();
    controller2.dispose();
  });

  it('drops a window whose stage entry was replaced', () => {
    const time = clock();
    const controller = new DecisionWindowController({ run: async () => snapshot, clock: time.value });
    controller.arm(input);
    controller.reconcile([{ id: 'task-1', columnId: 'gate', stageEntry: { id: 'entry-2', columnId: 'gate', stageIdentity: 'gate', enteredAt: 'now' } }]);
    expect(controller.entryFor('task-1')).toBeUndefined();
    controller.dispose();
  });
});