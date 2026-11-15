import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAWER_VIEW, beginClaim, conversationOf, endPeek, failClaim, openPeek, peekOf, requireSelection,
  resolveConversation, selectConversation, selectionRequiredOf, type DrawerView,
} from '../../src/client/drawer-view.js';
import type { SubagentTarget } from '../../src/client/drawer-navigation.js';

const child: SubagentTarget = { parentSessionId: 's1', sessionId: 'c1', mode: 'continuable' };
const sibling: SubagentTarget = { parentSessionId: 's1', sessionId: 'c2', mode: 'one-shot' };

describe('drawer view transitions', () => {
  it('starts empty', () => {
    expect(EMPTY_DRAWER_VIEW).toEqual({ kind: 'conversation', sessionId: null, selectionRequired: false });
    expect(conversationOf(EMPTY_DRAWER_VIEW)).toBeNull();
    expect(peekOf(EMPTY_DRAWER_VIEW)).toBeNull();
    expect(selectionRequiredOf(EMPTY_DRAWER_VIEW)).toBe(false);
  });

  it('selects a conversation and ends any peek', () => {
    const peeked = openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child);
    expect(selectConversation(peeked, 's2')).toEqual({ kind: 'conversation', sessionId: 's2', selectionRequired: false });
    expect(selectConversation(EMPTY_DRAWER_VIEW, null)).toEqual(EMPTY_DRAWER_VIEW);
  });

  it('marks an explicit selection requirement without losing the conversation', () => {
    const required = requireSelection({ kind: 'conversation', sessionId: 's1', selectionRequired: false });
    expect(required).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: true });
    expect(requireSelection(required)).toBe(required);
  });

  it('keeps an open conversation and only falls back when allowed', () => {
    const view: DrawerView = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    expect(resolveConversation(view, ['s1', 's2'], true)).toBe(view);
    expect(resolveConversation({ ...view, sessionId: 'gone' }, ['s1', 's2'], true)).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: false });
    expect(resolveConversation({ ...view, sessionId: 'gone', selectionRequired: true }, ['s1'], true)).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: true });
    expect(resolveConversation({ ...view, sessionId: 'gone' }, ['s1'], false)).toEqual({ kind: 'conversation', sessionId: null, selectionRequired: false });
  });

  it('opens, replaces, and ends a peek while keeping the conversation active', () => {
    const base: DrawerView = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
    const peeked = openPeek(base, child);
    expect(conversationOf(peeked)).toBe('s1');
    expect(peekOf(peeked)).toEqual(child);
    expect(openPeek(peeked, child)).toBe(peeked);
    const replaced = openPeek(peeked, sibling);
    expect(peekOf(replaced)).toEqual(sibling);
    expect(conversationOf(replaced)).toBe('s1');
    expect(endPeek(replaced)).toEqual(base);
    expect(endPeek(base)).toBe(base);
  });

  it('ends a peek when its conversation disappears', () => {
    const peeked = openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child);
    const next = resolveConversation(peeked, ['s2'], true);
    expect(next).toEqual({ kind: 'conversation', sessionId: 's2', selectionRequired: false });
    expect(peekOf(next)).toBeNull();
  });

  it('records and clears a fork claim', () => {
    const claim = beginClaim('fork');
    expect(claim).toEqual({ sessionId: 'fork' });
    expect(failClaim(claim, 'TASK_BUSY')).toEqual({ sessionId: 'fork', error: 'TASK_BUSY' });
  });
});
