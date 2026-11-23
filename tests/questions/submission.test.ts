import { describe, expect, it } from 'vitest';
import { canSubmit, selectVisibleRounds, submitState } from '../../src/questions/submission.js';
import type { QuestionRound } from '../../src/shared/types.js';

function round(id: string, sessionId = 'a', turnId = '1', overrides: Partial<QuestionRound> = {}): QuestionRound {
  return {
    id, sessionId, turnId,
    pages: [{ callId: id + '-call', sequence: 1, page: { type: 'freetext', question: 'Which?' } }],
    complete: true, answered: false, ...overrides,
  };
}

describe('submitState', () => {
  it('reports busy, invalid, awaiting-turn, failed, and ready in that order', () => {
    expect(submitState({ complete: false, answersValid: false, busy: true, error: 'Failed' })).toEqual({ kind: 'submitting' });
    expect(submitState({ complete: false, answersValid: false, busy: false, error: 'Failed' })).toEqual({ kind: 'blocked', reason: 'invalid' });
    expect(submitState({ complete: false, answersValid: true, busy: false, error: 'Failed' })).toEqual({ kind: 'blocked', reason: 'awaiting-turn' });
    expect(submitState({ complete: true, answersValid: true, busy: false, error: 'Failed' })).toEqual({ kind: 'failed', message: 'Failed' });
    expect(submitState({ complete: true, answersValid: false, busy: false, error: null })).toEqual({ kind: 'blocked', reason: 'invalid' });
    expect(submitState({ complete: true, answersValid: true, busy: false, error: null })).toEqual({ kind: 'ready' });
    expect(canSubmit({ kind: 'ready' })).toBe(true);
    expect(canSubmit({ kind: 'failed', message: 'Failed' })).toBe(true);
    expect(canSubmit({ kind: 'blocked', reason: 'awaiting-turn' })).toBe(false);
  });
});

describe('selectVisibleRounds', () => {
  it('returns every unresolved round of the conversation, oldest first', () => {
    const rounds = [round('newer', 'a', '2'), round('older', 'a', '1'), round('other', 'b', '9')];
    expect(selectVisibleRounds(rounds, 'a').map(value => value.id)).toEqual(['older', 'newer']);
    expect(selectVisibleRounds(rounds, 'b').map(value => value.id)).toEqual(['other']);
    expect(selectVisibleRounds(rounds, 'missing')).toEqual([]);
  });

  it('leaves out a retired round and a round with no pages', () => {
    const rounds = [round('open', 'a', '1'), round('retired', 'a', '2', { answered: true }), round('empty', 'a', '3', { pages: [] })];
    expect(selectVisibleRounds(rounds, 'a').map(value => value.id)).toEqual(['open']);
  });

  it('keeps an in-flight submitted round so its mounted form keeps the draft', () => {
    const rounds = [round('submitted', 'a', '1'), round('newer', 'a', '2')];
    expect(selectVisibleRounds(rounds, 'a').map(value => value.id)).toEqual(['submitted', 'newer']);
  });

  it('orders rounds of one turn by their last page sequence', () => {
    const rounds = [
      round('later', 'a', '1', { pages: [{ callId: 'x', sequence: 7, page: { type: 'freetext', question: 'Later' } }] }),
      round('earlier', 'a', '1', { pages: [{ callId: 'y', sequence: 2, page: { type: 'freetext', question: 'Earlier' } }] }),
    ];
    expect(selectVisibleRounds(rounds, 'a').map(value => value.id)).toEqual(['earlier', 'later']);
  });
});
