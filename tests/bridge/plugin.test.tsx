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
  const nativeSlots = new Map<string, StoredEntry[]>();
  const taskContextRegistrations: unknown[] = [];
  const taskContextDisposer = vi.fn();
  const send = vi.fn().mockResolvedValue(undefined); const scope = vi.fn(() => ({ get: vi.fn(() => ({ send })) }));
  const references: SessionReference[] = [];
  const contextWindow = {
    entries: [{ type: 'event', event: { type: 'user/message', data: { source: { kind: 'kanban-task' }, content: [{ type: 'text', text: 'Task: Native task (task-1)' }] } } }],
    hasMore: false, revision: 1, change: { kind: 'replace', entries: [] },
  };
  const eventSource = { getSnapshot: () => contextWindow, subscribe: () => () => {} };
  const sessionState = {
    ids: ['a', 'b'], phase: 'ready', projectionsBySession: {},
    byId: {
      a: { id: 'a', displayTitle: 'Agent 1', running: false, blank: false, retainedBy: {}, updatedAt: 0 },
      b: { id: 'b', displayTitle: 'Agent 2', running: false, blank: false, retainedBy: {}, updatedAt: 0 },
    },
  };
  const list = { getSnapshot: () => sessionState, subscribe: () => () => {} };
  const subagentAddress = vi.fn((sessionId: string) => sessionId === 'child'
    ? { parentSessionId: 'a', childSessionId: 'child', mode: 'continuable' }
    : undefined);
  const retain = vi.fn((target: string | { childSessionId: string }, options: { source: string; signal: AbortSignal }) => {
    const sessionId = typeof target === 'string' ? target : target.childSessionId;
    const reference = { sessionId, binding: { ctx: {}, eventSource }, ready: Promise.resolve({}), release: vi.fn(), [Symbol.dispose]() {} } as unknown as SessionReference;
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
  const agentPresets = {
    list: vi.fn(async () => ({ ok: true, value: { presets: [{ id: 'standard', name: 'Standard', isDefault: true }, { id: 'ptc', name: 'PTC' }] } })),
    select: vi.fn(async () => ({ ok: true, value: {} })),
  };
  const remote = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot(rounds) } }),
    command: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot(rounds) } }),
    branches: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: ['main'] } }),
    inferProject: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: { projectPath: '/repo', gitRootPath: '/repo' } } }),
    questions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: rounds } }),
    dismissQuestions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [] } }),
    agentPresets,
    follow(signal?: AbortSignal): RemoteStreamHandle<KanbanSnapshot, never> {
      return {
        async *[Symbol.asyncIterator]() { if (!signal?.aborted) await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true })); },
        send(_value: never) {}, end() {}, dispose() {},
      };
    },
  };
  const uiConversation = {
    events: {
      register: vi.fn((definition: unknown) => { taskContextRegistrations.push(definition); return taskContextDisposer; }),
    },
  };
  const ctx = {
    remote: {
      $mount: mount,
      agentPresets,
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
      entriesOfSlot: vi.fn((key: string) => nativeSlots.get(key) ?? (key === 'conversation.session.header.actions' ? nativeActions : [])),
      subscribe: vi.fn(() => () => {}),
    },
    sessions: { refresh, retain, scope, list, subagentAddress },
    conversation,
    uiConversation,
    uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
    layout: { selectPanel: nativeSelect },
    locale: { bind: vi.fn((namespace: string) => (key: string) => namespace + ':' + key), getSnapshot: () => ({ active: 'en', locales: [], revision: 0 }), subscribe: () => () => {} },
    get mainView() { throw new Error('Global main session access is forbidden'); },
    get userQuestions() { throw new Error('Native question lifecycle access is forbidden'); },
  } as unknown as Context;
  return { ctx, entries, nativeActions, nativeSlots, mount, unmount, openMount: () => openMount(), remote, send, scope, retain, refresh, references, nativeSelect, requestDraftInitialization, focus, agentPresets, uiConversation, sessionState, list, subagentAddress, taskContextRegistrations, taskContextDisposer };
}
async function installed(rounds?: QuestionRound[]) {
  const f = fixture(false, rounds); const dispose = await apply(f.ctx); disposers.push(dispose); return f;
}

describe('public SDK plugin binding contracts', () => {
  it('registers and disposes the task-context Chat Definition with the client conversation service', async () => {
    const f = fixture(); const dispose = await apply(f.ctx);
    expect(f.uiConversation.events.register).toHaveBeenCalledOnce();
    expect(f.taskContextRegistrations[0]).toMatchObject({ kind: 'kanban-task-context', target: 'chat' });
    await dispose();
    expect(f.taskContextDisposer).toHaveBeenCalledOnce();
  });

  it('renders the native session header before the conversation content inside the retained provider', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    const provider = ({ children }: { children: ReactNode }) => <div data-testid="frame-provider">{children}</div>;
    const renderSlot = vi.fn((name: string) => <div data-testid={'slot-' + name} />);
    render(<Main usePanelInfo={(select: (info: { activePanelId: string }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={provider} renderSlot={renderSlot} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    const providerNode = await screen.findByTestId('frame-provider');
    const header = within(providerNode).getByTestId('slot-kanban.session.header');
    const conversation = within(providerNode).getByTestId('slot-kanban.conversation');
    expect(header.compareDocumentPosition(conversation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(renderSlot).toHaveBeenCalledWith('kanban.session.header', {});
    expect(renderSlot).toHaveBeenCalledWith('kanban.conversation', {});
  });

  it('awaits the strict namespace mount, then registers additive native slots without startup navigation', async () => {
    const f = fixture(true); const pending = apply(f.ctx);
    expect(f.mount).toHaveBeenCalledWith(TYPERT_REMOTE); expect(f.entries.size).toBe(0);
    f.openMount(); const dispose = await pending; disposers.push(dispose);
    expect(inject).toContain('remote'); expect(inject).toContain('uiConversation'); expect(inject).not.toContain('remote.kanban');
    expect([...f.entries.keys()]).toEqual(['main:kanban', 'kanban.conversation:', 'kanban.session.header:', 'conversation.chat.node:kanban-task-context', 'sidebar.panellist:kanban', 'conversation.input.dock:kanban-decision-questions', 'tool.call.toolview:decision_request']);
    expect(f.entries.get('main:kanban')?.options.children).toEqual({ 'kanban.conversation': { kind: 'single', scope: 'session' }, 'kanban.session.header': { kind: 'single', scope: 'session' } });
    expect(f.uiConversation.events.register).toHaveBeenCalledOnce();
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
    const headerMounts = vi.fn(); const headerUnmounts = vi.fn();
    function HeaderProbe() { useEffect(() => { headerMounts(); return () => headerUnmounts(); }, []); return <div>Native header slot</div>; }
    const renderSlot = vi.fn((key: string) => key === 'kanban.session.header' ? <HeaderProbe /> : <div>Native slot body</div>);
    const rendered = render(<Main usePanelInfo={(select: (info: { activePanelId: string }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={provider} renderSlot={renderSlot} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await waitFor(() => expect(screen.getByTestId('provided-session').getAttribute('data-session')).toBe('a'));
    expect(f.retain.mock.calls[0]?.[0]).toBe('a'); expect(renderSlot).toHaveBeenCalledWith('kanban.conversation', {}); expect(renderSlot).toHaveBeenCalledWith('kanban.session.header', {});
    expect(headerMounts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Agent 2' }));
    await waitFor(() => expect(screen.getByTestId('provided-session').getAttribute('data-session')).toBe('b'));
    expect(headerMounts).toHaveBeenCalledTimes(2); expect(headerUnmounts).toHaveBeenCalledTimes(1);
    expect(f.references[0]?.release).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    await waitFor(() => expect(f.references[1]?.release).toHaveBeenCalled());
    expect(headerMounts).toHaveBeenCalledTimes(2); expect(headerUnmounts).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('provided-session')).toBeNull(); expect(f.nativeSelect).not.toHaveBeenCalled();
    rendered.unmount(); expect(f.refresh).toHaveBeenCalledTimes(2);
  });
  it('keeps a drawer stage change out of the native composer', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    const provider = ({ children }: { children: ReactNode }) => <div data-testid="retained-body">{children}</div>;
    render(<Main usePanelInfo={(select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={provider} renderSlot={() => <div>Native slot body</div>} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await screen.findByTestId('retained-body');
    fireEvent.change(screen.getByRole('combobox', { name: 'Move task to' }), { target: { value: 'review' } });
    await waitFor(() => expect(f.remote.command).toHaveBeenCalledWith({ type: 'task.move', taskId: 'task', columnId: 'review' }));
    expect(f.requestDraftInitialization).not.toHaveBeenCalled();
    expect(f.focus).not.toHaveBeenCalled();
  });
  it('keeps an armed countdown running when the Kanban panel is hidden', async () => {
    const f = await installed(); const Main = f.entries.get('main:kanban')!.Component;
    const initial = (await f.remote.snapshot() as unknown as { value: { value: KanbanSnapshot } }).value.value;
    const moved = structuredClone(initial);
    const task = moved.state.hubs[0]!.tasks[0]!;
    task.columnId = 'review';
    task.instructionPending = { columnId: 'review', enteredAt: 42 };
    moved.sequence += 1;
    const cleared = structuredClone(moved);
    delete cleared.state.hubs[0]!.tasks[0]!.instructionPending;
    cleared.sequence += 1;
    f.remote.command.mockImplementation(async (request: { type: string }) => ({ ok: true, value: { ok: true, value: request.type === 'task.runInstruction' ? cleared : moved } }));
    const provider = ({ children }: { children: ReactNode }) => <div>{children}</div>;
    const active = (select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: 'kanban' });
    const inactive = (select: (value: { activePanelId: string | null }) => unknown) => select({ activePanelId: null });
    const view = render(<Main usePanelInfo={active} SessionProvider={provider} renderSlot={() => <div>Native slot body</div>} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await screen.findByRole('combobox', { name: 'Move task to' });
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByRole('combobox', { name: 'Move task to' }), { target: { value: 'review' } });
      await act(async () => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); });
      expect(document.querySelector('.kb-card-countdown')).toBeTruthy();
      view.rerender(<Main usePanelInfo={inactive} SessionProvider={provider} renderSlot={() => <div>Native slot body</div>} />);
      await act(async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); });
      expect(screen.queryByText('Kanban')).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      await act(async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); });
      const run = f.remote.command.mock.calls.map(([request]) => request).find(request => request?.type === 'task.runInstruction');
      expect(run).toMatchObject({ type: 'task.runInstruction', taskId: 'task', columnId: 'review', expectedEnteredAt: 42, expectedInstruction: 'Review **carefully**.' });
    } finally { vi.useRealTimers(); }
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
