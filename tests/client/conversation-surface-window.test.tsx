// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RetainedConversation, TaskConversationWindow, type ConversationSurfaceOwner, type ConversationSurfaceServices, type ConversationWindowSession } from '../../src/client/conversation-surface.js';
import { ConversationLeaseRegistry } from '../../src/client/conversation-leases.js';
import { ConversationLeasesProvider } from '../../src/client/conversation-lease-context.js';
import type { SidebarPanelPort } from '../../src/client/sidebar-panel-port.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function sessionState(overrides: Partial<ConversationWindowSession> = {}): ConversationWindowSession {
  return { openState: 'open', ...overrides };
}

function seat(options: {
  session?: ConversationWindowSession;
  factory?: (name: string, input: { variant: 'embedded' }, settings: { fallback: ReactNode }) => ReactNode;
  viewSession?: (sessionId: string) => (() => void) | undefined;
  sidebar?: { port: SidebarPanelPort | undefined; renderPanel: () => ReactNode };
}) {
  const viewSession = options.viewSession ?? vi.fn(() => () => {});
  const factory = options.factory ?? vi.fn(() => <div data-testid="window" />);
  const result = render(<TaskConversationWindow
    sessionId="s1"
    useSession={(select: (value: ConversationWindowSession) => unknown) => select(options.session ?? sessionState())}
    renderFactorySlot={factory as never}
    viewSession={viewSession}
    {...(options.sidebar === undefined ? {} : { sidebar: options.sidebar })}
  />);
  return { ...result, factory, viewSession };
}

function panelPort(expanded: boolean): SidebarPanelPort {
  let value = expanded;
  const listeners = new Set<() => void>();
  const source = {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    forSession: sessionId => ({
      sessionId,
      expanded: source,
      setExpanded: (next: boolean) => { value = next; for (const listener of [...listeners]) listener(); },
    }),
  };
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

  it('mounts the native window on a failed open instead of preempting it with a plugin message', () => {
    const { factory } = seat({ session: sessionState({ openState: 'error', openError: { message: 'history unavailable' } }) });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('window')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toContain('Close and reopen');
  });

  it('keeps its previous markup when the drawer has no panel port', () => {
    seat({});
    expect(screen.getByTestId('window')).toBeTruthy();
    expect(document.querySelector('.kb-workspace')).toBeNull();
  });

  it('mounts the workspace beside the window when the port reports an expanded panel', () => {
    seat({ sidebar: { port: panelPort(true), renderPanel: () => <div data-testid="panel" /> } });
    expect(screen.getByTestId('window')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Right Sidebar' })).toBeTruthy();
    expect(screen.getByTestId('panel')).toBeTruthy();
    expect(document.querySelector('.kb-workspace .kb-conversation-window')).toBeTruthy();
  });

  it('does not mount the workspace for a peeked descendant', async () => {
    const reference = {
      sessionId: 's1',
      binding: { ctx: {}, eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } },
      ready: Promise.resolve({}),
      release: vi.fn(),
      [Symbol.dispose]() {},
    };
    const registry = new ConversationLeaseRegistry({
      sessions: {
        retain: () => reference as never,
        refresh: async () => {},
        list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: ['s1'], byId: { s1: { id: 's1' } }, phase: 'ready' as const, projectionsBySession: {} }) },
      } as never,
      lifetime: new AbortController().signal,
    });
    const services: ConversationSurfaceServices = { claimComposer: () => () => {} };
    const owner: ConversationSurfaceOwner = {
      SessionProvider: ({ children }) => <div>{children}</div>,
      renderSlot: () => <TaskConversationWindow
        sessionId="s1"
        useSession={(select: (value: ConversationWindowSession) => unknown) => select(sessionState())}
        renderFactorySlot={(() => <div data-testid="window" />) as never}
        viewSession={() => () => {}}
        sidebar={{ port: panelPort(true), renderPanel: () => <div data-testid="panel" /> }}
      />,
    };
    // A peek is retained transiently by the surface that presents it.
    registry.acquireTransient({ parentSessionId: 'parent', childSessionId: 's1', mode: 'continuable' });
    render(<ConversationLeasesProvider registry={registry}>
      <RetainedConversation id="s1" owner={owner} services={services} mode="peek" />
    </ConversationLeasesProvider>);
    expect(await screen.findByTestId('window')).toBeTruthy();
    expect(document.querySelector('.kb-workspace')).toBeNull();
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
