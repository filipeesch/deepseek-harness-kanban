import { describe, expect, it } from 'vitest';
import { createQueuedPromptReader, PluginPromptLedger } from '../../src/host/queued-prompts.js';

const sequenced = (values: Record<string, unknown> = {}): unknown => ({ kind: 'sequenced', values });

const message = (rpcId?: string): unknown => rpcId === undefined
  ? { role: 'user', content: [], source: { kind: 'user' } }
  : { role: 'user', content: [], source: { kind: 'user', rpcId } };
const notice = (kind: string): unknown => ({ role: 'user', content: [], source: { kind } });

describe('queued prompt reader', () => {
  it('counts both live inbox lists', async () => {
    const read = createQueuedPromptReader({ live: () => ({ nextTurn: [message(), message('a')], nextStep: [message()] }) }, new PluginPromptLedger());
    expect(read('s1', undefined)).toBe(3);
  });

  it('excludes an instruction the host queued itself, even before it is observable in the queue', async () => {
    const own = new PluginPromptLedger();
    own.add('s1', 'auto-1');
    let nextTurn: unknown[] = [];
    const read = createQueuedPromptReader({ live: () => ({ nextTurn, nextStep: [] }) }, own);
    expect(read('s1', undefined)).toBe(0);
    nextTurn = [message('auto-1'), message('user-1')];
    expect(read('s1', undefined)).toBe(1);
    nextTurn = [message('user-1')];
    expect(read('s1', undefined)).toBe(1);
  });

  it('keeps identities per conversation and bounds how many it remembers', () => {
    const own = new PluginPromptLedger();
    own.add('s1', 'auto-1');
    own.add('s2', 'auto-1');
    own.add('s2', 'auto-1');
    const read = createQueuedPromptReader({
      live: sessionId => sessionId === 's1' ? { nextTurn: [message('auto-1')], nextStep: [] } : { nextTurn: [message('auto-1')], nextStep: [] },
    }, own);
    expect(read('s1', undefined)).toBe(0);
    expect(read('s2', undefined)).toBe(0);
    const capped = new PluginPromptLedger();
    for (let index = 0; index < 70; index += 1) capped.add('s1', 'auto-' + index);
    expect(capped.has('s1', 'auto-0')).toBe(false);
    expect(capped.has('s1', 'auto-69')).toBe(true);
  });

  it('does not count host-injected context notices parked in the steering list', async () => {
    const read = createQueuedPromptReader({
      live: () => ({ nextTurn: [message()], nextStep: [notice('working-directory'), notice('time-context'), message()] }),
    }, new PluginPromptLedger());
    expect(read('s1', undefined)).toBe(2);
    expect(read('s2', sequenced({ inbox: { 'next-turn': [message()], 'next-step': [notice('working-directory')] } }))).toBe(2);
  });

  it('reads the durable projection for a conversation that is not live', async () => {
    const read = createQueuedPromptReader({ live: () => undefined }, new PluginPromptLedger());
    expect(read('s1', sequenced({ inbox: { 'next-turn': [message(), message('k')], 'next-step': [message()] } }))).toBe(3);
  });

  it('fails closed when the durable state is unavailable or malformed', async () => {
    const read = createQueuedPromptReader({ live: () => undefined }, new PluginPromptLedger());
    expect(() => read('s1', undefined)).toThrow(expect.objectContaining({ code: 'SESSION_STATE_UNAVAILABLE' }));
    expect(() => read('s1', sequenced({ inbox: { 'next-turn': 'nope' } }))).toThrow(expect.objectContaining({ code: 'SESSION_STATE_UNAVAILABLE' }));
    expect(() => read('s1', { kind: 'aggregate', values: {} })).toThrow(expect.objectContaining({ code: 'SESSION_STATE_UNAVAILABLE' }));
  });

  it('treats an absent inbox projection as an empty queue', async () => {
    const read = createQueuedPromptReader({ live: () => undefined }, new PluginPromptLedger());
    expect(read('s1', sequenced())).toBe(0);
  });
});
