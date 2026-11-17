import React, { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-tool/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { PropsRuntime, PropsRenderSlots, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { TYPERT_REMOTE } from './remote.js';
import { createWorkspaceNavigation } from './client/settings/schedules/workspace-navigation.js';
import { createDrawerNavigation, NavigationForwarder } from './client/host-navigation.js';
import { ClientBridge } from './client-bridge.js';
import { createDirectoryPicker } from './client/directory-picker.js';
import { BoardView, createBoardPageState, type BoardPageState } from './client/board.js';
import { allTasks } from './client/snapshot-normalize.js';
import { AutoRunController } from './client/auto-run.js';
import { DecisionWindowController } from './client/decision-window.js';
import { QuestionDock, createQuestionDockServices, type QuestionDockSessions } from './client/question-dock.js';
import { createSessionStatusPort, type SessionStatusHost } from './client/session-status.js';
import { FeedStatus } from './client/feed-status.js';
import { RetainedConversation, TaskConversationWindow, type ConversationSurfaceMode, type ConversationSurfaceOwner, type ConversationSurfaceServices } from './client/conversation-surface.js';
import { AgentPresetProvider } from './client/agent-preset-context.js';
import { createAgentPresetPortSource } from './client/agent-preset-port.js';
import type { ConversationLeaseEnvironment } from './client/conversation-leases.js';
import type { SessionTitles } from './client/conversation-label.js';
import type { NativeLocaleSource, NativeSlotSource } from './client/native-slot-host.js';
import type { PreparationSeat } from './client/execution-preparation/model-seat.js';
import { TASK_CONTEXT_NODE_KIND, TaskContextNodeView, taskContextDefinition } from './client/task-context-node.js';
import { STAGE_CONTEXT_NODE_KIND, StageInstructionNodeView, stageInstructionDefinition } from './client/stage-instruction-node.js';
import { HANDOFF_CONTEXT_NODE_KIND, ScriptedHandoffNodeView, scriptedHandoffDefinition } from './client/scripted-handoff-node.js';
import { TASK_MESSAGE_NODE_KIND, TaskMessageNodeView, taskMessageDefinition } from './client/task-message-node.js';
import { createSidebarPanelPort } from './client/sidebar-panel-port.js';
import { HostOpenFallback, drawerConversationSession } from './client/host-open-fallback.js';
import type { ClientApi, KanbanSnapshot } from './shared/types.js';

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { kanbanTaskDrawer: unknown }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'kanban.conversation': { kind: 'single'; scope: 'session' };
  }
}
type ClientContext = Omit<Context, 'sessions'> & { sessions: ISessions };
type MainProps = PropsRuntime<'main'> & PropsRenderSlots<'kanban.conversation'>;
type ConversationSeatProps = PropsRuntime<'kanban.conversation'> & PropsRenderFactories;

/**
 * The embedded right Sidebar panel occurrence, typed locally until the pinned
 * SDK declares the Factory. Runtime dispatch is the host's; remove this bridge
 * when the release pin lands.
 */
type EmbeddedPanelFactoryRenderer = (
  name: 'sidebar.right.panel',
  input: { readonly variant: 'embedded' },
  options: { readonly fallback: ReactNode },
) => ReactNode;

export const name = 'kanban-client';
// Service keys, not package names. Mount our own namespace before any access to remote.kanban.
export const inject = ['remote', 'slots', 'sessions', 'uiSession', 'locale', 'uiConversation', 'layout'];
const clientCss = '.kanban-native-state{padding:16px;color:inherit}';


/** Sources are optional: a test context may expose no workspace service at all. */
type DeveloperToolsSource = { getSnapshot(): unknown; subscribe(listener: () => void): () => void };

function developerToolsSource(ctx: Context): DeveloperToolsSource | undefined {
  try {
    const forms = ctx.get('configForms') as { developerTools?: { enabled?: DeveloperToolsSource } } | undefined;
    return forms?.developerTools?.enabled;
  } catch { return undefined; }
}

function developerToolsEnabled(ctx: Context): boolean {
  try { return developerToolsSource(ctx)?.getSnapshot() === false ? false : true; } catch { return true; }
}

/**
 * Read the optional right-Sidebar service.
 * It may be provided after this client generation applies, so callers resolve it
 * at the seat that first needs it; a host without the service answers undefined.
 * @param ctx - the client context.
 * @returns the service value, or undefined.
 */
function sidebarService(ctx: Context): unknown {
  try { return ctx.get('sidebarRight'); } catch { return undefined; }
}

function agentPresetsNamespace(ctx: Context): unknown {
  try {
    const service = ctx.get('remote.agentPresets');
    if (service !== undefined) return service;
  } catch { /* optional namespace */ }
  try { return (ctx as unknown as { remote?: { agentPresets?: unknown } }).remote?.agentPresets; } catch { return undefined; }
}

function directoryPickerSources(ctx: Context): { desktop?: () => Promise<string | null>; host?: () => Promise<string | null> } {
  const desktop = (globalThis as { __DSH_DIRECTORY_PICKER__?: { pick?: () => Promise<string | null> } }).__DSH_DIRECTORY_PICKER__;
  let workspace: { pickDirectory?: () => Promise<string | null> } | undefined;
  try { workspace = (ctx as { get?: (key: string) => unknown }).get?.('uiWorkspace') as typeof workspace; } catch { workspace = undefined; }
  return {
    ...(desktop?.pick === undefined ? {} : { desktop: () => desktop.pick!() }),
    ...(workspace?.pickDirectory === undefined ? {} : { host: () => workspace!.pickDirectory!() }),
  };
}

/** Real client plugin: no replacement server, global Session selection, or native acknowledgement writes. */
export async function apply(raw: Context): Promise<() => Promise<void>> {
  const pageState = createBoardPageState();
  const unmountRemote = await raw.remote.$mount(TYPERT_REMOTE);
  // Publishing a namespace does not grant this consumer permission to read it.
  const consumer = raw.inject(['remote.kanban'], scoped => initializeClient(scoped, pageState));
  try { await consumer; }
  catch (error) {
    try { await consumer.dispose(); } finally { await unmountRemote(); }
    throw error;
  }
  return async () => {
    try { await consumer.dispose(); } finally { await unmountRemote(); }
  };
}

/** Every native namespace read and slot callback belongs to this injected generation. */
function initializeClient(raw: Context, pageState: BoardPageState): () => Promise<void> {
  const ctx = raw as unknown as ClientContext;
  const lifetime = new AbortController();
  // The native Session status table is a service under `uiSession` on current
  // hosts and a member of that service on older ones; the port reads whichever
  // this host publishes without making activation depend on the newer shape.
  const sessionStatus = createSessionStatusPort({
    get: name => ctx.get(name),
    uiSession: ctx.uiSession,
    inject: (dependencies, initialize) => ctx.inject([...dependencies], scoped => initialize(scoped as unknown as SessionStatusHost)),
  });
  const bridge = new ClientBridge(ctx.remote, sessionStatus.status);
  // The command port belongs to this client generation, not to a mounted board.
  const autoRun = new AutoRunController({ run: command => bridge.api.command(command) });
  const decisionWindow = new DecisionWindowController({ run: command => bridge.api.command(command) });
  const scopedSessions = ctx.sessions;
  const presetSource = createAgentPresetPortSource(agentPresetsNamespace(ctx), { developerTools: () => developerToolsEnabled(ctx) });
  let presetInjection: ReturnType<Context['inject']> | undefined;
  try {
    presetInjection = ctx.inject(['remote.agentPresets'], scoped => {
      let namespace: unknown;
      try { namespace = scoped.get('remote.agentPresets'); } catch { namespace = undefined; }
      if (namespace === undefined) namespace = (scoped as unknown as { remote?: { agentPresets?: unknown } }).remote?.agentPresets;
      presetSource.set(namespace);
      return () => presetSource.set(undefined);
    });
  } catch { presetInjection = undefined; }
  if (presetInjection !== undefined) void Promise.resolve(presetInjection).catch(() => undefined);
  const picker = createDirectoryPicker(directoryPickerSources(ctx));
  // The latest board snapshot, so a native navigation can be resolved synchronously
  // without waiting for the board to render.
  let latestSnapshot: KanbanSnapshot | undefined;
  const unsubscribeSnapshot = bridge.api.subscribe(snapshot => { latestSnapshot = snapshot; });
  // Keeping owned navigation inside the drawer needs the host layout service. The
  // drawer subscribes to a stable source; without the host surface it never changes,
  // so the native navigation applies unchanged.
  const navigation = new NavigationForwarder();
  let stopNavigation: (() => void) | undefined;
  try {
    const coordinator = createDrawerNavigation(ctx, pageState, value => bridge.api.command(value), scopedSessions, () => latestSnapshot);
    if (coordinator !== undefined) {
      stopNavigation = coordinator.start();
      navigation.attach(coordinator);
    }
  } catch (error) {
    // A host that composes no layout panel keeps native navigation.
    console.warn('kanban: drawer navigation unavailable', error);
  }
  const emptySessionState = { ids: [], byId: {}, phase: 'ready' as const, projectionsBySession: {} };
  const emptySessionList = { subscribe: () => () => {}, getSnapshot: () => emptySessionState };

  // The dock receives a question-only contract: native scope lookup stays here, and the
  // board feed's status belongs to the Kanban page, never to a native conversation.
  const questionDockServices = createQuestionDockServices({
    bridge,
    sessions: ctx.sessions as unknown as QuestionDockSessions,
  });
  const viewSession = (sessionId: string) => bridge.viewSession(sessionId);
  // The Session the drawer presents, read when an open needs a destination: while a
  // board fills the frame's main column the host has no Session on screen to open
  // into, so a collapsed drawer panel would fail every link. The source is stable so
  // the fallback below is not re-installed on every render.
  const drawerSession = () => drawerConversationSession(pageState);
  function ConversationWindowSeat(props: ConversationSeatProps) {
    // The seat is the only place that knows the host Factory name; the workspace
    // receives a plain render prop, so tests can render it without a host.
    const renderPanel = useCallback(() => {
      const render = props.renderFactorySlot as unknown as EmbeddedPanelFactoryRenderer;
      return render('sidebar.right.panel', { variant: 'embedded' }, { fallback: null });
    }, [props.renderFactorySlot]);
    // The Sidebar service may be provided after this client generation applies,
    // so the optional port is resolved on each seat mount, when the drawer first
    // renders it, not at boot. A host without the capability keeps its markup.
    const service = sidebarService(ctx);
    const sidebar = useMemo(() => {
      const port = createSidebarPanelPort(service);
      return port === undefined ? undefined : { port, renderPanel };
    }, [service, renderPanel]);
    return <>
      {/* An open the host cannot target is settled in the conversation this seat draws. */}
      <HostOpenFallback service={service} drawerSession={drawerSession} />
      <TaskConversationWindow
        sessionId={props.sessionId}
        useSession={props.useSession as never}
        renderFactorySlot={props.renderFactorySlot}
        viewSession={viewSession}
        {...(sidebar === undefined ? {} : { sidebar })}
      />
    </>;
  }
  function TaskContextChatNode(props: ChatNodeViewProps<'kanban-task-context'>) {
    return <TaskContextNodeView
      node={props.node}
      slots={ctx.slots as unknown as NativeSlotSource}
      t={props.t}
    />;
  }
  function StageInstructionChatNode(props: ChatNodeViewProps<'kanban-stage-context'>) {
    return <StageInstructionNodeView
      node={props.node}
      slots={ctx.slots as unknown as NativeSlotSource}
      t={props.t}
    />;
  }
  function ScriptedHandoffChatNode(props: ChatNodeViewProps<'kanban-scripted-handoff'>) {
    return <ScriptedHandoffNodeView node={props.node} slots={ctx.slots as unknown as NativeSlotSource} t={props.t} />;
  }
  function TaskMessageChatNode(props: ChatNodeViewProps<'kanban-task-message'>) {
    return <TaskMessageNodeView
      node={props.node}
      slots={ctx.slots as unknown as NativeSlotSource}
      t={props.t}
    />;
  }
  function workspaceNavigation(): ((sessionId: string) => void) | undefined {
    let workspace: Parameters<typeof createWorkspaceNavigation>[0];
    try { workspace = ctx.get('uiWorkspace') as unknown as Parameters<typeof createWorkspaceNavigation>[0]; } catch { workspace = undefined; }
    return createWorkspaceNavigation(workspace);
  }
  function BoardPage(props: MainProps & { api: ClientApi; autoRun: AutoRunController; decisionWindow: DecisionWindowController }) {
    const leaseEnvironment = useMemo<ConversationLeaseEnvironment>(() => ({
      sessions: scopedSessions,
      lifetime: lifetime.signal,
    }), [scopedSessions, lifetime]);
    const surfaceServices = useMemo<ConversationSurfaceServices>(() => ({
      claimComposer: sessionId => bridge.claimComposer(sessionId) ?? null,
    }), [bridge]);
    const surfaceOwner = useMemo<ConversationSurfaceOwner>(() => ({
      SessionProvider: props.SessionProvider,
      renderSlot: (key, owner) => props.renderSlot(key, owner as never),
    }), [props.SessionProvider, props.renderSlot]);
    const nativeSeat = useMemo<PreparationSeat>(() => ({
      slots: ctx.slots as unknown as NativeSlotSource,
      locale: ctx.locale as unknown as NativeLocaleSource,
    }), [ctx.slots, ctx.locale]);
    const sessionListSource = scopedSessions.list ?? emptySessionList;
    const subscribeSessionList = useCallback((listener: () => void) => sessionListSource.subscribe(listener), [sessionListSource]);
    const getSessionList = useCallback(() => sessionListSource.getSnapshot(), [sessionListSource]);
    const sessionList = useSyncExternalStore(subscribeSessionList, getSessionList, getSessionList);
    const sessionTitles = useMemo<SessionTitles>(() => ({
      title: (sessionId: string) => sessionList.byId[sessionId as SessionId]?.title,
      rename: async (sessionId: string, title: string) => {
        const face = scopedSessions.scope(sessionId as SessionId)?.get('session');
        if (!face) throw new Error('The native conversation is not available for renaming.');
        const result = await face.rename(title);
        if (!result.ok) throw new Error(result.error.message);
      },
    }), [sessionList, scopedSessions]);
    const renderConversation = useCallback((id: string, mode?: ConversationSurfaceMode) => <RetainedConversation
      key={id}
      id={id}
      owner={surfaceOwner}
      services={surfaceServices}
      {...(mode === undefined ? {} : { mode })}
    />, [surfaceOwner, surfaceServices]);
    const openSession = useMemo(workspaceNavigation, [ctx]);
    return <BoardView
      api={props.api}
      pageState={pageState}
      sessionTitles={sessionTitles}
      picker={picker}
      autoRun={props.autoRun}
      decisionWindow={props.decisionWindow}
      nativeSeat={nativeSeat}
      {...(openSession === undefined ? {} : { onOpenSession: openSession })}
      navigation={navigation}
      conversationLeases={leaseEnvironment}
      onMarkAllRead={sessionIds => bridge.markAllRead(sessionIds)}
      renderConversation={renderConversation}
    />;
  }
  function Main(props: MainProps) {
    const active = props.usePanelInfo(value => value.activePanelId === 'kanban');
    if (!active) return null; // A hidden cached page must not leave another copy of a composer mounted.
    return <AgentPresetProvider source={presetSource} translate={ctx.locale.bind('settings.agentPreset')}><style>{clientCss}</style><FeedStatus status={bridge.status} retry={() => bridge.retry()} /><BoardPage {...props} api={bridge.api} autoRun={autoRun} decisionWindow={decisionWindow} /></AgentPresetProvider>;
  }
  /** The strip is the only question surface: the transcript row renders nothing (no generic JSON card). */
  function HiddenDecisionRow() { return null; }
  function BoardIcon() { return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M7 3v14M13 3v14M4 7h1M9 7h2M15 7h1M4 10h1M9 10h2" /></svg>; }

  const offTaskContext = ctx.uiConversation.events.register(taskContextDefinition);
  const offStageInstruction = ctx.uiConversation.events.register(stageInstructionDefinition);
  const offHandoff = ctx.uiConversation.events.register(scriptedHandoffDefinition);
  const offTaskMessage = ctx.uiConversation.events.register(taskMessageDefinition);
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'kanban', children: { 'kanban.conversation': { kind: 'single', scope: 'session' } } }, Main));
  ctx.slots.inject('kanban.conversation', () => ctx.slots.register({ name: 'kanban.conversation' }, ConversationWindowSeat));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: TASK_CONTEXT_NODE_KIND, locale: 'chat', inject: () => ({}) }, TaskContextChatNode));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: STAGE_CONTEXT_NODE_KIND, locale: 'chat', inject: () => ({}) }, StageInstructionChatNode));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: HANDOFF_CONTEXT_NODE_KIND, locale: 'chat', inject: () => ({}) }, ScriptedHandoffChatNode));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: TASK_MESSAGE_NODE_KIND, locale: 'chat', inject: () => ({}) }, TaskMessageChatNode));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'kanban', order: 80, label: 'Kanban' }, BoardIcon));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'kanban-decision-questions', order: 20 }, props => <QuestionDock sessionId={props.sessionId} services={questionDockServices} />));
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'decision_request' }, HiddenDecisionRow));
  // This subscription is the only reconciler for the shared controller; install it eagerly.
  const unsubscribeAutoRun = bridge.api.subscribe(snapshot => autoRun.reconcile(allTasks(snapshot), snapshot.scripted));
  const unsubscribeDecisionWindow = bridge.api.subscribe(snapshot => decisionWindow.reconcile(allTasks(snapshot)));
  bridge.start();
  return async () => {
    lifetime.abort(); autoRun.dispose(); decisionWindow.dispose(); unsubscribeAutoRun(); unsubscribeDecisionWindow(); unsubscribeSnapshot();
    offTaskContext(); offStageInstruction(); offTaskMessage(); offHandoff();
    try { await presetInjection?.dispose(); } catch { /* the optional namespace fiber is best effort */ }
    try { stopNavigation?.(); navigation.detach(); } catch { /* the navigation subscription is best effort */ }
    sessionStatus.dispose();
    await bridge.dispose();
  };
}
