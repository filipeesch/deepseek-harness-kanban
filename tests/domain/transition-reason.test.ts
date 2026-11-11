import { describe, expect, it } from 'vitest';
import { TRANSITION_REASON_LIMIT, normalizeTransitionReason } from '../../src/domain/transition-reason.js';

describe('transition reason', () => {
  it('trims a reason', () => {
    expect(normalizeTransitionReason('  The review requested changes.  ')).toBe('The review requested changes.');
  });

  it('rejects a missing or blank reason', () => {
    expect(() => normalizeTransitionReason(undefined)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => normalizeTransitionReason('   ')).toThrowError(expect.objectContaining({ code: 'TRANSITION_REASON_REQUIRED' }));
  });

  it('accepts a reason at the limit', () => {
    const reason = 'a'.repeat(TRANSITION_REASON_LIMIT);
    expect(normalizeTransitionReason(reason)).toBe(reason);
  });

  it('rejects a reason over the limit instead of truncating it', () => {
    expect(() => normalizeTransitionReason('a'.repeat(TRANSITION_REASON_LIMIT + 1))).toThrowError(expect.objectContaining({ code: 'TRANSITION_REASON_TOO_LONG' }));
  });

  it('measures the limit after trimming', () => {
    const reason = ' ' + 'a'.repeat(TRANSITION_REASON_LIMIT) + ' ';
    expect(normalizeTransitionReason(reason)).toBe('a'.repeat(TRANSITION_REASON_LIMIT));
  });
});
