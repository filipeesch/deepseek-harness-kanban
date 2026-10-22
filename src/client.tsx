import React, { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-tool/client';
import type { PropsRuntime, PropsRenderSlots, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { TYPERT_REMOTE } from './remote.js';
import { ClientBridge } from './client-bridge.js';
import { BoardView, createBoardPageState, type BoardPageState } from './client/board.js';
import { QuestionForm } from './questions/QuestionForm.js';
import type { ClientApi } from './shared/types.js';

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { kanbanTaskDrawer: unknown }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'kanban.conversation': { kind: 'single'; scope: 'session' } }
}
type ClientContext = Omit<Context, 'sessions'> & { sessions: ISessions };
type MainProps = PropsRuntime<'main'> & PropsRenderSlots<'kanban.conversation'>;
type EmbeddedProps = PropsRuntime<'kanban.conversation'> & PropsRenderFactories;
export const name = 'kanban-client';
// Service keys, not package names. Mount our own namespace before any access to remote.kanban.
export const inject = ['remote', 'slots', 'sessions', 'uiSession', 'conversation', 'layout'];
const clientCss = '.kanban-native-state{padding:16px;color:inherit}.kanban-feed-error{padding:8px 16px;color:var(--dsw-alias-state-error-primary,crimson);border-bottom:1px solid var(--dsw-alias-border-l2)}';

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
  const held = new Set<SessionReference>();
  const bridge = new ClientBridge(ctx.remote, ctx.uiSession.sessionStatus);
  const scopedSessions = ctx.sessions;
  const emptySessionState = { ids: [], byId: {}, phase: 'ready' as const, projectionsBySession: {} };
  const emptySessionList = { subscribe: () => () => {}, getSnapshot: () => emptySessionState };

  function FeedStatus() {
    const status = useSyncExternalStore(bridge.status.subscribe, bridge.status.getSnapshot, bridge.status.getSnapshot);
    if (!status.error) return null;
    return <div className="kanban-feed-error" role="alert">Kanban updates are unavailable: {status.error.message} <button type="button" onClick={() => bridge.retry()}>Retry updates</button></div>;
  }
  function FixedChat(props: ConversationViewsProps) {
    return props.renderSlot('conversation.session', { view: 'chat' });
  }
  function EmbeddedBody(props: EmbeddedProps) {
    const session = props.useSession(value => value);
    useEffect(() => {
      let release: (() => void) | undefined;
      const sync = () => {
        release?.(); release = undefined;
        if (document.visibilityState !== 'hidden') release = bridge.viewSession(props.sessionId);
      };
      sync(); document.addEventListener('visibilitychange', sync);
      return () => { document.removeEventListener('visibilitychange', sync); release?.(); };
    }, [props.sessionId]);
    if (session.openState === 'error') return <div className="kanban-native-state" role="alert">Native conversation could not open: {session.openError?.message ?? 'Unknown error'}. Close and reopen this tab to retry.</div>;
    // A task already owns an explicit session and cwd; the main-workspace hero would disable its composer.
    return props.renderFactorySlot('conversation.content', {
      variant: 'embedded', phase: session.openState !== 'open' ? 'settling' : 'active', hero: false,
    }, { slots: { views: FixedChat } });
  }
  function RetainedConversation({ id, owner }: { id: string; owner: MainProps }) {
    const [reference, setReference] = useState<SessionReference | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      let active = true; let retained: SessionReference | undefined;
      const cancellation = new AbortController();
      const signal = AbortSignal.any([cancellation.signal, lifetime.signal]);
      const releaseComposer = bridge.claimComposer(id);
      setReference(null); setError(null);
      if (!releaseComposer) { setError('This conversation already has an active Kanban composer. Close the other view first.'); return; }
      void (async () => {
        // Fresh host task sessions must first join the native Client catalog; this changes no selection.
        await scopedSessions.refresh(); signal.throwIfAborted();
        retained = scopedSessions.retain(id as SessionId, { source: 'kanbanTaskDrawer', signal });
        held.add(retained); await retained.ready; signal.throwIfAborted();
        if (active) setReference(retained);
      })().catch((failure: unknown) => {
        if (active && !signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
        if (retained) { held.delete(retained); retained.release(); retained = undefined; }
      });
      return () => { active = false; cancellation.abort(); if (retained) { held.delete(retained); retained.release(); } releaseComposer(); };
    }, [id, attempt]);
    if (error) return <div className="kanban-native-state" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry conversation</button></div>;
    if (!reference) return <div className="kanban-native-state" role="status">Opening native conversation…</div>;
    const Provider = owner.SessionProvider;
    return <Provider session={reference}>{owner.renderSlot('kanban.conversation', {})}</Provider>;
  }
  function BoardPage(props: MainProps & { api: ClientApi }) {
    const sessionListSource = scopedSessions.list ?? emptySessionList;
    const subscribeSessionList = useCallback((listener: () => void) => sessionListSource.subscribe(listener), [sessionListSource]);
    const getSessionList = useCallback(() => sessionListSource.getSnapshot(), [sessionListSource]);
    const sessionList = useSyncExternalStore(subscribeSessionList, getSessionList, getSessionList);
    const sessionTitles = {
      title: (sessionId: string) => sessionList.byId[sessionId as SessionId]?.title,
      rename: async (sessionId: string, title: string) => {
        const face = scopedSessions.scope(sessionId as SessionId)?.get('session');
        if (!face) throw new Error('The native conversation is not available for renaming.');
        const result = await face.rename(title);
        if (!result.ok) throw new Error(result.error.message);
      },
    };
    return <BoardView api={props.api} pageState={pageState} sessionTitles={sessionTitles} renderConversation={(id) => <RetainedConversation key={id} id={id} owner={props} />} />;
  }
  function Main(props: MainProps) {
    const active = props.usePanelInfo(value => value.activePanelId === 'kanban');
    if (!active) return null; // A hidden cached page must not leave another copy of a composer mounted.
    return <><style>{clientCss}</style><FeedStatus /><BoardPage {...props} api={bridge.api} /></>;
  }
  function Dock(props: PropsRuntime<'conversation.input.dock'>) {
    const view = useSyncExternalStore(bridge.questionsView.subscribe, bridge.questionsView.getSnapshot, bridge.questionsView.getSnapshot);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      void bridge.prepareQuestions(props.sessionId).catch(() => undefined); // The session-scoped observable owns retry errors.
    }, [props.sessionId, attempt]);
    const historyError = view.errors.get(props.sessionId)?.message;
    const lastSequence = (value: { pages: readonly { sequence: number }[] }) => value.pages.reduce((max, page) => Math.max(max, page.sequence), -1);
    const round = view.rounds
      .filter(candidate => candidate.sessionId === props.sessionId && !candidate.answered && candidate.pages.length > 0)
      .sort((left, right) => Number(left.turnId) - Number(right.turnId) || lastSequence(left) - lastSequence(right))
      .at(-1);
    return <><FeedStatus />{historyError && <div role="alert">Decision questions are unavailable: {historyError} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry questions</button></div>}{round && <QuestionForm key={round.id} round={round} onSubmit={async (text) => {
      // This is ordinary native human text. It does not settle native approvals or userQuestions.
      bridge.assertSubmissionAllowed(props.sessionId);
      const conversation = scopedSessions.scope(props.sessionId)?.get('conversation');
      if (!conversation) throw new Error('The native conversation scope is not available. Reopen this conversation and retry.');
      await conversation.send(text);
    }} />}</>;
  }
  /** The strip is the only question surface: the transcript row renders nothing (no generic JSON card). */
  function HiddenDecisionRow() { return null; }
  function BoardIcon() { return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M7 3v14M13 3v14M4 7h1M9 7h2M15 7h1M4 10h1M9 10h2" /></svg>; }

  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'kanban', children: { 'kanban.conversation': { kind: 'single', scope: 'session' } } }, Main));
  ctx.slots.inject('kanban.conversation', () => ctx.slots.register({ name: 'kanban.conversation' }, EmbeddedBody));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'kanban', order: 80, label: 'Kanban' }, BoardIcon));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'kanban-decision-questions', order: 20 }, Dock));
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'decision_request' }, HiddenDecisionRow));
  bridge.start();
  return async () => {
    lifetime.abort(); for (const reference of held) reference.release(); held.clear();
    await bridge.dispose();
  };
}
