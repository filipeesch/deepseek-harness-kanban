import { describe, expect, it } from 'vitest';
import { PAUSE_REASON_LIMIT, activeHold, applyHold, blocksAdvance, clearAutoModeState, normalizePauseReason, type AdvanceBlockedTask } from '../../src/domain/auto-mode-hold.js';
import type { ContextOperation } from '../../src/shared/types.js';

const at = '2026-01-01T00:00:00.000Z';
const operation = { id: 'operation' } as unknown as ContextOperation;

const task = (overrides: Partial<AdvanceBlockedTask> = {}): AdvanceBlockedTask => ({
  columnId: 'backlog',
  instructionPending: undefined,
  operation: null,
  pendingTransition: undefined,
  autoMode: { enabled: true },
  ...overrides,
});

describe('auto-mode hold', () => {
  it('reads the recorded pause and nothing else', () => {
    expect(activeHold(task())).toBeUndefined();
    const held = task({ autoMode: { enabled: true, hold: { reason: 'Review the diff', at } } });
    expect(activeHold(held)).toEqual({ reason: 'Review the diff', at });
  });

  it('lets an idle enabled task advance', () => {
    expect(blocksAdvance(task())).toBe(false);
    expect(blocksAdvance(task({ autoMode: undefined }))).toBe(false);
  });

  it('blocks a task with a context operation', () => {
    expect(blocksAdvance(task({ operation }))).toBe(true);
  });

  it('blocks a task with a confirmed transition', () => {
    expect(blocksAdvance(task({ pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'waiting' } }))).toBe(true);
  });

  it('blocks a task with an unresolved entry for its current stage only', () => {
    expect(blocksAdvance(task({ instructionPending: { columnId: 'backlog', enteredAt: 1 } }))).toBe(true);
    expect(blocksAdvance(task({ instructionPending: { columnId: 'done', enteredAt: 1 } }))).toBe(false);
  });

  it('blocks a task carrying the pause requested by the agent', () => {
    expect(blocksAdvance(task({ autoMode: { enabled: true, hold: { reason: 'Review the diff', at } } }))).toBe(true);
  });

  it('trims a reason and keeps one at the limit', () => {
    expect(normalizePauseReason('  Review the diff  ')).toBe('Review the diff');
    expect(normalizePauseReason('x'.repeat(PAUSE_REASON_LIMIT))).toHaveLength(PAUSE_REASON_LIMIT);
  });

  it('rejects a blank or oversized reason instead of truncating it', () => {
    expect(() => normalizePauseReason('   ')).toThrowError(/nonempty/);
    expect(() => normalizePauseReason('x'.repeat(PAUSE_REASON_LIMIT + 1))).toThrowError(/characters or fewer/);
    expect(() => normalizePauseReason(42)).toThrowError(/required/);
  });

  it('records a hold only on a task that has auto mode', () => {
    const held = task();
    applyHold(held, 'Review the diff', at);
    expect(held.autoMode?.hold).toEqual({ reason: 'Review the diff', at });
    expect(activeHold(held)).toBeDefined();
    expect(() => applyHold(task({ autoMode: undefined }), 'Review', at)).toThrowError(/auto mode is disabled/);
  });

  it('clears the agent pause and the diagnostic pause together', () => {
    const paused = task({ autoMode: { enabled: true, hold: { reason: 'Review', at }, pause: { reason: 'turn-error', at } } });
    expect(clearAutoModeState(paused)).toBe(true);
    expect(paused.autoMode).toEqual({ enabled: true });
    expect(clearAutoModeState(task())).toBe(false);
    expect(clearAutoModeState(task({ autoMode: undefined }))).toBe(false);
  });
});
