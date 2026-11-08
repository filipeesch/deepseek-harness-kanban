import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { registerForkAdoption } from '../../src/index.js';

interface AnnouncedSession {
  id: string;
  header: { parentSession?: string; origin?: 'subagent' };
}

interface CreatedPayload {
  agent: { id: string; session: AnnouncedSession };
  source?: 'startup' | 'resume' | 'clear' | 'compact';
}

type Listener = (payload: CreatedPayload) => unknown;

function context() {
  const listeners = new Set<Listener>();
  const ctx = {
    on: (name: string, listener: Listener) => {
      expect(name).toBe('agent/created');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } as unknown as Pick<Context, 'on'>;
  const emit = (payload: CreatedPayload): unknown => {
    let result: unknown;
    for (const listener of listeners) result = listener(payload);
    return result;
  };
  return { ctx, emit, listeners };
}

function announced(sessionId: string, parentSession?: string, origin?: 'subagent'): CreatedPayload {
  return {
    agent: {
      id: sessionId,
      session: {
        id: sessionId,
        header: {
          ...(parentSession === undefined ? {} : { parentSession }),
          ...(origin === undefined ? {} : { origin }),
        },
      },
    },
  };
}

describe('registerForkAdoption', () => {
  it('maps an announced fork to its direct parent and adopts it detached', async () => {
    const { ctx, emit } = context();
    const adopt = vi.fn(async () => 'adopted' as const);
    registerForkAdoption(ctx, { adopt });
    expect(emit(announced('child', 'parent'))).toBeUndefined();
    expect(adopt).toHaveBeenCalledWith({ sessionId: 'child', parentSessionId: 'parent' }, expect.any(AbortSignal));
  });

  it('passes an announced subagent origin through', () => {
    const { ctx, emit } = context();
    const adopt = vi.fn(async () => 'ignored' as const);
    registerForkAdoption(ctx, { adopt });
    emit(announced('child', 'parent', 'subagent'));
    expect(adopt).toHaveBeenCalledWith({ sessionId: 'child', parentSessionId: 'parent', origin: 'subagent' }, expect.any(AbortSignal));
  });

  it('passes a root session without a parent through', () => {
    const { ctx, emit } = context();
    const adopt = vi.fn(async () => 'ignored' as const);
    registerForkAdoption(ctx, { adopt });
    emit(announced('root'));
    expect(adopt).toHaveBeenCalledWith({ sessionId: 'root' }, expect.any(AbortSignal));
  });

  it('adopts a fork the host resumed', () => {
    const { ctx, emit } = context();
    const adopt = vi.fn(async () => 'adopted' as const);
    registerForkAdoption(ctx, { adopt });
    emit({ ...announced('child', 'parent'), source: 'resume' });
    expect(adopt).toHaveBeenCalledWith({ sessionId: 'child', parentSessionId: 'parent' }, expect.any(AbortSignal));
  });

  it('stops adopting after disposal', () => {
    const { ctx, emit, listeners } = context();
    const adopt = vi.fn(async () => 'adopted' as const);
    const dispose = registerForkAdoption(ctx, { adopt });
    dispose();
    expect(listeners.size).toBe(0);
    emit(announced('child', 'parent'));
    expect(adopt).not.toHaveBeenCalled();
  });

  it('aborts the lifetime signal passed to an in-flight adoption', () => {
    const { ctx, emit } = context();
    const signals: AbortSignal[] = [];
    const adopt = vi.fn(async (_facts: unknown, signal?: AbortSignal) => { if (signal) signals.push(signal); return 'cancelled' as const; });
    const lifetime = new AbortController();
    registerForkAdoption(ctx, { adopt }, { signal: lifetime.signal });
    emit(announced('child', 'parent'));
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    lifetime.abort();
    expect(signals[0]!.aborted).toBe(true);
  });

  it('reports a rejected adoption instead of leaking an unhandled rejection', async () => {
    const { ctx, emit } = context();
    const failure = new Error('Adoption failed.');
    const report = vi.fn();
    registerForkAdoption(ctx, { adopt: async () => { throw failure; } }, { report });
    emit(announced('child', 'parent'));
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(failure));
  });

  it('contains a synchronous adoption throw and reports it', () => {
    const { ctx, emit } = context();
    const failure = new Error('Adopter threw.');
    const report = vi.fn();
    registerForkAdoption(ctx, { adopt: () => { throw failure; } }, { report });
    expect(emit(announced('child', 'parent'))).toBeUndefined();
    expect(report).toHaveBeenCalledWith(failure);
  });
});
