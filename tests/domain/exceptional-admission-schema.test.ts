import { describe, expect, it } from 'vitest';
import { pendingTransition } from '../../src/domain/schema-parts.js';

describe('prepared exceptional admission schema', () => {
  const valid = { id: 'pending', fromColumnId: 'a', columnId: 'b', mode: 'move', status: 'waiting', origin: 'agent', reason: 'Requested.', transitionOverride: true, exceptionUnfinalized: 'declaration' };
  it('accepts only a bound, waiting agent override', () => {
    expect(pendingTransition.safeParse(valid).success).toBe(true);
    for (const change of [{ origin: 'auto' }, { status: 'sending' }, { transitionOverride: false }, { exceptionUnfinalized: true }]) {
      expect(pendingTransition.safeParse({ ...valid, ...change }).success).toBe(false);
    }
  });
});
