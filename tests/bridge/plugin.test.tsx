// @vitest-environment jsdom
import React, { type ComponentType, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Context } from '@deepseek-ai/cordis';
import { RemoteStream, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import type { RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { BoardSnapshot, QuestionRound } from '../../src/shared/types.js';
import { apply, inject } from '../../src/client.js';
import { TYPERT_REMOTE } from '../../src/remote.js';
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { cleanup(); for (const dispose of disposers.splice(0)) await dispose(); });
const question: QuestionRound = { id: 'r', sessionId: 'a', turnId: 't', complete: true, answered: false, pages: [{ callId: 'call-a', sequence: 1, page: { question: 'Choose the implementation', type: 'freetext' } }] };
function snapshot(rounds: QuestionRound[] = [question]): BoardSnapshot {
  return { sequence: 1, attention: {}, questionRounds: rounds, state: { schemaVersion: 2, revision: 1, workflowYaml: '', workflow: { name: 'Default', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, projects: [{ id: 'p', name: 'Project', projectPath: '/project', gitRootPath: '/project' }], tasks: [{ id: 'task', projectId: 'p', title: 'Native task', description: '', columnId: 'backlog', position: 0, sessionIds: ['a', 'b'], closedSessionIds: [], effectiveCwd: '/project', worktree: null, operation: null, createdAt: '', updatedAt: '' }], notes: [] } };
}
type Entry = { options: Record<string, unknown>; Component: ComponentType<Record<string, unknown>> };
function fixture(deferMount = false, rounds: QuestionRound[] = [question]) {
  let mounted = false; let openMount!: () => void;
  const mounting = deferMount ? new Promise<void>(resolve => { openMount = resolve; }) : Promise.resolve();
  const unmount = vi.fn().mockResolvedValue(undefined);
  const mount = vi.fn(async () => { await mounting; mounted = true; return unmount; });
  const entries = new Map<string, Entry>();
  const send = vi.fn().mockResolvedValue(undefined); const scope = vi.fn(() => ({ get: vi.fn(() => ({ send })) }));
  const references: SessionReference[] = [];
  const retain = vi.fn((id: string, options: { source: string; signal: AbortSignal }) => {
    const reference = { sessionId: id, binding: {}, ready: Promise.resolve({}), release: vi.fn(), [Symbol.dispose]() {} } as unknown as SessionReference;
    references.push(reference); expect(options.source).toBe('kanbanTaskDrawer'); return reference;
  });
  const refresh = vi.fn().mockResolvedValue(undefined);
  const nativeSelect = vi.fn();
  const remote = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot(rounds) } }),
    command: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: snapshot(rounds) } }),
    branches: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: ['main'] } }),
    inferProject: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: { projectPath: '/repo', gitRootPath: '/repo' } } }),
    questions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: rounds } }),
    dismissQuestions: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: [] } }),
    follow(signal?: AbortSignal): RemoteStreamHandle<BoardSnapshot, never> {
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
    },
    sessions: { refresh, retain, scope },
    uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
    layout: { selectPanel: nativeSelect },
    get mainView() { throw new Error('Global main session access is forbidden'); },
    get userQuestions() { throw new Error('Native question lifecycle access is forbidden'); },
  } as unknown as Context;
  return { ctx, entries, mount, unmount, openMount: () => openMount(), remote, send, scope, retain, refresh, references, nativeSelect };
}
async function installed(rounds?: QuestionRound[]) {
  const f = fixture(false, rounds); const dispose = await apply(f.ctx); disposers.push(dispose); return f;
}

describe('public SDK plugin binding contracts', () => {
  it('awaits the strict namespace mount, then registers additive native slots without startup navigation', async () => {
    const f = fixture(true); const pending = apply(f.ctx);
    expect(f.mount).toHaveBeenCalledWith(TYPERT_REMOTE); expect(f.entries.size).toBe(0);
    f.openMount(); const dispose = await pending; disposers.push(dispose);
    expect(inject).toContain('remote'); expect(inject).not.toContain('remote.kanban');
    expect([...f.entries.keys()]).toEqual(['main:kanban', 'kanban.conversation:', 'sidebar.panellist:kanban', 'conversation.input.dock:kanban-decision-questions', 'tool.call.toolview:decision_request']);
    expect(f.entries.get('main:kanban')?.options.children).toEqual({ 'kanban.conversation': { kind: 'single', scope: 'session' } });
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
    const renderSlot = vi.fn(() => <div>Native slot body</div>);
    const rendered = render(<Main usePanelInfo={(select: (info: { activePanelId: string }) => unknown) => select({ activePanelId: 'kanban' })} SessionProvider={provider} renderSlot={renderSlot} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open task Native task' }));
    await waitFor(() => expect(screen.getByTestId('provided-session').getAttribute('data-session')).toBe('a'));
    expect(f.retain.mock.calls[0]?.[0]).toBe('a'); expect(renderSlot).toHaveBeenCalledWith('kanban.conversation', {});
    fireEvent.click(screen.getByRole('tab', { name: 'Agent 2' }));
    await waitFor(() => expect(screen.getByTestId('provided-session').getAttribute('data-session')).toBe('b'));
    expect(f.references[0]?.release).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    await waitFor(() => expect(f.references[1]?.release).toHaveBeenCalled());
    expect(screen.queryByTestId('provided-session')).toBeNull(); expect(f.nativeSelect).not.toHaveBeenCalled();
    rendered.unmount(); expect(f.refresh).toHaveBeenCalledTimes(2);
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
