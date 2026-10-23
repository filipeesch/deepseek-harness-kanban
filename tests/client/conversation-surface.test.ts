import { describe, expect, it } from 'vitest';
import { resolveActiveConversation } from '../../src/client/page-state.js';

describe('resolveActiveConversation', () => {
  it('keeps a selected open conversation', () => {
    expect(resolveActiveConversation(['s1', 's2'], [], 's2', true)).toBe('s2');
  });

  it('falls back to the first open conversation when the selection is closed or stale', () => {
    expect(resolveActiveConversation(['s1', 's2'], ['s2'], 's2', true)).toBe('s1');
    expect(resolveActiveConversation(['s1', 's2'], [], 'missing', true)).toBe('s1');
  });

  it('uses the first open conversation without a selection', () => {
    expect(resolveActiveConversation(['s1', 's2'], [], null, true)).toBe('s1');
  });

  it('does not select a conversation while fallback selection is disallowed', () => {
    expect(resolveActiveConversation(['s1', 's2'], [], 'closed', false)).toBeNull();
  });

  it('returns null when every conversation is closed', () => {
    expect(resolveActiveConversation(['s1', 's2'], ['s1', 's2'], 's1', true)).toBeNull();
  });
});
