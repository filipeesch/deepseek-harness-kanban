import { describe, expect, it } from 'vitest';
import { AGENT_TRANSITION_REASON_LIMIT, TRANSITION_REASON_LIMIT, normalizeTransitionReason } from '../../src/domain/transition-reason.js';
import { DECISION_LIMITS, composeDecisionReason } from '../../src/domain/decision-definition.js';

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

describe('agent-declared transition reason', () => {
  it('is shorter than the stored ceiling', () => {
    expect(AGENT_TRANSITION_REASON_LIMIT).toBe(200);
    expect(AGENT_TRANSITION_REASON_LIMIT).toBeLessThan(TRANSITION_REASON_LIMIT);
  });

  it('accepts exactly the agent limit', () => {
    const reason = 'a'.repeat(AGENT_TRANSITION_REASON_LIMIT);
    expect(normalizeTransitionReason(reason, AGENT_TRANSITION_REASON_LIMIT)).toBe(reason);
  });

  it('rejects one character over the agent limit and states the limit', () => {
    expect(() => normalizeTransitionReason('a'.repeat(AGENT_TRANSITION_REASON_LIMIT + 1), AGENT_TRANSITION_REASON_LIMIT)).toThrowError(
      expect.objectContaining({ code: 'TRANSITION_REASON_TOO_LONG', message: 'A transition reason must be 200 characters or fewer.' }),
    );
  });

  it('still accepts a longer reason under the default ceiling', () => {
    const reason = 'a'.repeat(AGENT_TRANSITION_REASON_LIMIT + 1);
    expect(normalizeTransitionReason(reason)).toBe(reason);
  });
});

describe('decision gate reason', () => {
  it('keeps title, prefixes, and observation exactly inside the stored ceiling', () => {
    const reason = composeDecisionReason(
      { id: 'go', title: 'a'.repeat(DECISION_LIMITS.titleLength), to: 'next' },
      'b'.repeat(DECISION_LIMITS.noteLength),
    );
    expect(reason.length).toBe(TRANSITION_REASON_LIMIT);
    expect(reason.length).toBeGreaterThan(AGENT_TRANSITION_REASON_LIMIT);
  });
});
