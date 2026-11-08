import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import {
  applyConversationFacts, CONVERSATION_FACTS_KEY, registerConversationFacts, type ConversationFactsFold,
} from '../../src/host/conversation-facts.js';

const initial: ConversationFactsFold = { lastTurnEndSeq: null, lastTurnOutcome: null, openApprovalIds: [] };

function event(type: string, data: unknown, seq = 1) {
  return { type, data, seq };
}

function fakeContext(service: unknown): Context {
  return { get: vi.fn((name: string) => name === 'sessionProjections' ? service : undefined) } as unknown as Context;
}

describe('conversation facts fold', () => {
  it('records the settled turn sequence and outcome and clears approvals', () => {
    let state = applyConversationFacts(initial, event('approval/asked', { id: 'a' }, 1));
    state = applyConversationFacts(state, event('approval/asked', { id: 'b' }, 2));
    expect(state.openApprovalIds).toEqual(['a', 'b']);
    state = applyConversationFacts(state, event('approval/decided', { id: 'a' }, 3));
    expect(state.openApprovalIds).toEqual(['b']);
    state = applyConversationFacts(state, event('turn/end', { turn: 1, reason: { kind: 'error' } }, 7));
    expect(state).toEqual({ lastTurnEndSeq: 7, lastTurnOutcome: 'error', openApprovalIds: [] });
  });

  it('treats a non-error reason as an ok outcome and ignores unrelated events', () => {
    const before = applyConversationFacts(initial, event('assistant/message', { text: 'hi' }, 1));
    expect(before).toBe(initial);
    expect(applyConversationFacts(initial, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4)))
      .toEqual({ lastTurnEndSeq: 4, lastTurnOutcome: 'ok', openApprovalIds: [] });
  });

  it('does not duplicate an approval id', () => {
    const first = applyConversationFacts(initial, event('approval/asked', { id: 'a' }, 1));
    expect(applyConversationFacts(first, event('approval/asked', { id: 'a' }, 2))).toBe(first);
  });
});

describe('conversation facts projection registration', () => {
  it('awaits a legacy disposer registration and reads its current state', async () => {
    const expected: ConversationFactsFold = { lastTurnEndSeq: 3, lastTurnOutcome: 'ok', openApprovalIds: [] };
    const unregister = vi.fn();
    const registry = {
      register: vi.fn((_definition?: unknown) => unregister),
      stateOf: vi.fn(() => expected),
    };
    const reader = await registerConversationFacts(fakeContext(registry));
    expect(registry.register).toHaveBeenCalledWith(expect.objectContaining({
      key: CONVERSATION_FACTS_KEY,
      stateVersion: 1,
    }));
    expect(registry.register.mock.calls[0]?.[0]).not.toHaveProperty('wire');
    expect(reader.read({} as Session)).toEqual(expected);
    reader.dispose();
    reader.dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });

  it('uses the awaited handle state and disposal on a newer host', async () => {
    const expected: ConversationFactsFold = { lastTurnEndSeq: 5, lastTurnOutcome: 'error', openApprovalIds: ['a'] };
    const handle = { stateOf: vi.fn(() => expected), dispose: vi.fn(async () => {}) };
    const registry = { register: vi.fn(async () => handle), stateOf: vi.fn() };
    const reader = await registerConversationFacts(fakeContext(registry));
    expect(reader.read({} as Session)).toEqual(expected);
    expect(handle.stateOf).toHaveBeenCalledOnce();
    expect(registry.stateOf).not.toHaveBeenCalled();
    reader.dispose();
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(registry.stateOf).not.toHaveBeenCalled();
  });

  it('degrades to the history fallback when the projection read fails', async () => {
    const registry = { register: vi.fn(() => vi.fn()), stateOf: vi.fn(() => { throw new Error('projection unavailable'); }) };
    const reader = await registerConversationFacts(fakeContext(registry));
    expect(reader.read({} as Session)).toBeUndefined();
  });

  it('falls back to no incremental facts when the projection registry is absent', async () => {
    const reader = await registerConversationFacts(fakeContext(undefined));
    expect(reader.read({} as Session)).toBeUndefined();
  });

  it('rejects activation when registration fails', async () => {
    const registry = { register: vi.fn(() => Promise.reject(new Error('projection conflict'))), stateOf: vi.fn() };
    await expect(registerConversationFacts(fakeContext(registry))).rejects.toThrow('projection conflict');
  });
});
