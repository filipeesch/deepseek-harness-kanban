// @vitest-environment jsdom
import React, { useEffect, type ComponentType, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Context } from '@deepseek-ai/cordis';
import { RemoteStream, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import type { RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { KanbanSnapshot, QuestionRound } from '../../src/shared/types.js';
import { apply, inject } from '../../src/client.js';
import { TYPERT_REMOTE } from '../../src/remote.js';
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { cleanup(); for (const dispose of disposers.splice(0)) await dispose(); });
const question: QuestionRound = { id: 'r', sessionId: 'a', turnId: 't', complete: true, answered: false, pages: [{ callId: 'call-a', sequence: 1, page: { question: 'Choose the implementation', type: 'freetext' } }] };
function snapshot(rounds: QuestionRound[] = [question]): KanbanSnapshot {
  const now = '2026-10-21T00:00:00Z';
  return { sequence: 1, attention: {}, questionRounds: rounds, state: { hubs: [{ id: 'hub', name: 'Hub', revision: 1, projects: [{ id: 'p', name: 'Project', projectPath: '/project', gitRootPath: '/project' }], boards: [{ id: 'board', name: 'Board', workflowYaml: '', workflow: { name: 'Default', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }, { id: 'review', name: 'Review', onEnterPrompt: 'Review **carefully**.' }], groups: [] }, createdAt: now, updatedAt: now }], tasks: [{ id: 'task', boardId: 'board', projectId: 'p', title: 'Native task', description: '', columnId: 'backlog', position: 0, sessionIds: ['a', 'b'], closedSessionIds: [], effectiveCwd: '/project', worktree: null, operation: null, createdAt: '', updatedAt: '' }], notes: [], createdAt: now, updatedAt: now }], settings: { revision: 0 } } };
}
type Entry = { options: Record<string, unknown>; Component: ComponentType<Record<string, unknown>> };
function fixture(deferMount = false, rounds: QuestionRound[] = [question]) {
  let mounted = false; let openMount!: () => void;
  const mounting = deferMount ? new Promise<void>(resolve => { openMount = resolve; }) : Promise.resolve();
  const unmount = vi.fn().mockResolvedValue(undefined);
  const mount = vi.fn(async () => { await mounting; mounted = true; return unmount; });
  const entries = new Map<string, Entry>();
  const nativeActions: StoredEntry[] = [];
  const send = vi.fn().mockResolvedValue(undefined); const scope = vi.fn(() => ({ get: vi.fn(() => ({ send })) }));
  const references: SessionReference[] = [];
  const contextWindow = {
    entries: [{ type: 'event', event: { type: 'user/message', data: { source: { kind: 'kanban-task' }, content: [{ type: 'text', text: 'Task: Native task (task-1)' }] } } }],
    hasMore: false, revision: 1, change: { kind: 'replace', entries: [] },
  };
  const eventSource = { getSnapshot: () => contextWindow, subscribe: () => () => {} };
  const retain = vi.fn((id: string, options: { source: string; signal: AbortSignal }) => {
    const reference = { sessionId: id, binding: { ctx: {}, eventSource }, ready: Promise.resolve({}), release: vi.fn(), [Symbol.dispose]() {} } as unknown as SessionReference;
    references.push(reference); expect(options.source).toBe('kanbanTaskDrawer'); return reference;
  });
  const requestDraftInitialization = vi.fn().mockReturnValue('applied');
  const focus = vi.fn();
  const removeAttachment = vi.fn();
  const conversation = {
    input: {
      requestDraftInitialization,
      for: vi.fn(() => ({ focus, removeAttachment, state: { getSnapshot: () => ({ phase: 'plain', attachmentIds: [] }) } })),
    },
  };
  const refresh = vi.fn().mockResolvedValue(undefined);
  const nativeSelect = vi.fn();
  const remote = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot(rounds) } }),
    command: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot(rounds) } }),
    branches: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: ['main'] } }),
    inferProject: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: { projectPath: '/repo', gitRootPath: '/repo' } } }),
    questions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: rounds } }),
    dismissQuestions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [] } }),
    follow(signal?: AbortSignal): RemoteStreamHandle<KanbanSnapshot, never> {
      return {
        async *[Symbol.asyncIterator]() { if (!signal?.aborted) await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true })); },
        send(_value: never) {}, end() {}, dispose() {},
      };
    },
  };
  const ctx = {
    remote: {
      $mount: mount,
      get kanban() { throw new Error(mounted ? 'Namespace used without injection' : 'Namespace used before mount'); },
      $stream<Item>(options: RemoteStreamOptions<Item>) { return new RemoteStream({ generation: { getSnapshot: () => ({ id: 1, host: { home: '/home' } }), subscribe: () => () => {} } }, options); },
    },
    inject(dependencies: string[], initialize: (scoped: Context) => () => Promise<void>) {
      expect(mounted).toBe(true); expect(dependencies).toEqual(['remote.kanban']);
      const scoped = Object.create(ctx) as Context;
      Object.defineProperty(scoped, 'remote', { value: Object.create(ctx.remote, { kanban: { get: () => remote } }) });
      const cleanup = initialize(scoped); let active = true;
      return Object.assign(Promise.resolve(), { dispose: async () => { if (active) { active = false; await cleanup(); } } });
    },
    slots: {
      inject(_name: string, register: () => void) { register(); return () => {}; },
      register(options: Record<string, unknown>, Component: ComponentType<Record<string, unknown>>) { entries.set(String(options.name) + ':' + String(options.key ?? options.id ?? ''), { options, Component }); return () => {}; },
      entriesOfSlot: vi.fn(() => nativeActions),
      subscribe: vi.fn(() => () => {}),
    },
    sessions: { refresh, retain, scope },
    conversation,
    uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
    layout: { selectPanel: nativeSelect },
    locale: { bind: vi.fn((namespace: string) => (key: string) => namespace + ':' + key), getSnapshot: () => ({ active: 'en', locales: [], revision: 0 }), subscribe: () => () => {} },
    get mainView() { throw new Error('Global main session access is forbidden'); },
    get userQuestions() { throw new Error('Native question lifecycle access is forbidden'); },
  } as unknown as Context;
  return { ctx, entries, nativeActions, mount, unmount, openMount: () => openMount(), remote, send, scope, retain, refresh, references, nativeSelect, requestDraftInitialization, focus };
}
async function installed(rounds?: QuestionRound[]) {
  const f = fixture(false, rounds); const dispose = await apply(f.ctx); disposers.push(dispose); return f;
}

describe('public SDK plugin binding contracts', () => {
  it('renders the status slot before the conversation content inside the retained provider', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    const provider = ({ children }: { children: ReactNode }) => <div data-testid="frame-provider">{children}</div>;
    const renderSlot = vi.fn((name: string) => <div data-testid={'slot-' + name} />);
    render(<Main usePanelInfo={(select: (info: { activePanelId: string }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={provider} renderSlot={renderSlot} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    const providerNode = await screen.findByTestId('frame-provider');
    const status = within(providerNode).getByTestId('slot-kanban.session.status');
    const conversation = within(providerNode).getByTestId('slot-kanban.conversation');
    expect(status.compareDocumentPosition(conversation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(renderSlot).toHaveBeenCalledWith('kanban.session.status', {});
    expect(renderSlot).toHaveBeenCalledWith('kanban.conversation', {});
  });

  it('hosts the pinned native action entries in the status slot and hides while the session is not open', async () => {
    const f = await installed();
    const probe = ({ sessionId, t }: Record<string, unknown>) => <span data-testid="native-action">{String(sessionId)}:{(t as (key: string) => string)('mode')}</span>;
    const action = { component: probe, options: { id: 'agent-preset', order: -10 }, locale: 'settings.agentPreset', inject: vi.fn(() => ({})) } as unknown as StoredEntry;
    f.nativeActions.push(action);
    const Status = f.entries.get('kanban.session.status:')!.Component as ComponentType<Record<string, unknown>>;
    const open = (select: (value: { openState: string; blank: boolean }) => unknown) => select({ openState: 'open', blank: false });
    const loading = (select: (value: { openState: string; blank: boolean }) => unknown) => select({ openState: 'loading', blank: true });
    const sessions = (select: (value: { byId: Record<string, { origin: string }> }) => unknown) => select({ byId: { a: { origin: 'root' } } });
    const status = (select: (value: Map<string, unknown>) => unknown) => select(new Map());
    const first = render(<Status sessionId="a" useSession={open} useSessions={sessions} useSessionStatus={status} />);
    expect((await screen.findByTestId('native-action')).textContent).toBe('a:settings.agentPreset:mode');
    expect(screen.getByRole('group', { name: 'Conversation status' })).toBeTruthy();
    expect(action.inject).toHaveBeenCalledWith('a');
    expect(f.ctx.locale.bind).toHaveBeenCalledWith('settings.agentPreset');
    first.unmount();
    render(<Status sessionId="a" useSession={loading} useSessions={sessions} useSessionStatus={status} />);
    expect(screen.queryByTestId('native-action')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Conversation status' })).toBeNull();
  });

  it('refreshes the status row when a native action entry registers later', async () => {
    const f = await installed();
    let listener: (() => void) | undefined;
    f.ctx.slots.subscribe = vi.fn((_key: string, next: () => void) => { listener = next; return () => { listener = undefined; }; });
    const probe = ({ t }: Record<string, unknown>) => <span data-testid="late-action">{(t as (key: string) => string)('mode')}</span>;
    const Status = f.entries.get('kanban.session.status:')!.Component as ComponentType<Record<string, unknown>>;
    const view = render(<Status sessionId="a" useSession={(select: (value: { openState: string; blank: boolean }) => unknown) => select({ openState: 'open', blank: false })} useSessions={(select: (value: { byId: Record<string, unknown> }) => unknown) => select({ byId: {} })} useSessionStatus={(select: (value: Map<string, unknown>) => unknown) => select(new Map())} />);
    expect(view.container.querySelector('[data-testid="late-action"]')).toBeNull();
    expect(f.ctx.slots.subscribe).toHaveBeenCalledWith('conversation.session.header.actions', expect.any(Function));
    f.nativeActions.push({ component: probe, options: { id: 'agent-preset', order: -10 }, locale: 'settings.agentPreset', inject: () => ({}) } as unknown as StoredEntry);
    act(() => listener?.());
    expect((await screen.findByTestId('late-action')).textContent).toBe('settings.agentPreset:mode');
  });

  it('refreshes the native action labels when the locale revision changes', async () => {
    const f = await installed();
    let revision = 0; let language = 'en'; const listeners = new Set<() => void>();
    const locale = f.ctx.locale as unknown as { getSnapshot: () => { active: string; locales: unknown[]; revision: number }; subscribe: (listener: () => void) => () => void; bind: (namespace: string) => (key: string) => string };
    locale.getSnapshot = () => ({ active: language, locales: [], revision });
    locale.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
    locale.bind = (namespace: string) => (key: string) => namespace + ':' + key + ':' + language;
    const probe = ({ t }: Record<string, unknown>) => <span data-testid="locale-action">{(t as (key: string) => string)('mode')}</span>;
    f.nativeActions.push({ component: probe, options: { id: 'agent-preset', order: -10 }, locale: 'settings.agentPreset', inject: () => ({}) } as unknown as StoredEntry);
    const Status = f.entries.get('kanban.session.status:')!.Component as ComponentType<Record<string, unknown>>;
    render(<Status sessionId="a" useSession={(select: (value: { openState: string; blank: boolean }) => unknown) => select({ openState: 'open', blank: false })} useSessions={(select: (value: { byId: Record<string, unknown> }) => unknown) => select({ byId: {} })} useSessionStatus={(select: (value: Map<string, unknown>) => unknown) => select(new Map())} />);
    expect((await screen.findByTestId('locale-action')).textContent).toBe('settings.agentPreset:mode:en');
    act(() => { language = 'pt'; revision += 1; for (const listener of listeners) listener(); });
    await waitFor(() => expect(screen.getByTestId('locale-action').textContent).toBe('settings.agentPreset:mode:pt'));
  });

  it('unmounts the status slot when Git or Notes replaces Conversations', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    let mounts = 0; let unmounts = 0;
    function Probe() { useEffect(() => { mounts += 1; return () => { unmounts += 1; }; }, []); return <div data-testid="status-probe" />; }
    const renderSlot = (key: string) => key === 'kanban.session.status' ? <Probe /> : <div>Native slot body</div>;
    render(<Main usePanelInfo={(select: (info: { activePanelId: string }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={({ children }: { children: ReactNode }) => <div>{children}</div>} renderSlot={renderSlot} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await screen.findByTestId('status-probe');
    for (const section of ['Git', 'Notes']) {
      fireEvent.click(screen.getByRole('tab', { name: 'Conversations' }));
      await screen.findByTestId('status-probe');
      fireEvent.click(screen.getByRole('tab', { name: section }));
      await waitFor(() => expect(screen.queryByTestId('status-probe')).toBeNull());
    }
    expect(mounts).toBe(2);
    expect(unmounts).toBe(2);
  });

  it('awaits the strict namespace mount, then registers additive native slots without startup navigation', async () => {
    const f = fixture(true); const pending = apply(f.ctx);
    expect(f.mount).toHaveBeenCalledWith(TYPERT_REMOTE); expect(f.entries.size).toBe(0);
    f.openMount(); const dispose = await pending; disposers.push(dispose);
    expect(inject).toContain('remote'); expect(inject).not.toContain('remote.kanban');
    expect([...f.entries.keys()]).toEqual(['main:kanban', 'kanban.conversation:', 'kanban.session.status:', 'sidebar.panellist:kanban', 'conversation.input.dock:kanban-decision-questions', 'tool.call.toolview:decision_request']);
    expect(f.entries.get('main:kanban')?.options.children).toEqual({ 'kanban.conversation': { kind: 'single', scope: 'session' }, 'kanban.session.status': { kind: 'single', scope: 'session' } });
    expect(f.entries.get('sidebar.panellist:kanban')?.options).toMatchObject({ label: 'Kanban', order: 80 });
    expect(f.nativeSelect).not.toHaveBeenCalled(); await dispose(); expect(f.unmount).toHaveBeenCalledOnce();
  });
  it('ordinary native chats get the fixed strip, the transcript row stays silent, and only scoped human text is sent', async () => {
    const f = await installed();
    const Dock = f.entries.get('conversation.input.dock:kanban-decision-questions')!.Component;
    const Summary = f.entries.get('tool.call.toolview:decision_request')!.Component;
    render(<><Dock sessionId="a" /><Summary sessionId="a" callId="call-a" phase="result" /></>);
    await screen.findByRole('form', { name: 'Questions from the agent' });
    expect(f.remote.questions).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Decision question')).toBeNull();
    expect(screen.queryByRole('button', { name: /Open questions|Review questions/ })).toBeNull();
    expect(screen.getByText('1 / 2').getAttribute('aria-live')).toBe('polite');
    const header = screen.getByRole('button', { name: /Questions from the agent/ });
    expect(header.getAttribute('aria-controls')).toBe(screen.getByRole('form', { name: 'Questions from the agent' }).querySelector('.kq-panel')?.id ?? '');
    fireEvent.click(header); expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header); expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Use the approved native implementation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect(f.scope).toHaveBeenCalledWith('a'); expect(f.send.mock.calls[0]?.[0]).toContain('Use the approved native implementation.');
    expect(f.remote.command).not.toHaveBeenCalled(); expect(f.remote.questions).toHaveBeenCalledTimes(1); expect(f.nativeSelect).not.toHaveBeenCalled();
  });
  it('shows only the most recent unresolved round and no strip once the round is answered', async () => {
    const older: QuestionRound = { ...question, id: 'older', turnId: '1', pages: [{ callId: 'call-a', sequence: 1, page: { question: 'Older question', type: 'freetext' } }] };
    const newer: QuestionRound = { ...question, id: 'newer', turnId: '2', pages: [{ callId: 'call-b', sequence: 2, page: { question: 'Newest question', type: 'freetext' } }] };
    const f = await installed([older, newer]);
    const Dock = f.entries.get('conversation.input.dock:kanban-decision-questions')!.Component;
    const first = render(<Dock sessionId="a" />);
    await screen.findByRole('form', { name: 'Questions from the agent' });
    expect(screen.getByRole('heading', { name: 'Newest question' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Older question' })).toBeNull();
    first.unmount();
    const g = await installed([{ ...newer, answered: true }]);
    const AnsweredDock = g.entries.get('conversation.input.dock:kanban-decision-questions')!.Component;
    const empty = render(<AnsweredDock sessionId="a" />);
    await waitFor(() => expect(g.remote.questions).toHaveBeenCalled());
    expect(empty.container.querySelector('form')).toBeNull();
  });
  it('owns native reference/provider binding, switches A/B by explicit reference, and releases on Info/unmount', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    const provider = vi.fn(({ session, children }: { session: SessionReference; children: ReactNode }) => <div data-testid="provided-session" data-session={session.sessionId}>{children}</div>);
    const statusMounts = vi.fn(); const statusUnmounts = vi.fn();
    function StatusProbe() { useEffect(() => { statusMounts(); return () => statusUnmounts(); }, []); return <div>Native status slot</div>; }
    const renderSlot = vi.fn((key: string) => key === 'kanban.session.status' ? <StatusProbe /> : <div>Native slot body</div>);
    const rendered = render(<Main usePanelInfo={(select: (info: { activePanelId: string }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={provider} renderSlot={renderSlot} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await waitFor(() => expect(screen.getByTestId('provided-session').getAttribute('data-session')).toBe('a'));
    expect(f.retain.mock.calls[0]?.[0]).toBe('a'); expect(renderSlot).toHaveBeenCalledWith('kanban.conversation', {}); expect(renderSlot).toHaveBeenCalledWith('kanban.session.status', {});
    expect(statusMounts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Agent 2' }));
    await waitFor(() => expect(screen.getByTestId('provided-session').getAttribute('data-session')).toBe('b'));
    expect(statusMounts).toHaveBeenCalledTimes(2); expect(statusUnmounts).toHaveBeenCalledTimes(1);
    expect(f.references[0]?.release).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    await waitFor(() => expect(f.references[1]?.release).toHaveBeenCalled());
    expect(statusMounts).toHaveBeenCalledTimes(2); expect(statusUnmounts).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('provided-session')).toBeNull(); expect(f.nativeSelect).not.toHaveBeenCalled();
    rendered.unmount(); expect(f.refresh).toHaveBeenCalledTimes(2);
  });
  it('binds the drawer prefill to the retained conversation draft API', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    const provider = ({ children }: { children: ReactNode }) => <div data-testid="retained-body">{children}</div>;
    render(<Main usePanelInfo={(select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={provider} renderSlot={() => <div>Native slot body</div>} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await screen.findByTestId('retained-body');
    const context = screen.getByRole('note', { name: 'Task context' });
    fireEvent.click(within(context).getByRole('button', { name: /Task context/ }));
    expect(within(context).getByText('Task: Native task (task-1)')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Move task to' }), { target: { value: 'review' } });
    await waitFor(() => expect(f.requestDraftInitialization).toHaveBeenCalledWith(expect.anything(), { prompt: 'Review **carefully**.' }));
    await screen.findByText("Instruction inserted into Agent 1's composer.");
    expect(f.focus).toHaveBeenCalledOnce();
    expect(f.remote.command.mock.calls.every(([value]) => value.type === 'task.move')).toBe(true);
  });
  it('preserves filters and selected task across native page switches while releasing the composer', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    const provider = ({ children }: { children: ReactNode }) => <div data-testid="retained-body">{children}</div>;
    const props = { SessionProvider: provider, renderSlot: () => <div>Native slot body</div> };
    const active = (select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: 'kanban' });
    const inactive = (select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: null });
    const mounted = render(<Main {...props} usePanelInfo={active} />);
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'Native' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Project filter' }), { target: { value: 'p' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await screen.findByTestId('retained-body');
    mounted.rerender(<Main {...props} usePanelInfo={inactive} />);
    await waitFor(() => expect(f.references[0]?.release).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Kanban' })).toBeNull();
    expect(screen.queryByTestId('retained-body')).toBeNull();
    mounted.rerender(<Main {...props} usePanelInfo={active} />);
    const search = await screen.findByRole('searchbox', { name: 'Search tasks' }) as HTMLInputElement;
    await waitFor(() => expect(search.value).toBe('Native'));
    expect((screen.getByRole('combobox', { name: 'Project filter' }) as HTMLSelectElement).value).toBe('p');
    await screen.findByRole('heading', { name: 'Native task', level: 2 });
    await screen.findByTestId('retained-body');
    expect(f.retain).toHaveBeenCalledTimes(2); expect(f.nativeSelect).not.toHaveBeenCalled();
  });
  it('keeps a blank standalone task session editable without choosing a native workspace', async () => {
    const f = await installed(); const Embedded = f.entries.get('kanban.conversation:')!.Component; const factory = vi.fn(() => null);
    render(<Embedded sessionId="a" useSession={(select: (value: object) => unknown) => select({ openState: 'open', blank: true, running: false, promptAttempted: false })} useConversation={(select: (value: object) => unknown) => select({ activeTargets: new Set() })} renderFactorySlot={factory} />);
    expect(factory).toHaveBeenCalledWith('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: expect.any(Function) } });
    expect(f.nativeSelect).not.toHaveBeenCalled();
  });
  it('uses the published embedded factory with fixed native Chat rather than a private composer', async () => {
    const f = await installed(); const Embedded = f.entries.get('kanban.conversation:')!.Component;
    const factory = vi.fn((_name: unknown, _props: unknown, _options: unknown) => <div>Native content factory</div>);
    render(<Embedded sessionId="a" useSession={(select: (value: object) => unknown) => select({ openState: 'open', blank: false, running: false, promptAttempted: true })} useConversation={(select: (value: object) => unknown) => select({ activeTargets: new Set(['chat']) })} renderFactorySlot={factory} />);
    expect(factory).toHaveBeenCalledWith('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: expect.any(Function) } });
    const options = factory.mock.calls[0]?.[2] as unknown as { slots: { views: (props: { renderSlot: (key: string, owner: object) => ReactNode }) => ReactNode } };
    const slot = vi.fn(() => null); options.slots.views({ renderSlot: slot }); expect(slot).toHaveBeenCalledWith('conversation.session', { view: 'chat' });
  });

  it('dismisses the question round through the bridge without sending a native message', async () => {
    const f = await installed();
    const Dock = f.entries.get('conversation.input.dock:kanban-decision-questions')!.Component;
    render(<Dock sessionId="a" />);
    await screen.findByRole('form', { name: 'Questions from the agent' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(f.remote.dismissQuestions).toHaveBeenCalledWith({ sessionId: 'a', roundId: 'r' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Questions from the agent' })).toBeNull());
    expect(f.send).not.toHaveBeenCalled();
  });
});
