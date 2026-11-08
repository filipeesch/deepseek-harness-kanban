import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import {
  SESSION_FORMAT_VERSION, SessionId, SessionLogOffset,
  type SessionEvent, type SessionHeader,
} from '@deepseek-ai/dsh-session';
import { createSessionHistory } from '../../src/host/session-history.js';

function header(): SessionHeader {
  return { id: SessionId('session-a'), version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, cwd: '/repo' };
}

function event(): SessionEvent {
  return { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as unknown as SessionEvent;
}

function observation(dispose: () => void) {
  return {
    source: 'live' as const,
    header: header(),
    events: [event()],
    inheritedEventCount: SessionLogOffset(0),
    cursor: 0,
    retain: vi.fn(),
    [Symbol.dispose]: dispose,
  };
}

function context(observeSession: ReturnType<typeof vi.fn>): Context {
  return { sessionQuery: { observeSession } } as unknown as Context;
}

describe('session history adapter', () => {
  it('maps the observation values and releases the lease', async () => {
    const dispose = vi.fn();
    const observeSession = vi.fn().mockResolvedValue(observation(dispose));
    const history = createSessionHistory(context(observeSession));
    const signal = new AbortController().signal;

    const result = await history.read('session-a', { signal, projections: 'all' });

    expect(result.header).toEqual(header());
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('turn/start');
    expect(result.inheritedEventCount).toBe(0);
    expect(observeSession).toHaveBeenCalledWith(SessionId('session-a'), { signal, projectionMode: 'all' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('supplies a default timeout signal and skips projections for a history read', async () => {
    const dispose = vi.fn();
    const observeSession = vi.fn().mockResolvedValue(observation(dispose));
    const history = createSessionHistory(context(observeSession));

    await history.read('session-a');

    const options = observeSession.mock.calls[0]?.[1] as { signal?: unknown; projectionMode?: string };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.projectionMode).toBe('none');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('releases the lease when reading the observation fails', async () => {
    const dispose = vi.fn();
    const failed = {
      get header(): SessionHeader { throw new Error('observation header failed'); },
      events: [],
      inheritedEventCount: SessionLogOffset(0),
      [Symbol.dispose]: dispose,
    };
    const observeSession = vi.fn().mockResolvedValue(failed);
    const history = createSessionHistory(context(observeSession));

    await expect(history.read('session-a')).rejects.toThrow('observation header failed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
