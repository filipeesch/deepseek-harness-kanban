import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
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
import { ClientBridge } from './client-bridge.js';
import { createDirectoryPicker } from './client/directory-picker.js';
import { BoardView, createBoardPageState, type BoardPageState } from './client/board.js';
import { allTasks } from './client/snapshot-normalize.js';
import { AutoRunController } from './client/auto-run.js';
import { QuestionForm } from './questions/QuestionForm.js';
import { selectActiveRound } from './questions/submission.js';
import { RetainedConversation, TaskConversationWindow, type ConversationSurfaceOwner, type ConversationSurfaceServices } from './client/conversation-surface.js';
import { AgentPresetProvider } from './client/agent-preset-context.js';
import { createAgentPresetPortSource } from './client/agent-preset-port.js';
import type { ConversationLeaseEnvironment } from './client/conversation-leases.js';
import type { SessionTitles } from './client/conversation-label.js';
import type { NativeLocaleSource, NativeSlotSource } from './client/native-slot-host.js';
import type { PreparationSeat } from './client/execution-preparation/model-seat.js';
import { TASK_CONTEXT_NODE_KIND, TaskContextNodeView, taskContextDefinition } from './client/task-context-node.js';
import { STAGE_CONTEXT_NODE_KIND, StageInstructionNodeView, stageInstructionDefinition } from './client/stage-instruction-node.js';
import type { ClientApi } from './shared/types.js';

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
export const name = 'kanban-client';
// Service keys, not package names. Mount our own namespace before any access to remote.kanban.
export const inject = ['remote', 'slots', 'sessions', 'uiSession', 'locale', 'uiConversation'];
const clientCss = '.kanban-native-state{padding:16px;color:inherit}.kanban-feed-error{padding:8px 16px;color:var(--dsw-alias-state-error-primary,crimson);border-bottom:1px solid var(--dsw-alias-border-l2)}';


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
  const bridge = new ClientBridge(ctx.remote, ctx.uiSession.sessionStatus);
  // The command port belongs to this client generation, not to a mounted board.
  const autoRun = new AutoRunController({ run: command => bridge.api.command(command) });
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
  const emptySessionState = { ids: [], byId: {}, phase: 'ready' as const, projectionsBySession: {} };
  const emptySessionList = { subscribe: () => () => {}, getSnapshot: () => emptySessionState };

  function FeedStatus() {
    const status = useSyncExternalStore(bridge.status.subscribe, bridge.status.getSnapshot, bridge.status.getSnapshot);
    if (!status.error) return null;
    return <div className="kanban-feed-error" role="alert">Kanban updates are unavailable: {status.error.message} <button type="button" onClick={() => bridge.retry()}>Retry updates</button></div>;
  }
  const viewSession = (sessionId: string) => bridge.viewSession(sessionId);
  function ConversationWindowSeat(props: ConversationSeatProps) {
    return <TaskConversationWindow
      sessionId={props.sessionId}
      useSession={props.useSession as never}
      renderFactorySlot={props.renderFactorySlot}
      viewSession={viewSession}
    />;
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
  function workspaceNavigation(): ((sessionId: string) => void) | undefined {
    let workspace: Parameters<typeof createWorkspaceNavigation>[0];
    try { workspace = ctx.get('uiWorkspace') as unknown as Parameters<typeof createWorkspaceNavigation>[0]; } catch { workspace = undefined; }
    return createWorkspaceNavigation(workspace);
  }
  function BoardPage(props: MainProps & { api: ClientApi; autoRun: AutoRunController }) {
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
    const renderConversation = useCallback((id: string) => <RetainedConversation
      key={id}
      id={id}
      owner={surfaceOwner}
      services={surfaceServices}
    />, [surfaceOwner, surfaceServices]);
    const openSession = useMemo(workspaceNavigation, [ctx]);
    return <BoardView
      api={props.api}
      pageState={pageState}
      sessionTitles={sessionTitles}
      picker={picker}
      autoRun={props.autoRun}
      nativeSeat={nativeSeat}
      {...(openSession === undefined ? {} : { onOpenSession: openSession })}
      conversationLeases={leaseEnvironment}
      renderConversation={renderConversation}
    />;
  }
  function Main(props: MainProps) {
    const active = props.usePanelInfo(value => value.activePanelId === 'kanban');
    if (!active) return null; // A hidden cached page must not leave another copy of a composer mounted.
    return <AgentPresetProvider source={presetSource} translate={ctx.locale.bind('settings.agentPreset')}><style>{clientCss}</style><FeedStatus /><BoardPage {...props} api={bridge.api} autoRun={autoRun} /></AgentPresetProvider>;
  }
  function Dock(props: PropsRuntime<'conversation.input.dock'>) {
    const view = useSyncExternalStore(bridge.questionsView.subscribe, bridge.questionsView.getSnapshot, bridge.questionsView.getSnapshot);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => bridge.trackQuestions(props.sessionId), [props.sessionId]);
    useEffect(() => {
      if (attempt > 0) bridge.retryQuestions(props.sessionId);
    }, [attempt]);
    const historyError = view.errors.get(props.sessionId)?.message;
    const round = selectActiveRound(view.rounds, props.sessionId, id => bridge.questions.isSubmitted(id), bridge.questions.focusedRoundId);
    const scoped = scopedSessions.scope(props.sessionId);
    const conversation = scoped?.get('conversation');
    return <><FeedStatus />{historyError && <div role="alert">Question rounds are unavailable: {historyError} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry questions</button></div>}{round && <QuestionForm key={round.id} round={round} hidden={bridge.questions.isSubmitted(round.id)} onHide={() => {
      if (!scoped || !conversation) return;
      try { conversation.input.for(scoped).focus(); } catch { /* the form already blurred its active control */ }
    }} onSubmit={async (text) => {
      // This is ordinary native human text. It does not settle native approvals or userQuestions.
      bridge.assertSubmissionAllowed(props.sessionId);
      if (!conversation) throw new Error('The native conversation scope is not available. Reopen this conversation and retry.');
      // The dock hides the round before admission settles; a failure restores it with the draft.
      bridge.questions.submit(round.id);
      try { await conversation.send(text); bridge.settleSubmission(round.id); }
      catch (error) { bridge.questions.rollback(round.id); throw error; }
    }} onDismiss={async () => {
      await bridge.dismissQuestions(props.sessionId, round.id);
    }} />}</>;
  }
  /** The strip is the only question surface: the transcript row renders nothing (no generic JSON card). */
  function HiddenDecisionRow() { return null; }
  function BoardIcon() { return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M7 3v14M13 3v14M4 7h1M9 7h2M15 7h1M4 10h1M9 10h2" /></svg>; }

  const offTaskContext = ctx.uiConversation.events.register(taskContextDefinition);
  const offStageInstruction = ctx.uiConversation.events.register(stageInstructionDefinition);
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'kanban', children: { 'kanban.conversation': { kind: 'single', scope: 'session' } } }, Main));
  ctx.slots.inject('kanban.conversation', () => ctx.slots.register({ name: 'kanban.conversation' }, ConversationWindowSeat));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: TASK_CONTEXT_NODE_KIND, locale: 'chat', inject: () => ({}) }, TaskContextChatNode));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: STAGE_CONTEXT_NODE_KIND, locale: 'chat', inject: () => ({}) }, StageInstructionChatNode));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'kanban', order: 80, label: 'Kanban' }, BoardIcon));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'kanban-decision-questions', order: 20 }, Dock));
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'decision_request' }, HiddenDecisionRow));
  // This subscription is the only reconciler for the shared controller; install it eagerly.
  const unsubscribeAutoRun = bridge.api.subscribe(snapshot => autoRun.reconcile(allTasks(snapshot)));
  bridge.start();
  return async () => {
    lifetime.abort(); autoRun.dispose(); unsubscribeAutoRun();
    offTaskContext(); offStageInstruction();
    try { await presetInjection?.dispose(); } catch { /* the optional namespace fiber is best effort */ }
    await bridge.dispose();
  };
}
