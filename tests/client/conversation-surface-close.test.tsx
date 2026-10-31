// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RetainedConversation, type ConversationSurfaceOwner, type ConversationSurfaceServices } from '../../src/client/conversation-surface.js';
import { ConversationActionsProvider, type ConversationActions } from '../../src/client/conversation-actions.js';

afterEach(cleanup);

function mount(sessions: ConversationSurfaceServices['sessions']) {
  const close = vi.fn();
  const actions: ConversationActions = { activeSessionId: 's1', canClose: true, pending: false, close, label: () => 'Planner' };
  const services: ConversationSurfaceServices = {
    sessions,
    claimComposer: () => () => {},
    lifetime: new AbortController().signal,
    hold: () => {},
    release: () => {},
  };
  const owner: ConversationSurfaceOwner = {
    SessionProvider: ({ children }) => <>{children}</>,
    renderSlot: () => null,
  };
  render(<ConversationActionsProvider value={actions}><RetainedConversation id="s1" owner={owner} services={services} /></ConversationActionsProvider>);
  return { close };
}

describe('retained native conversation failure states', () => {
  it('keeps the close action in the native loading surface', async () => {
    const { close } = mount({ refresh: vi.fn(async () => {}), retain: vi.fn(() => ({ ready: new Promise(() => {}) })) as unknown as ConversationSurfaceServices['sessions']['retain'] });
    expect(await screen.findByText(/Opening native conversation/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Planner' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the close action in the native error surface', async () => {
    const { close } = mount({ refresh: vi.fn(async () => {}), retain: vi.fn(() => { throw new Error('native unavailable'); }) });
    expect(await screen.findByText(/native unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Planner' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
