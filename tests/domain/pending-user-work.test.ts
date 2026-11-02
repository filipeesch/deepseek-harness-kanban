import { describe, expect, it } from 'vitest';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';
import { awaitingReply, hasPendingUserWork, mergePendingUserWork, pendingUserWork, samePendingUserWork } from '../../src/domain/pending-user-work.js';

describe('pending user work', () => {
  it('treats an empty list as no pending work', () => {
    expect(hasPendingUserWork(NO_PENDING_USER_WORK)).toBe(false);
    expect(hasPendingUserWork(undefined)).toBe(false);
    expect(awaitingReply(NO_PENDING_USER_WORK)).toBe(false);
    expect(mergePendingUserWork([])).toBe(NO_PENDING_USER_WORK);
  });

  it('normalizes the kind order and keeps a queued count with its kind', () => {
    expect(pendingUserWork(['queued-prompt', 'approval'], 2)).toEqual({ kinds: ['approval', 'queued-prompt'], queuedPrompts: 2 });
    expect(pendingUserWork(['decision-question', 'native-question'])).toEqual({ kinds: ['decision-question', 'native-question'], queuedPrompts: 0 });
    expect(pendingUserWork([], 3)).toEqual({ kinds: ['queued-prompt'], queuedPrompts: 3 });
    expect(pendingUserWork([], 0)).toBe(NO_PENDING_USER_WORK);
  });

  it('merges several conversations into one value with the queued prompts summed', () => {
    const merged = mergePendingUserWork([
      pendingUserWork(['decision-question']),
      pendingUserWork(['queued-prompt'], 2),
      pendingUserWork(['queued-prompt'], 1),
      NO_PENDING_USER_WORK,
    ]);
    expect(merged).toEqual({ kinds: ['decision-question', 'queued-prompt'], queuedPrompts: 3 });
    expect(hasPendingUserWork(merged)).toBe(true);
    expect(awaitingReply(merged)).toBe(true);
  });

  it('a queued prompt alone is not an awaiting reply', () => {
    const queued = pendingUserWork(['queued-prompt'], 1);
    expect(hasPendingUserWork(queued)).toBe(true);
    expect(awaitingReply(queued)).toBe(false);
    expect(awaitingReply(pendingUserWork(['native-question']))).toBe(true);
    expect(awaitingReply(pendingUserWork(['approval']))).toBe(true);
  });

  it('compares equal values structurally', () => {
    expect(samePendingUserWork(pendingUserWork(['approval', 'queued-prompt'], 1), pendingUserWork(['approval', 'queued-prompt'], 1))).toBe(true);
    expect(samePendingUserWork(pendingUserWork(['approval']), pendingUserWork(['approval'], 1))).toBe(false);
    expect(samePendingUserWork(pendingUserWork(['approval']), pendingUserWork(['approval', 'native-question']))).toBe(false);
    expect(samePendingUserWork(NO_PENDING_USER_WORK, NO_PENDING_USER_WORK)).toBe(true);
  });
});
