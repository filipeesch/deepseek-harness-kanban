import { describe, expect, it, vi } from 'vitest';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import { ConversationLeaseRegistry, conversationLeaseKey, type ConversationLeaseSessions } from '../../src/client/conversation-leases.js';

function reference(sessionId: string): SessionReference {
  return {
    sessionId,
    binding: { ctx: {}, eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } },
    ready: Promise.resolve({}),
    release: vi.fn(),
    [Symbol.dispose]() {},
  } as unknown as SessionReference;
}

function port(catalog: string[] = []) {
  const references = new Map<string, SessionReference>();
  const retain = vi.fn((target: unknown) => {
    const id = typeof target === 'string' ? target : (target as { childSessionId: string }).childSessionId;
    const ref = reference(id);
    references.set(id, ref);
    return ref;
  });
  const refresh = vi.fn(async () => {});
  let listed = [...catalog];
  const sessions = {
    retain,
    refresh,
    list: {
      subscribe: () => () => {},
      getSnapshot: () => ({
        ids: listed,
        byId: Object.fromEntries(listed.map(id => [id, { id }])),
        phase: 'ready' as const,
        projectionsBySession: {},
      }),
    },
  } as unknown as ConversationLeaseSessions;
  return {
    sessions, retain, refresh, references,
    list: (ids: string[]) => { listed = [...ids]; },
  };
}

function registry(p: ReturnType<typeof port>, lifetime = new AbortController()) {
  return { registry: new ConversationLeaseRegistry({ sessions: p.sessions, lifetime: lifetime.signal }), lifetime };
}

const address = { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' as const };

describe('conversation lease registry', () => {
  it('retains a catalogued conversation id and publishes it as ready', () => {
    const p = port(['s1']);
    const { registry: leases } = registry(p);
    leases.acquireRoot('s1');
    expect(p.retain).toHaveBeenCalledWith('s1', expect.objectContaining({ source: 'kanbanTaskDrawer' }));
    expect(leases.getSnapshot()['s1']?.status).toBe('ready');
  });

  it('retains an addressed descendant by its address and keys the snapshot by the child id', () => {
    const p = port(['child']);
    const { registry: leases } = registry(p);
    leases.acquireRoot(address);
    expect(conversationLeaseKey(address)).toBe('child');
    expect(p.retain).toHaveBeenCalledWith(address, expect.objectContaining({ source: 'kanbanTaskDrawer' }));
    expect(leases.getSnapshot()['child']?.status).toBe('ready');
  });

  it('refreshes once for an unknown Session and reports a miss', async () => {
    const p = port([]);
    const { registry: leases } = registry(p);
    leases.acquireRoot('missing');
    await vi.waitFor(() => expect(leases.getSnapshot()['missing']?.status).toBe('error'));
    expect(p.refresh).toHaveBeenCalledOnce();
    expect(leases.getSnapshot()['missing']?.error).toContain('not available');
  });

  it('retries a failed acquisition', async () => {
    const p = port([]);
    const { registry: leases } = registry(p);
    leases.acquireRoot('s1');
    await vi.waitFor(() => expect(leases.getSnapshot()['s1']?.status).toBe('error'));
    p.list(['s1']);
    leases.retry('s1');
    await vi.waitFor(() => expect(leases.getSnapshot()['s1']?.status).toBe('ready'));
    expect(p.retain).toHaveBeenCalledWith('s1', expect.anything());
  });

  it('releases a transient lease without touching roots', () => {
    const p = port(['root', 'child']);
    const { registry: leases } = registry(p);
    leases.acquireRoot('root');
    const release = leases.acquireTransient(address);
    expect(leases.getSnapshot()['child']?.status).toBe('ready');
    release();
    expect(leases.getSnapshot()['child']).toBeUndefined();
    expect(leases.getSnapshot()['root']?.status).toBe('ready');
    expect(p.references.get('child')?.release).toHaveBeenCalledOnce();
  });

  it('releases one conversation and keeps the rest', () => {
    const p = port(['one', 'two']);
    const { registry: leases } = registry(p);
    leases.acquireRoot('one');
    leases.acquireRoot('two');
    leases.release('one');
    expect(leases.getSnapshot()['one']).toBeUndefined();
    expect(leases.getSnapshot()['two']?.status).toBe('ready');
  });

  it('releases roots that left the open set and keeps transient leases', () => {
    const p = port(['one', 'two', 'child']);
    const { registry: leases } = registry(p);
    leases.acquireRoot('one');
    leases.acquireRoot('two');
    leases.acquireTransient(address);
    leases.retainOnly(['two']);
    expect(leases.getSnapshot()['one']).toBeUndefined();
    expect(leases.getSnapshot()['two']?.status).toBe('ready');
    expect(leases.getSnapshot()['child']?.status).toBe('ready');
  });

  it('releases everything when the plugin lifetime aborts and ignores later acquisitions', () => {
    const p = port(['one']);
    const controller = new AbortController();
    const { registry: leases } = registry(p, controller);
    leases.acquireRoot('one');
    controller.abort();
    expect(leases.getSnapshot()).toEqual({});
    expect(p.references.get('one')?.release).toHaveBeenCalledOnce();
    leases.acquireRoot('one');
    expect(p.retain).toHaveBeenCalledOnce();
  });

  it('keeps a remount reusable after dispose', () => {
    const p = port(['one']);
    const { registry: leases } = registry(p);
    leases.acquireRoot('one');
    leases.dispose();
    expect(leases.getSnapshot()).toEqual({});
    leases.acquireRoot('one');
    expect(leases.getSnapshot()['one']?.status).toBe('ready');
  });
});
