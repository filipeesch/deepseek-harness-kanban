import { describe, expect, it, vi } from 'vitest';
import { createForkClaim, createInheritedPrefixCheck } from '../../src/host/fork-claim.js';

const events = [
  { type: 'session/start', seq: 0, data: { cwd: '/repo' } },
  { type: 'turn/start', seq: 1, data: {} },
  { type: 'step/start', seq: 2, data: {} },
  { type: 'message', seq: 3, data: { role: 'user', text: 'hi' } },
  { type: 'message', seq: 4, data: { role: 'assistant', text: 'hello' } },
];

describe('inherited prefix proof', () => {
  it('accepts a branch that inherits the start of the claimed conversation', async () => {
    const check = createInheritedPrefixCheck(async sessionId => sessionId === 'child'
      ? { inheritedEventCount: 3, events: [...events.slice(0, 3), { type: 'session/end-seed', seq: 3 }] }
      : { events });
    await expect(check('child', 'parent')).resolves.toBe(true);
  });

  it('refuses a Session that inherits nothing', async () => {
    const check = createInheritedPrefixCheck(async sessionId => sessionId === 'child'
      ? { inheritedEventCount: 0, events: [] }
      : { events });
    await expect(check('child', 'parent')).resolves.toBe(false);
    const absent = createInheritedPrefixCheck(async sessionId => sessionId === 'child' ? { events: [] } : { events });
    await expect(absent('child', 'parent')).resolves.toBe(false);
  });

  it('refuses a branch of another conversation', async () => {
    const other = [{ type: 'session/start', seq: 0, data: { cwd: '/elsewhere' } }];
    const check = createInheritedPrefixCheck(async sessionId => sessionId === 'child'
      ? { inheritedEventCount: 1, events: other }
      : { events });
    await expect(check('child', 'parent')).resolves.toBe(false);
  });

  it('refuses an inheritance longer than the claimed conversation', async () => {
    const check = createInheritedPrefixCheck(async sessionId => sessionId === 'child'
      ? { inheritedEventCount: 9, events: events }
      : { events });
    await expect(check('child', 'parent')).resolves.toBe(false);
  });

  it('refuses a conversation claimed as its own branch', async () => {
    const check = createInheritedPrefixCheck(async () => ({ inheritedEventCount: 1, events }));
    await expect(check('same', 'same')).resolves.toBe(false);
  });
});

describe('claim with no recorded lineage', () => {
  function claim(ports: { inheritsPrefix?: (sessionId: string, parentSessionId: string) => Promise<boolean> }) {
    const adopter = { claim: vi.fn(async () => 'adopted' as const) };
    return {
      adopter,
      port: createForkClaim({
        adopter,
        lineage: async () => ({}),
        taskOfSession: () => undefined,
        ...ports,
      }),
    };
  }

  it('attaches a branch the log prefix proves', async () => {
    const f = claim({ inheritsPrefix: async () => true });
    await f.port.claim({ taskId: 't1', parentSessionId: 'parent', sessionId: 'child' });
    expect(f.adopter.claim).toHaveBeenCalledWith({ sessionId: 'child', parentSessionId: 'parent' }, undefined);
  });

  it('refuses a Session the prefix does not prove', async () => {
    const f = claim({ inheritsPrefix: async () => false });
    await expect(f.port.claim({ taskId: 't1', parentSessionId: 'parent', sessionId: 'child' }))
      .rejects.toMatchObject({ code: 'FORK_LINEAGE_MISMATCH' });
    expect(f.adopter.claim).not.toHaveBeenCalled();
  });

  it('fails closed when the host cannot prove anything', async () => {
    const f = claim({});
    await expect(f.port.claim({ taskId: 't1', parentSessionId: 'parent', sessionId: 'child' }))
      .rejects.toMatchObject({ code: 'FORK_LINEAGE_MISMATCH' });
  });

  it('still honours a recorded parent', async () => {
    const adopter = { claim: vi.fn(async () => 'adopted' as const) };
    const port = createForkClaim({ adopter, lineage: async () => ({ parentSessionId: 'parent' }), taskOfSession: () => undefined, inheritsPrefix: async () => false });
    await port.claim({ taskId: 't1', parentSessionId: 'parent', sessionId: 'child' });
    expect(adopter.claim).toHaveBeenCalledOnce();
    await expect(port.claim({ taskId: 't1', parentSessionId: 'other', sessionId: 'child' }))
      .rejects.toMatchObject({ code: 'FORK_LINEAGE_MISMATCH' });
  });
});
