import { describe, expect, it } from 'vitest';
import { agentOrdinal, closedSessionIds, firstOpenSessionId, openSessionIds } from '../../src/shared/conversations.js';

const scope = { sessionIds: ['s1', 's2', 's3'], closedSessionIds: ['s2'] };

describe('conversation inventory', () => {
  it('keeps open conversations in task order', () => {
    expect(openSessionIds(scope)).toEqual(['s1', 's3']);
  });

  it('returns closed conversations in their recorded close order', () => {
    expect(closedSessionIds({ sessionIds: ['s1', 's2', 's3'], closedSessionIds: ['s3', 's1'] })).toEqual(['s3', 's1']);
  });

  it('selects the first open conversation for automatic work', () => {
    expect(firstOpenSessionId(scope)).toBe('s1');
    expect(firstOpenSessionId({ sessionIds: ['s1', 's2'], closedSessionIds: ['s1', 's2'] })).toBeUndefined();
  });

  it('keeps the one-based fallback label stable when tabs close', () => {
    expect(agentOrdinal(scope, 's3')).toBe(3);
    expect(agentOrdinal(scope, 'missing')).toBe(0);
  });
});
