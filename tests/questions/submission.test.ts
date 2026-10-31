import { describe, expect, it } from 'vitest';
import { canSubmit, selectActiveRound, submitState } from '../../src/questions/submission.js';
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

describe('selectActiveRound', () => {
  const none = () => false;

  it('selects only the requested conversation, ignores answered and pageless rounds, and prefers the newest', () => {
    const rounds = [round('older', 'a', '1'), round('newer', 'a', '2'), round('empty', 'a', '3', { pages: [] }), round('other', 'b', '9'), round('answered', 'a', '4', { answered: true })];
    expect(selectActiveRound(rounds, 'a', none)?.id).toBe('newer');
    expect(selectActiveRound(rounds, 'b', none)?.id).toBe('other');
    expect(selectActiveRound(rounds, 'missing', none)).toBeUndefined();
  });

  it('keeps an in-flight submitted round selected so its mounted form keeps the draft', () => {
    const rounds = [round('submitted', 'a', '1'), round('newer', 'a', '2')];
    expect(selectActiveRound(rounds, 'a', id => id === 'submitted')?.id).toBe('submitted');
  });

  it('puts a rolled-back round ahead of a newer one', () => {
    const rounds = [round('failed', 'a', '1'), round('newer', 'a', '2')];
    expect(selectActiveRound(rounds, 'a', none, 'failed')?.id).toBe('failed');
    expect(selectActiveRound(rounds, 'a', none, 'answered')?.id).toBe('newer');
  });
});
