import { describe, expect, it } from 'vitest';
import { ConversationProbe } from '../../src/host/conversation-probe.js';
import type { SessionPort } from '../../src/shared/ports.js';

function sessions(busy: string[] = []) {
  const calls: string[] = [];
  const port = { isIdle: async (id: string) => { calls.push(id); return !busy.includes(id); } };
  return { port: port as unknown as Pick<SessionPort, 'isIdle'>, calls };
}

describe('ConversationProbe', () => {
  it('answers for a participant set with one read per conversation, in parallel', async () => {
    const f = sessions();
    const probe = new ConversationProbe(f.port);
    await expect(probe.allIdle(['a', 'b'])).resolves.toBe(true);
    expect(f.calls).toEqual(['a', 'b']);
  });

  it('reads a repeated conversation id once', async () => {
    const f = sessions();
    const probe = new ConversationProbe(f.port);
    await probe.allIdle(['a', 'a', 'a']);
    expect(f.calls).toEqual(['a']);
  });

  it('reports a busy conversation as not idle', async () => {
    const f = sessions(['b']);
    const probe = new ConversationProbe(f.port);
    await expect(probe.allIdle(['a', 'b'])).resolves.toBe(false);
  });

  it('never reuses a verdict across calls, because any await can start new work', async () => {
    const f = sessions();
    const probe = new ConversationProbe(f.port);
    await probe.allIdle(['a']);
    await probe.allIdle(['a']);
    expect(f.calls).toEqual(['a', 'a']);
  });
});
