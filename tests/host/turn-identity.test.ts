import { describe, expect, it } from 'vitest';
import { openTurnIdentity } from '../../src/host/turn-identity.js';

describe('open turn identity', () => {
  it('requires a valid live boundary for the calling session', () => {
    const port = { boundary: (sessionId: string) => sessionId === 's1' ? { openTurnStartSeq: 0, lastTurn: 4 } : undefined };
    expect(openTurnIdentity(port, 's1')).toEqual({ sessionId: 's1', turn: 4 });
    expect(openTurnIdentity(port, 's2')).toBeUndefined();
    expect(openTurnIdentity(port, undefined)).toBeUndefined();
  });
  it('fails closed on closed, malformed and unsupported boundaries', () => {
    expect(openTurnIdentity({ boundary: () => ({ openTurnStartSeq: null, lastTurn: 1 }) }, 's')).toBeUndefined();
    expect(openTurnIdentity({ boundary: () => ({ openTurnStartSeq: 1, lastTurn: NaN }) }, 's')).toBeUndefined();
    expect(openTurnIdentity({ boundary: () => { throw Error('unsupported'); } }, 's')).toBeUndefined();
  });
});
