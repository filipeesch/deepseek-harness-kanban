// @vitest-environment jsdom
import React, { useEffect, type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { NativeSessionHeader } from '../../src/client/native-session-header.js';
import type { NativeLocaleSource, NativeSlotSource } from '../../src/client/native-slot-host.js';
import type { ModePort } from '../../src/client/mode-port.js';
import type { ConversationNavigation, DrawerSubagentAddress } from '../../src/client/conversation-navigation.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const child: DrawerSubagentAddress = { parentSessionId: 'a', childSessionId: 'child', mode: 'continuable' };
function entry(id: string, component: ComponentType<Record<string, unknown>>, extra: Partial<StoredEntry> = {}): StoredEntry {
  return { component, options: { id }, ...extra } as unknown as StoredEntry;
}
function slots(initial: Record<string, StoredEntry[]>) {
  let value = initial; const listeners = new Map<string, Set<() => void>>();
  return {
    source: {
      entriesOfSlot: (key: string) => value[key] ?? [],
      subscribe: (key: string, listener: () => void) => {
        const set = listeners.get(key) ?? new Set(); set.add(listener); listeners.set(key, set);
        return () => { set.delete(listener); };
      },
    } satisfies NativeSlotSource,
    set(key: string, entries: StoredEntry[]) { value = { ...value, [key]: entries }; for (const listener of listeners.get(key) ?? []) listener(); },
  };
}
const locale: NativeLocaleSource = {
  bind: namespace => (key: string) => namespace + ':' + key,
  getSnapshot: () => ({ revision: 0 }),
  subscribe: () => () => {},
};

function Header(props: Record<string, unknown>) {
  return <div data-testid="native-header" data-chrome={String(props.hideChrome)} data-view={String((props.useStore as (select: (value: { view: string }) => string) => string)(value => value.view))}>
    <button onClick={() => (props.open as (id: string) => void)('root')}>Root breadcrumb</button>
    {(props.renderSlot as (key: string, owner?: object, options?: object) => unknown)('conversation.session.header.actions', {}) as never}
    {(props.renderSlot as (key: string, owner?: object, options?: object) => unknown)('conversation.session.header.lineage', { lineageSessionId: 'child', displayTitle: 'Child', openTitle: () => {} }, { fallback: <span>lineage fallback</span> }) as never}
    {(props.renderSlot as (key: string, owner?: object, options?: object) => unknown)('conversation.session.header.utilities', {}) as never}
    {(props.renderSlot as (key: string, owner?: object, options?: object) => unknown)('conversation.session.header.corner', {}) as never}
    <span data-testid="views">{String((props.useConversationViews as (select: (value: readonly unknown[]) => number) => number)(value => value.length))}</span>
  </div>;
}

function Seat(props: Record<string, unknown>) {
  const state = (props.useAgentPresetSeat as (select: (value: { current: string; options: readonly unknown[] }) => { current: string; options: readonly unknown[] }) => { current: string; options: readonly unknown[] })(value => value);
  const mainView = (props.useSessionRetainInfo as (select: (value: { retainedBy: { mainView: number } }) => number) => number)(value => value.retainedBy.mainView);
  useEffect(() => { void (props.load as () => Promise<void>)(); }, [props.load]);
  return <div data-testid="mode-seat" data-main-view={mainView}><span>{state.current}</span><button onClick={() => void (props.select as (id: string) => Promise<string | undefined>)('ptc')}>Pick PTC</button></div>;
}

function action(id: string, component: ComponentType<Record<string, unknown>>, inject: () => Record<string, unknown>) {
  return entry(id, component, { inject } as Partial<StoredEntry>);
}

function configured() {
  const modePort: ModePort = { list: vi.fn(async () => [{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc', name: 'PTC' }]), select: vi.fn(async () => ({ ok: true })) };
  const originalOpenChild = vi.fn();
  const navigation: ConversationNavigation = { openSession: vi.fn(() => true), openSubagent: vi.fn(() => true) };
  const asideOpen = vi.fn();
  const load = vi.fn();
  const view = { blank: true }; const sessionView = { byId: { a: { origin: 'root', projectionValues: { agentPreset: 'standard' } } } };
  const standard = {
    sessionId: 'a',
    useSession: (select: (value: object) => unknown) => select(view),
    useSessions: (select: (value: object) => unknown) => select(sessionView),
    useSessionStatus: (select: (value: Map<string, unknown>) => unknown) => select(new Map()),
  };
  const actions = [
    action('agent-preset', () => <span data-testid="preset-label">label</span>, () => ({})),
    action('subagent-catalog', props => { useEffect(() => { (props.load as () => void)(); }, [props.load]); return <><button onClick={() => (props.openChild as (address: DrawerSubagentAddress) => void)(child)}>Catalog child</button><button onClick={() => (props.openChildAside as (address: DrawerSubagentAddress) => void)(child)}>Catalog aside</button></>; }, () => ({ openChild: originalOpenChild, openChildAside: asideOpen, load })),
    action('job-list', () => <span data-testid="job-list">jobs</span>, () => ({})),
  ];
  const fixture = slots({
    'conversation.session.header': [entry('header', Header, { store: {} } as Partial<StoredEntry>)],
    'conversation.session.header.actions': actions,
    'conversation.session.header.lineage': [action('lineage', props => <button onClick={() => (props.openChild as (address: DrawerSubagentAddress) => void)(child)}>Lineage child</button>, () => ({ openChild: originalOpenChild }))],
    'conversation.session.header.utilities': [entry('utility', () => <span data-testid="utility">utility</span>)],
    'conversation.session.header.corner': [entry('corner', () => <span data-testid="corner">corner</span>, { store: {} } as Partial<StoredEntry>)],
    'conversation.hero.agentPreset': [entry('seat', Seat)],
  });
  return { fixture, modePort, navigation, standard, view, sessionView, originalOpenChild, asideOpen, load };
}

describe('NativeSessionHeader', () => {
  it('hosts the native header and its child slots while skipping store-backed entries', () => {
    const f = configured();
    render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(screen.getByTestId('native-header').getAttribute('data-chrome')).toBe('false');
    expect(screen.getByTestId('native-header').getAttribute('data-view')).toBe('chat');
    expect(screen.getByTestId('views').textContent).toBe('0');
    expect(screen.getByTestId('preset-label')).toBeTruthy();
    expect(screen.getByTestId('job-list')).toBeTruthy();
    expect(screen.getByTestId('utility')).toBeTruthy();
    expect(screen.queryByTestId('corner')).toBeNull();
    expect(screen.getByText('Lineage child')).toBeTruthy();
  });

  it('keeps native inject faces stable across parent rerenders', () => {
    const f = configured();
    const view = render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(f.load).toHaveBeenCalledOnce();
    view.rerender(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(f.load).toHaveBeenCalledOnce();
  });

  it('navigates breadcrumbs, lineage, and the subagent catalog in the drawer, preserving native behavior for foreign targets', () => {
    const f = configured();
    render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    fireEvent.click(screen.getByRole('button', { name: 'Root breadcrumb' }));
    expect(f.navigation.openSession).toHaveBeenCalledWith('root');
    fireEvent.click(screen.getByRole('button', { name: 'Catalog child' }));
    expect(f.navigation.openSubagent).toHaveBeenCalledWith(child);
    expect(f.originalOpenChild).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Catalog aside' }));
    expect(f.asideOpen).toHaveBeenCalledWith(child);
    expect(f.navigation.openSubagent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Lineage child' }));
    expect(f.navigation.openSubagent).toHaveBeenCalledTimes(2);
    (f.navigation.openSubagent as ReturnType<typeof vi.fn>).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Catalog child' }));
    expect(f.navigation.openSubagent).toHaveBeenCalledTimes(3);
    expect(f.originalOpenChild).toHaveBeenCalledWith(child);
    expect(f.asideOpen).toHaveBeenCalledOnce();
  });

  it('shows the native mode seat for a blank root, selects the exact session, and filters the label', async () => {
    const f = configured();
    render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    await waitFor(() => expect(screen.getByTestId('mode-seat')).toBeTruthy());
    expect(f.modePort.list).toHaveBeenCalledOnce();
    expect(screen.getByTestId('mode-seat').getAttribute('data-main-view')).toBe('1');
    await waitFor(() => expect(screen.queryByTestId('preset-label')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Pick PTC' }));
    await waitFor(() => expect(f.modePort.select).toHaveBeenCalledWith('a', 'ptc'));
  });

  it('keeps the native label for a started conversation or a subagent child', async () => {
    const f = configured(); f.view.blank = false;
    const { rerender } = render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(screen.queryByTestId('mode-seat')).toBeNull();
    expect(screen.getByTestId('preset-label')).toBeTruthy();
    f.view.blank = true; f.sessionView.byId.a.origin = 'subagent';
    rerender(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(screen.queryByTestId('mode-seat')).toBeNull();
    expect(screen.getByTestId('preset-label')).toBeTruthy();
  });

  it('contains a crashing mode seat and keeps the native read-only label', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = configured();
    f.fixture.set('conversation.hero.agentPreset', [entry('seat', () => { throw new Error('seat failed'); })]);
    render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(screen.getByTestId('native-header')).toBeTruthy();
    expect(screen.getByTestId('preset-label')).toBeTruthy();
    expect(screen.queryByTestId('mode-seat')).toBeNull();
  });

  it('falls back to the native-action row, redirects its catalog into the drawer, and refreshes on late registration', async () => {
    const f = configured();
    f.fixture.set('conversation.session.header', []);
    const { rerender } = render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(screen.queryByTestId('native-header')).toBeNull();
    expect(screen.getByRole('group', { name: 'Conversation status' })).toBeTruthy();
    expect(screen.getByTestId('preset-label')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Catalog child' }));
    expect(f.navigation.openSubagent).toHaveBeenCalledWith(child);
    expect(f.originalOpenChild).not.toHaveBeenCalled();
    (f.navigation.openSubagent as ReturnType<typeof vi.fn>).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Catalog child' }));
    expect(f.originalOpenChild).toHaveBeenCalledWith(child);
    f.fixture.set('conversation.session.header', [entry('header', Header, { store: {} } as Partial<StoredEntry>)]);
    rerender(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(await screen.findByTestId('native-header')).toBeTruthy();
  });

  it('contains a crashing native header through the compact fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = configured();
    f.fixture.set('conversation.session.header', [entry('header', () => { throw new Error('native header failed'); }, { store: {} } as Partial<StoredEntry>)]);
    render(<NativeSessionHeader slots={f.fixture.source} locale={locale} standard={f.standard} navigation={f.navigation} modePort={f.modePort} />);
    expect(screen.queryByTestId('native-header')).toBeNull();
    expect(screen.getByRole('group', { name: 'Conversation status' })).toBeTruthy();
  });
});
