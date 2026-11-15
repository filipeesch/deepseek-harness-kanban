// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import { TaskDrawer } from '../../src/client/drawer.js';
import { createTaskPageState } from '../../src/client/page-state.js';
import { EMPTY_DRAWER_VIEW, openPeek, type DrawerView, type ForkClaim } from '../../src/client/drawer-view.js';
import { RetainedConversation, TaskConversationWindow, type ConversationSurfaceOwner } from '../../src/client/conversation-surface.js';
import { ConversationLeaseRegistry, type ConversationLeaseSessions } from '../../src/client/conversation-leases.js';
import { ConversationLeasesProvider } from '../../src/client/conversation-lease-context.js';
import { fakeApi, fixture, type TestSnapshot } from './helpers.js';
import { PresetProvider, presetPort } from './agent-preset-fixture.js';
import type { SubagentTarget } from '../../src/client/drawer-navigation.js';

afterEach(cleanup);

const child: SubagentTarget = { parentSessionId: 's1', sessionId: 'child', mode: 'continuable' };

function reference(sessionId: string): SessionReference {
  return { sessionId, binding: { ctx: {}, eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } }, ready: Promise.resolve({}), release: vi.fn(), [Symbol.dispose]() {} } as unknown as SessionReference;
}

function sessionsPort(catalog: string[] = ['s1', 's2', 'child']) {
  const references = new Map<string, SessionReference>();
  const retain = vi.fn((target: unknown) => {
    const id = typeof target === 'string' ? target : (target as { childSessionId: string }).childSessionId;
    const ref = reference(id);
    references.set(id, ref);
    return ref;
  });
  const port = {
    retain,
    refresh: vi.fn(async () => {}),
    list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: catalog, byId: Object.fromEntries(catalog.map(id => [id, { id }])), phase: 'ready' as const, projectionsBySession: {} }) },
  } as unknown as ConversationLeaseSessions;
  return { port, retain, references };
}

/** A fake of the client navigation coordinator's change source. */
function navigationSource() {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    source: { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => version },
    bump() { version += 1; for (const listener of [...listeners]) listener(); },
  };
}

function mount(options: { view?: DrawerView; claim?: ForkClaim | null; onOpenInMain?: (sessionId: string) => void; navigation?: ReturnType<typeof navigationSource>['source'] } = {}) {
  const data = fixture();
  const mock = fakeApi(data);
  const renderConversation = vi.fn((id: string, mode?: string) => <div data-testid={'surface-' + id + '-' + (mode ?? 'conversation')} />);
  const viewState = createTaskPageState();
  viewState.view = options.view ?? EMPTY_DRAWER_VIEW;
  if (options.claim !== undefined) viewState.claim = options.claim;
  const lifetime = new AbortController();
  const sessions = sessionsPort();
  function Harness() {
    const [live, setLive] = useState<TestSnapshot>(data);
    useEffect(() => mock.api.subscribe(snapshot => setLive(snapshot as TestSnapshot)), []);
    return <TaskDrawer
      task={live.state.tasks[0]!}
      state={live.state}
      api={mock.api}
      run={mock.api.command}
      renderConversation={renderConversation}
      onClose={() => {}}
      onMove={async () => true}
      onDanger={() => {}}
      viewState={viewState}
      conversationLeases={{ sessions: sessions.port, lifetime: lifetime.signal }}
      {...(options.navigation === undefined ? {} : { navigation: options.navigation })}
      {...(options.onOpenInMain === undefined ? {} : { onOpenInMain: options.onOpenInMain })}
    />;
  }
  const view = render(<PresetProvider port={presetPort()}><Harness /></PresetProvider>);
  return { ...mock, ...view, viewState, renderConversation, sessions, lifetime };
}

describe('transient subagent peek in the task drawer', () => {
  it('renders the peeked descendant in place of the conversation body and keeps the task tabs', async () => {
    const f = mount({ view: openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child) });
    await screen.findByRole('tab', { name: 'Agent 1' });
    const tabs = within(screen.getByRole('tablist', { name: 'Agent conversations' }));
    expect(tabs.getByRole('tab', { name: 'Agent 1' }).getAttribute('aria-selected')).toBe('true');
    expect(tabs.getByRole('tab', { name: 'Agent 2' })).toBeTruthy();
    expect(await screen.findByTestId('surface-child-peek')).toBeTruthy();
    expect(f.renderConversation).toHaveBeenLastCalledWith('child', 'peek');
  });

  it('returns to the task conversation when a tab is selected', async () => {
    const f = mount({ view: openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child) });
    await screen.findByTestId('surface-child-peek');
    fireEvent.click(screen.getByRole('tab', { name: 'Agent 2' }));
    expect(await screen.findByTestId('surface-s2-conversation')).toBeTruthy();
    expect(f.viewState.view).toEqual({ kind: 'conversation', sessionId: 's2', selectionRequired: false });
    expect(f.renderConversation).toHaveBeenLastCalledWith('s2');
  });

  it('ends the peek when the section changes away from Conversations', async () => {
    const f = mount({ view: openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child) });
    await screen.findByTestId('surface-child-peek');
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    await waitFor(() => expect(f.viewState.view).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: false }));
  });

  it('does not persist the peek into the task', async () => {
    const f = mount({ view: openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child) });
    await screen.findByTestId('surface-child-peek');
    expect(f.get().state.tasks[0]!.sessionIds).toEqual(['s1', 's2']);
    expect(f.get().state.tasks[0]!.closedSessionIds).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Agent 1' }));
    await waitFor(() => expect(f.viewState.view.kind).toBe('conversation'));
    expect(f.get().state.tasks[0]!.sessionIds).toEqual(['s1', 's2']);
    // No conversation command is sent for a peek: it is view state, never a task fact.
    const conversationCommands = f.command.mock.calls.map(([value]) => (value as { type: string }).type).filter(type => type.startsWith('conversation.'));
    expect(conversationCommands).toEqual([]);
  });

  it('ends the peek when the descendant is no longer available', async () => {
    const data = fixture();
    const mock = fakeApi(data);
    const renderConversation = vi.fn((id: string, mode?: string) => <div data-testid={'surface-' + id + '-' + (mode ?? 'conversation')} />);
    const viewState = createTaskPageState();
    viewState.view = openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child);
    const lifetime = new AbortController();
    const sessions = sessionsPort();
    sessions.port.retain = vi.fn((target: unknown) => {
      if (typeof target === 'object' && (target as { childSessionId?: string }).childSessionId === 'child') throw new Error('The conversation is gone.');
      return reference(typeof target === 'string' ? target : 'unknown');
    }) as unknown as ConversationLeaseSessions['retain'];
    render(<PresetProvider port={presetPort()}><TaskDrawer
      task={mock.get().state.tasks[0]!}
      state={mock.get().state}
      api={mock.api}
      run={mock.api.command}
      renderConversation={renderConversation}
      onClose={() => {}}
      onMove={async () => true}
      onDanger={() => {}}
      viewState={viewState}
      conversationLeases={{ sessions: sessions.port, lifetime: lifetime.signal }}
    /></PresetProvider>);
    await waitFor(() => expect(viewState.view).toEqual({ kind: 'conversation', sessionId: 's1', selectionRequired: false }));
    expect(await screen.findByTestId('surface-s1-conversation')).toBeTruthy();
  });

  it('retains the peeked descendant only while the peek is shown', async () => {
    const f = mount({ view: openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child) });
    await screen.findByTestId('surface-child-peek');
    const targets = f.sessions.retain.mock.calls.map(([target]) => target);
    expect(targets.some(target => typeof target === 'object' && (target as { childSessionId?: string }).childSessionId === 'child')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Agent 1' }));
    await waitFor(() => expect(f.sessions.references.get('child')?.release).toHaveBeenCalled());
    expect(f.viewState.view.kind).toBe('conversation');
  });
});

describe('conversation surface peek mode', () => {
  function surface(mode: 'peek' | undefined, viewSession: (sessionId: string) => (() => void) | undefined) {
    const sessions = sessionsPort(['child']);
    const registry = new ConversationLeaseRegistry({ sessions: sessions.port, lifetime: new AbortController().signal });
    registry.acquireTransient({ parentSessionId: 's1', childSessionId: 'child', mode: 'continuable' });
    const owner: ConversationSurfaceOwner = {
      SessionProvider: ({ children }) => <>{children}</>,
      renderSlot: () => <TaskConversationWindow
        sessionId="child"
        useSession={selector => selector({ openState: 'open' })}
        renderFactorySlot={((_name: string, _input: unknown, options: { fallback: React.ReactNode }) => options.fallback) as never}
        viewSession={viewSession}
      />,
    };
    return <ConversationLeasesProvider registry={registry}>
      <RetainedConversation id="child" owner={owner} services={{ claimComposer: () => () => {} }} {...(mode === undefined ? {} : { mode })} />
    </ConversationLeasesProvider>;
  }

  it('does not acknowledge a peeked descendant as a task conversation', async () => {
    const viewSession = vi.fn(() => () => {});
    render(surface('peek', viewSession));
    await waitFor(() => expect(screen.getByText('Native conversation unavailable')).toBeTruthy());
    expect(viewSession).not.toHaveBeenCalled();
  });

  it('tracks read state for a task conversation surface', async () => {
    const viewSession = vi.fn(() => () => {});
    render(surface(undefined, viewSession));
    await waitFor(() => expect(viewSession).toHaveBeenCalledWith('child'));
  });
});

describe('client navigation outcomes', () => {
  it('re-renders the drawer when the coordinator changes the presented view', async () => {
    const nav = navigationSource();
    const f = mount({ view: { kind: 'conversation', sessionId: 's1', selectionRequired: false }, navigation: nav.source });
    await screen.findByTestId('surface-s1-conversation');
    act(() => {
      f.viewState.view = openPeek({ kind: 'conversation', sessionId: 's1', selectionRequired: false }, child);
      nav.bump();
    });
    expect(await screen.findByTestId('surface-child-peek')).toBeTruthy();
    // The drawer itself was not remounted.
    expect(screen.getByRole('tablist', { name: 'Agent conversations' })).toBeTruthy();
  });
});

describe('claimed fork notices', () => {
  const conversation: DrawerView = { kind: 'conversation', sessionId: 's1', selectionRequired: false };

  it('shows a pending status while the host attaches the branch', async () => {
    mount({ view: conversation, claim: { sessionId: 'fork' } });
    expect((await screen.findByRole('status')).textContent).toContain('Attaching the branch…');
  });

  it('reports a failed claim and offers the main chat', async () => {
    const onOpenInMain = vi.fn();
    const f = mount({ view: conversation, claim: { sessionId: 'fork', error: 'The task is busy; the branch could not be attached yet.' }, onOpenInMain });
    expect(await screen.findByText('Branch not added')).toBeTruthy();
    // The alert carries the reason only; the actions stay outside it.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The task is busy; the branch could not be attached yet.');
    expect(within(alert).queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open in main chat' }));
    expect(onOpenInMain).toHaveBeenCalledWith('fork');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(f.viewState.claim).toBeNull());
    expect(screen.queryByText('Branch not added')).toBeNull();
  });
});
