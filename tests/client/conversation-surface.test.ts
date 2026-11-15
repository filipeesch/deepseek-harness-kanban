import { describe, expect, it } from 'vitest';
import { conversationOf, resolveConversation, type DrawerView } from '../../src/client/drawer-view.js';

function view(sessionId: string | null, selectionRequired = false): DrawerView {
  return { kind: 'conversation', sessionId, selectionRequired };
}

describe('resolveConversation', () => {
  it('keeps a selected open conversation', () => {
    expect(conversationOf(resolveConversation(view('s2'), ['s1', 's2'], true))).toBe('s2');
  });

  it('falls back to the first open conversation when the selection is closed or stale', () => {
    expect(conversationOf(resolveConversation(view('s2'), ['s1'], true))).toBe('s1');
    expect(conversationOf(resolveConversation(view('missing'), ['s1', 's2'], true))).toBe('s1');
  });

  it('uses the first open conversation without a selection', () => {
    expect(conversationOf(resolveConversation(view(null), ['s1', 's2'], true))).toBe('s1');
  });

  it('does not select a conversation while fallback selection is disallowed', () => {
    expect(conversationOf(resolveConversation(view('closed'), ['s1', 's2'], false))).toBeNull();
  });

  it('returns null when every conversation is closed', () => {
    expect(conversationOf(resolveConversation(view('s1'), [], true))).toBeNull();
  });

  it('preserves the explicit-selection requirement through a fallback', () => {
    expect(resolveConversation(view('closed', true), ['s1'], true)).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: true });
  });
});
