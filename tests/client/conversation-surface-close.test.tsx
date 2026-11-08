// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import { RetainedConversation, type ConversationSurfaceOwner, type ConversationSurfaceServices } from '../../src/client/conversation-surface.js';
import { ConversationLeaseRegistry, type ConversationLeaseSessions } from '../../src/client/conversation-leases.js';
import { ConversationLeasesProvider } from '../../src/client/conversation-lease-context.js';

afterEach(cleanup);

function reference(sessionId: string, ready: Promise<unknown> = Promise.resolve({})): SessionReference {
  return {
    sessionId,
    binding: { ctx: {}, eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } },
    ready,
    release: vi.fn(),
    [Symbol.dispose]() {},
  } as unknown as SessionReference;
}

function sessions(retain: (target: unknown) => SessionReference, catalog: string[] = ['s1']): ConversationLeaseSessions {
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
  } as unknown as ConversationLeaseSessions;
}

function mount(port: ConversationLeaseSessions) {
  const services: ConversationSurfaceServices = { claimComposer: () => () => {} };
  const owner: ConversationSurfaceOwner = {
    SessionProvider: ({ session, children }) => <div data-testid="provider" data-session={session.sessionId}>{children}</div>,
    renderSlot: key => <div data-testid={'slot-' + key} />,
  };
  const registry = new ConversationLeaseRegistry({ sessions: port, lifetime: new AbortController().signal });
  render(<ConversationLeasesProvider registry={registry}>
    <RetainedConversation id="s1" owner={owner} services={services} />
  </ConversationLeasesProvider>);
  return { registry };
}

describe('retained native conversation surface', () => {
  it('renders the native surface without waiting for history to settle', async () => {
    const { registry } = mount(sessions(() => reference('s1', new Promise(() => {}))));
    expect(await screen.findByTestId('provider')).toBeTruthy();
    expect(screen.queryByText(/Opening native conversation/)).toBeNull();
    registry.dispose();
  });

  it('reports an acquisition failure and offers retry', async () => {
    mount(sessions(() => { throw new Error('native unavailable'); }));
    expect(await screen.findByText(/native unavailable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry conversation' })).toBeTruthy();
  });

  it('retries a failed acquisition', async () => {
    let attempts = 0;
    const port = sessions(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('native unavailable');
      return reference('s1');
    });
    mount(port);
    expect(await screen.findByText(/native unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation' }));
    await waitFor(() => expect(screen.getByTestId('provider')).toBeTruthy());
    expect(attempts).toBe(2);
  });
});
