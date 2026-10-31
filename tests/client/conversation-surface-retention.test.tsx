// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import { RetainedConversation, type ConversationSurfaceOwner, type ConversationSurfaceServices } from '../../src/client/conversation-surface.js';
import type { DrawerSubagentAddress } from '../../src/client/conversation-navigation.js';
import { ConversationLeaseRegistry, type ConversationLeaseSessions } from '../../src/client/conversation-leases.js';
import { ConversationLeasesProvider } from '../../src/client/conversation-lease-context.js';

afterEach(cleanup);
const child: DrawerSubagentAddress = { parentSessionId: 'root-1', childSessionId: 'child-1', mode: 'continuable' };

function reference(sessionId: string): SessionReference {
  return {
    sessionId,
    binding: { ctx: {}, eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } },
    ready: Promise.resolve({}),
    release: vi.fn(),
    [Symbol.dispose]() {},
  } as unknown as SessionReference;
}

function sessions(retain: (target: unknown) => SessionReference, catalog: string[] = ['root-1']): ConversationLeaseSessions {
  return {
    retain,
    refresh: vi.fn(async () => {}),
    list: {
      subscribe: () => () => {},
      getSnapshot: () => ({
        ids: catalog,
        byId: Object.fromEntries(catalog.map(id => [id, { id }])),
        phase: 'ready' as const,
        projectionsBySession: {},
      }),
    },
    subagentAddress: (sessionId: string) => sessionId === 'child-1'
      ? { parentSessionId: 'root-1', childSessionId: 'child-1', mode: 'continuable' as const }
      : undefined,
  } as unknown as ConversationLeaseSessions;
}

function harness(retainTarget?: unknown) {
  const retained = reference('child-1');
  const retain = vi.fn((target: unknown) => { void target; return retained; });
  const refresh = vi.fn(async () => {});
  const claimComposer = vi.fn(() => () => {});
  const port = sessions(retain);
  port.refresh = refresh;
  const services: ConversationSurfaceServices = { claimComposer };
  const registry = new ConversationLeaseRegistry({ sessions: port, lifetime: new AbortController().signal });
  const owner: ConversationSurfaceOwner = {
    SessionProvider: ({ session, children }) => <div data-testid="provider" data-session={session.sessionId}>{children}</div>,
    renderSlot: key => <div data-testid={'slot-' + key} />,
  };
  void retainTarget;
  return { retained, retain, refresh, claimComposer, port, registry, owner, services };
}

function surface(f: ReturnType<typeof harness>, props: { id: string; target?: DrawerSubagentAddress }) {
  return <ConversationLeasesProvider registry={f.registry}>
    <RetainedConversation {...props} owner={f.owner} services={f.services} />
  </ConversationLeasesProvider>;
}

describe('retained conversation surface', () => {
  it('retains a peeked subagent by address and renders the hosted header before content', async () => {
    const f = harness();
    const view = render(surface(f, { id: 'root-1', target: child }));
    const provider = await screen.findByTestId('provider');
    expect(provider.getAttribute('data-session')).toBe('child-1');
    expect(f.retain).toHaveBeenCalledWith(child, expect.objectContaining({ source: 'kanbanTaskDrawer' }));
    const header = screen.getByTestId('slot-kanban.session.header');
    const conversation = screen.getByTestId('slot-kanban.conversation');
    expect(header.compareDocumentPosition(conversation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(f.claimComposer).toHaveBeenCalledWith('child-1');
    view.unmount();
    expect(f.retained.release).toHaveBeenCalledOnce();
    f.registry.dispose();
  });

  it('keeps a visited root conversation warm across unmount and reuses it on return', async () => {
    const f = harness();
    const first = render(surface(f, { id: 'root-1' }));
    await screen.findByTestId('provider');
    expect(f.retain).toHaveBeenCalledWith('root-1', expect.objectContaining({ source: 'kanbanTaskDrawer' }));
    expect(f.refresh).not.toHaveBeenCalled();
    first.unmount();
    expect(f.retained.release).not.toHaveBeenCalled();
    render(surface(f, { id: 'root-1' }));
    await screen.findByTestId('provider');
    expect(f.retain).toHaveBeenCalledOnce();
    f.registry.dispose();
    expect(f.retained.release).toHaveBeenCalledOnce();
  });

  it('refuses a second composer without retaining', async () => {
    const f = harness();
    render(surface(f, { id: 'root-1' }));
    expect(await screen.findByTestId('provider')).toBeTruthy();
    expect(f.claimComposer).toHaveBeenCalledWith('root-1');
    const retained = f.retain.mock.calls.length;
    const refused = new ConversationLeaseRegistry({ sessions: f.port, lifetime: new AbortController().signal });
    render(<ConversationLeasesProvider registry={refused}><RetainedConversation id="root-1" owner={f.owner} services={{ ...f.services, claimComposer: () => null }} /></ConversationLeasesProvider>);
    expect((await screen.findByRole('alert')).textContent).toContain('already has an active Kanban composer');
    expect(f.retain).toHaveBeenCalledTimes(retained);
    refused.dispose();
    f.registry.dispose();
  });

  it('refreshes the catalog once when the session is unknown and then acquires it', async () => {
    const f = harness();
    let catalog: string[] = [];
    const port = {
      retain: f.retain,
      refresh: vi.fn(async () => { catalog = ['root-1']; }),
      list: {
        subscribe: () => () => {},
        getSnapshot: () => ({ ids: catalog, byId: Object.fromEntries(catalog.map(id => [id, { id }])), phase: 'ready' as const, projectionsBySession: {} }),
      },
      subagentAddress: () => undefined,
    } as unknown as ConversationLeaseSessions;
    const registry = new ConversationLeaseRegistry({ sessions: port, lifetime: new AbortController().signal });
    render(<ConversationLeasesProvider registry={registry}><RetainedConversation id="root-1" owner={f.owner} services={f.services} /></ConversationLeasesProvider>);
    expect(await screen.findByTestId('provider')).toBeTruthy();
    expect(port.refresh).toHaveBeenCalledOnce();
    expect(f.retain).toHaveBeenCalledWith('root-1', expect.objectContaining({ source: 'kanbanTaskDrawer' }));
    registry.dispose();
  });

  it('reports a second catalog miss after the refresh instead of retaining', async () => {
    const f = harness();
    const port = sessions(f.retain, []);
    const registry = new ConversationLeaseRegistry({ sessions: port, lifetime: new AbortController().signal });
    render(<ConversationLeasesProvider registry={registry}><RetainedConversation id="root-1" owner={f.owner} services={f.services} /></ConversationLeasesProvider>);
    expect(await screen.findByText(/not available in the session catalog/)).toBeTruthy();
    expect(port.refresh).toHaveBeenCalledOnce();
    expect(f.retain).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('reports a catalog refresh failure as the acquisition failure', async () => {
    const f = harness();
    const port = sessions(f.retain, []);
    port.refresh = vi.fn(async () => { throw new Error('catalog unavailable'); });
    const registry = new ConversationLeaseRegistry({ sessions: port, lifetime: new AbortController().signal });
    render(<ConversationLeasesProvider registry={registry}><RetainedConversation id="root-1" owner={f.owner} services={f.services} /></ConversationLeasesProvider>);
    expect(await screen.findByText(/catalog unavailable/)).toBeTruthy();
    expect(f.retain).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('retains only the open conversations of the mounted drawer', async () => {
    const f = harness();
    const first = reference('one');
    const second = reference('two');
    const retain = vi.fn((target: unknown) => target === 'one' ? first : second);
    const port = sessions(retain, ['one', 'two']);
    const registry = new ConversationLeaseRegistry({ sessions: port, lifetime: new AbortController().signal });
    registry.acquireRoot('one');
    registry.acquireRoot('two');
    expect(retain).toHaveBeenCalledTimes(2);
    registry.retainOnly(['one']);
    expect(first.release).not.toHaveBeenCalled();
    expect(second.release).toHaveBeenCalledOnce();
    registry.dispose();
    expect(first.release).toHaveBeenCalledOnce();
  });
});

describe('lease registry subscription', () => {
  it('publishes a stable per-conversation state', async () => {
    const f = harness();
    f.registry.acquireRoot('root-1');
    const state = f.registry.getSnapshot()['root-1'];
    expect(state?.status).toBe('ready');
    expect(state?.reference).toBe(f.retained);
    f.registry.release('root-1');
    expect(f.registry.getSnapshot()['root-1']).toBeUndefined();
    expect(f.retained.release).toHaveBeenCalledOnce();
    f.registry.dispose();
  });
});
