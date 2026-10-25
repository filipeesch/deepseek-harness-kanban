// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import { RetainedConversation, type ConversationSurfaceOwner, type ConversationSurfaceServices } from '../../src/client/conversation-surface.js';
import type { DrawerSubagentAddress } from '../../src/client/conversation-navigation.js';

afterEach(cleanup);
const child: DrawerSubagentAddress = { parentSessionId: 'root-1', childSessionId: 'child-1', mode: 'continuable' };
function reference(sessionId: string): SessionReference {
  return { sessionId, binding: { ctx: {}, eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } }, ready: Promise.resolve({}), release: vi.fn(), [Symbol.dispose]() {} } as unknown as SessionReference;
}
function harness() {
  const retained = reference('child-1');
  const retain = vi.fn(() => retained);
  const refresh = vi.fn(async () => {});
  const claimComposer = vi.fn(() => () => {});
  const hold = vi.fn(); const release = vi.fn();
  const services: ConversationSurfaceServices = {
    sessions: { refresh, retain },
    claimComposer,
    lifetime: new AbortController().signal,
    hold, release,
  };
  const owner: ConversationSurfaceOwner = {
    SessionProvider: ({ session, children }) => <div data-testid="provider" data-session={session.sessionId}>{children}</div>,
    renderSlot: key => <div data-testid={'slot-' + key} />,
  };
  return { retained, retain, refresh, claimComposer, hold, release, services, owner };
}

describe('retained conversation surface', () => {
  it('retains a peeked subagent by address and renders the hosted header before content', async () => {
    const f = harness();
    const view = render(<RetainedConversation id="root-1" target={child} owner={f.owner} services={f.services} />);
    const provider = await screen.findByTestId('provider');
    expect(provider.getAttribute('data-session')).toBe('child-1');
    expect(f.retain).toHaveBeenCalledWith({ parentSessionId: 'root-1', childSessionId: 'child-1', mode: 'continuable' }, expect.objectContaining({ source: 'kanbanTaskDrawer' }));
    const header = screen.getByTestId('slot-kanban.session.header');
    const conversation = screen.getByTestId('slot-kanban.conversation');
    expect(header.compareDocumentPosition(conversation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(f.claimComposer).toHaveBeenCalledWith('child-1');
    expect(f.hold).toHaveBeenCalledWith(f.retained);
    view.unmount();
    expect(f.release).toHaveBeenCalledWith(f.retained);
  });

  it('retains a root by session id and refuses a second composer without retaining', async () => {
    const f = harness();
    const view = render(<RetainedConversation id="root-1" owner={f.owner} services={{ ...f.services, claimComposer: () => null }} />);
    expect((await screen.findByRole('alert')).textContent).toContain('already has an active Kanban composer');
    expect(f.retain).not.toHaveBeenCalled();
    view.unmount();
    const next = harness();
    render(<RetainedConversation id="root-1" owner={next.owner} services={next.services} />);
    await waitFor(() => expect(next.retain).toHaveBeenCalledWith('root-1', expect.objectContaining({ source: 'kanbanTaskDrawer' })));
  });
});
