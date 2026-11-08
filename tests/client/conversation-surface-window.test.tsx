// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskConversationWindow, type ConversationWindowSession } from '../../src/client/conversation-surface.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function sessionState(overrides: Partial<ConversationWindowSession> = {}): ConversationWindowSession {
  return { openState: 'open', ...overrides };
}

function seat(options: {
  session?: ConversationWindowSession;
  factory?: (name: string, input: { variant: 'embedded' }, settings: { fallback: ReactNode }) => ReactNode;
  viewSession?: (sessionId: string) => (() => void) | undefined;
}) {
  const viewSession = options.viewSession ?? vi.fn(() => () => {});
  const factory = options.factory ?? vi.fn(() => <div data-testid="window" />);
  const result = render(<TaskConversationWindow
    sessionId="s1"
    useSession={(select: (value: ConversationWindowSession) => unknown) => select(options.session ?? sessionState())}
    renderFactorySlot={factory as never}
    viewSession={viewSession}
  />);
  return { ...result, factory, viewSession };
}

describe('TaskConversationWindow', () => {
  it('renders one embedded public window occurrence without a Session identity', () => {
    const { factory } = seat({});
    expect(screen.getByTestId('window')).toBeTruthy();
    expect(factory).toHaveBeenCalledWith('conversation.window', { variant: 'embedded' }, { fallback: expect.anything() });
    expect(screen.getByTestId('window').closest('[data-kanban-conversation-window]')).toBeTruthy();
  });

  it('renders the update-DSH notice when the host does not declare the Factory', () => {
    seat({ factory: (_name, _input, options) => options.fallback });
    expect(screen.getByRole('alert').textContent).toContain('Update DSH');
    expect(screen.getByRole('alert').textContent).not.toContain('opening');
  });

  it('reports an open failure instead of mounting the window', () => {
    const { factory } = seat({ session: sessionState({ openState: 'error', openError: { message: 'history unavailable' } }) });
    expect(factory).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('history unavailable');
    expect(screen.getByRole('alert').textContent).toContain('Close and reopen this tab');
  });

  it('tracks the displayed Session while the tab is visible', () => {
    const release = vi.fn();
    const viewSession = vi.fn(() => release);
    seat({ viewSession });
    expect(viewSession).toHaveBeenCalledWith('s1');
    const visibility = vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(release).toHaveBeenCalledOnce();
    visibility.mockRestore();
    fireEvent(document, new Event('visibilitychange'));
    expect(viewSession).toHaveBeenCalledTimes(2);
  });

  it('releases the read state when the tab unmounts', () => {
    const release = vi.fn();
    const { unmount } = seat({ viewSession: () => release });
    unmount();
    expect(release).toHaveBeenCalledOnce();
  });
});
