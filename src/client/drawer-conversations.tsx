import React, { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Attention, Command, Problem, Task } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import { closedSessionIds, openSessionIds } from '../shared/conversations.js';
import { creationModelOutcome, creationPresetOutcome, useAction, type RunCommand } from './ui.js';
import { usePageField, type TaskPageState } from './page-state.js';
import { conversationOf, endPeek, peekOf, requireSelection, resolveConversation, selectConversation, selectionRequiredOf } from './drawer-view.js';
import { conversationLabel, type SessionTitles } from './conversation-label.js';
import { ClosedConversationsMenu } from './closed-conversations.js';
import { ConversationActionsProvider, ConversationCloseAction, type ConversationActions } from './conversation-actions.js';
import { ConversationModelNotice, ConversationNotices, ConversationPresetNotice } from './conversation-notices.js';
import { useOptionalModelFallbacks } from './model-fallbacks.js';
import { useOptionalPresetFallbacks } from './preset-fallbacks.js';
import { useOptionalConversationLeases } from './conversation-lease-context.js';
import { useAgentPresetPort } from './agent-preset-context.js';
import { ConversationBody } from './conversations/body.js';
import type { ConversationSurfaceMode } from './conversation-surface.js';
import { ConversationTabs } from './conversations/tabs.js';
import { ConversationCreationPanel, useConversationCreation } from './conversations/creation.js';

export interface DrawerConversationsProps {
  task: Task;
  run: RunCommand;
  renderConversation: (id: string, mode?: ConversationSurfaceMode) => ReactNode;
  viewState: TaskPageState;
  sessionTitles?: SessionTitles;
  conversationAttention?: Readonly<Record<string, Attention>>;
  /** The task must resolve its worktree choice before an explicit first conversation. */
  worktreeDecisionRequired?: boolean;
  /** The client snapshot cannot resolve the task's project. */
  projectUnavailable?: boolean;
  /**
   * The conversations whose model-fallback notice was dismissed in this drawer. The
   * drawer that outlives every section switch owns it, because a dismissal that
   * lived here would be forgotten each time this section unmounted.
   */
  modelNoticeDismissed?: readonly string[];
  /** Record that the person read the notice of one conversation. */
  onDismissModelNotice?: (sessionId: string) => void;
  /** The preset the task's board names for new conversations, when it names one. */
  boardDefaultPreset?: string;
  /** The conversations whose preset-fallback notice was dismissed in this drawer. */
  presetNoticeDismissed?: readonly string[];
  /** Record that the person read the preset-fallback notice of one conversation. */
  onDismissPresetNotice?: (sessionId: string) => void;
  /** Reveal one Session in the host's main chat; used by a branch the task could not adopt. */
  onOpenInMain?: ((sessionId: string) => void) | undefined;
}

type CommandScope = 'create' | 'close' | 'reopen';

const NO_DISMISSED_NOTICES: readonly string[] = [];

/** The Conversations section: task conversation tabs, the native surface, and the transient peek. */
export function DrawerConversations({ task, run, renderConversation, viewState, sessionTitles, conversationAttention = {}, worktreeDecisionRequired = false, projectUnavailable = false, modelNoticeDismissed = NO_DISMISSED_NOTICES, onDismissModelNotice, boardDefaultPreset, presetNoticeDismissed = NO_DISMISSED_NOTICES, onDismissPresetNotice, onOpenInMain }: DrawerConversationsProps) {
  const open = openSessionIds(task);
  const closed = closedSessionIds(task);
  const noConversations = task.sessionIds.length === 0;
  const noOpenConversations = open.length === 0;
  const openKey = JSON.stringify(open);
  const [view, setView] = usePageField(viewState, 'view');
  const [claim, setClaim] = usePageField(viewState, 'claim');
  const action = useAction(run);
  const leases = useOptionalConversationLeases();
  const modelFallbacks = useOptionalModelFallbacks();
  const presetFallbacks = useOptionalPresetFallbacks();
  const { port: presetPort, translate: presetTranslate } = useAgentPresetPort();
  const id = useId();
  const [commandScope, setCommandScope] = useState<CommandScope | null>(null);
  const [renaming, setRenaming] = useState<{ sessionId: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState<Problem | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const busy = Boolean(task.operation || task.pendingTransition);
  const surfaceBlocked = Boolean(worktreeDecisionRequired || projectUnavailable);

  /** Present one conversation tab; a peek always ends when a tab is selected. */
  const chooseView = useCallback((sessionId: string) => {
    setClaim(null);
    if (sessionId !== null) leases?.acquireRoot(sessionId);
    setView(current => selectConversation(current, sessionId));
  }, [leases, setView, setClaim]);

  function execute(command: Command, scope: CommandScope) {
    setCommandScope(scope);
    return action.execute(command);
  }

  const creation = useConversationCreation({
    task,
    blocked: surfaceBlocked || selectionRequiredOf(view),
    busy,
    execute: command => execute(command, 'create'),
    pending: action.pending,
    leases,
    models: modelFallbacks,
    presets: presetFallbacks,
    presetPort,
    onSelected: chooseView,
    onFocus: setFocusTarget,
    onSelectionRequired: () => { setView(current => requireSelection(current)); },
    ...(boardDefaultPreset === undefined ? {} : { boardDefaultPreset }),
  });

  const canSelectDefault = !creation.creating && creation.error === null && !selectionRequiredOf(view);
  const resolved = resolveConversation(view, open, canSelectDefault);
  const active = conversationOf(resolved) ?? undefined;
  const peek = peekOf(resolved);
  const selectionRequired = selectionRequiredOf(resolved);
  const createBlocked = Boolean(creation.error || selectionRequired || surfaceBlocked);
  const startHint = projectUnavailable
    ? 'Refresh the board: the task project is unavailable.'
    : worktreeDecisionRequired
    ? task.worktree === null
      ? 'Create a worktree or continue in the base project using the notice above before starting.'
      : 'Resolve the worktree setup in Git before starting.'
    : creation.error || selectionRequired
      ? 'Resolve the conversation creation error before starting.'
      : busy ? 'Wait for the current task operation to finish.' : undefined;

  // Persist the resolved view (a fallback selection, or a peek whose conversation left)
  // without racing the render that already presents it.
  useEffect(() => {
    if (resolved === view) return;
    const conversation = conversationOf(resolved);
    if (conversation !== null) leases?.acquireRoot(conversation);
    setView(resolved);
  }, [resolved, view, leases, setView]);

  function chooseConversation(sessionId: string) {
    creation.forget();
    chooseView(sessionId);
  }

  function beginRename(sessionId: string) {
    if (!sessionTitles) return;
    setRenaming({ sessionId, value: sessionTitles.title(sessionId) ?? '' });
    setRenameError(null);
  }
  async function commitRename() {
    if (!renaming || !sessionTitles) return;
    const value = renaming.value.trim();
    const sessionId = renaming.sessionId;
    setRenaming(null);
    if (!value || value === sessionTitles.title(sessionId)) return;
    try { await sessionTitles.rename(sessionId, value); }
    catch (error) { setRenameError({ code: 'RENAME_FAILED', message: error instanceof Error ? error.message : 'The conversation title could not be renamed.' }); }
  }
  function closeConversation() {
    if (!active || action.pending) return;
    void execute({ type: 'conversation.close', taskId: task.id, sessionId: active }, 'close');
  }
  async function reopenConversation(sessionId: string): Promise<boolean> {
    if (action.pending) return false;
    const result = await execute({ type: 'conversation.reopen', taskId: task.id, sessionId }, 'reopen');
    if (!result) return false;
    creation.forget();
    chooseView(sessionId);
    return true;
  }
  function clearReopenProblem() {
    if (commandScope === 'reopen') action.clearError();
  }

  const actions: ConversationActions = {
    activeSessionId: active ?? null,
    pending: action.pending,
    close: closeConversation,
    label: sessionId => conversationLabel(task, sessionId, sessionTitles),
  };

  useEffect(() => {
    if (focusTarget === null) return;
    const focusTab = (): boolean => {
      const tab = document.getElementById(id + '-tab-' + focusTarget);
      if (tab instanceof HTMLElement) { tab.focus(); setFocusTarget(null); return true; }
      return false;
    };
    if (focusTab()) return;
    const timer = window.setTimeout(() => {
      if (focusTab()) return;
      const chip = document.querySelector<HTMLElement>('.kb-closed-chip');
      if (chip !== null) { chip.focus(); setFocusTarget(null); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusTarget, openKey, id]);

  // Whether a fallback notice was read is the open drawer's view state, never a saved
  // fact, and it is held by the drawer above so that leaving and returning to this
  // section keeps it: closing the conversation forgets the dismissal, so a reopened
  // conversation announces the same fallback again.
  const modelFallbackSession = active !== undefined && modelFallbacks !== null && !modelNoticeDismissed.includes(active) ? active : null;
  const viewedFallback = modelFallbackSession === null ? null : modelFallbacks?.of(modelFallbackSession) ?? null;
  // The preset fallback is a separate notice with its own dismissal, on the same terms.
  const presetFallbackSession = active !== undefined && presetFallbacks !== null && !presetNoticeDismissed.includes(active) ? active : null;
  const viewedPresetFallback = presetFallbackSession === null ? null : presetFallbacks?.of(presetFallbackSession) ?? null;
  const canCancelPreset = !(creation.busy || (noOpenConversations && creation.pendingConversation === null));
  const presetHint = startHint ?? (!noConversations && noOpenConversations
    ? 'All conversations are closed. Choose a preset to start a new one, or reopen one from the closed conversations above.'
    : undefined);
  const notices = [
    { key: 'command', problem: commandScope === 'reopen' ? null : action.error },
    { key: 'create', problem: creation.error },
    { key: 'rename', problem: renameError },
  ];
  const label = (sessionId: string) => conversationLabel(task, sessionId, sessionTitles);
  const closedMenu = <ClosedConversationsMenu
    closed={closed}
    label={label}
    pending={action.pending}
    error={commandScope === 'reopen' ? action.error : null}
    onOpen={clearReopenProblem}
    onReopen={reopenConversation}
    onReopened={setFocusTarget}
  />;
  const showingCreation = creation.choosing || noOpenConversations || creation.pendingConversation !== null;

  return <ConversationActionsProvider value={actions}><div className="kb-conversations"><ConversationTabs
    open={open} active={active} id={id} label={label} sessionTitles={sessionTitles}
    renaming={renaming} setRenaming={setRenaming} chooseConversation={chooseConversation}
    beginRename={beginRename} commitRename={commitRename} onRequestNew={creation.start}
    creating={creation.creating} createBlocked={createBlocked} blockedReason={startHint} busy={busy}
    actionPending={action.pending} conversationAttention={conversationAttention} closedMenu={closedMenu} />
    <ConversationNotices notices={notices} />
    {claim === null ? null : <ForkClaimNotice
      claim={claim}
      onOpenInMain={claim.error === undefined ? undefined : onOpenInMain}
      onDismiss={() => setClaim(null)} />}
    {viewedFallback === null || modelFallbackSession === null ? null : <ConversationModelNotice
      outcome={viewedFallback}
      onDismiss={() => { onDismissModelNotice?.(modelFallbackSession); }} />}
    {viewedPresetFallback === null || presetFallbackSession === null ? null : <ConversationPresetNotice
      outcome={viewedPresetFallback}
      onDismiss={() => { onDismissPresetNotice?.(presetFallbackSession); }} />}
    {selectionRequired && creation.error === null && active !== undefined && <p className="kb-hint" role="status">Select a conversation tab explicitly before creating another conversation.</p>}
    {showingCreation
      ? <ConversationCreationPanel
        creation={creation}
        port={presetPort}
        translate={presetTranslate}
        disabled={createBlocked || busy || action.pending}
        hint={presetHint}
        {...(canCancelPreset ? { onCancel: () => { creation.cancel(); if (active !== undefined) setFocusTarget(active); } } : {})}
        {...(boardDefaultPreset === undefined ? {} : { boardDefaultPreset })}
      />
      : peek !== null
        ? <ConversationBody
          active={peek.sessionId}
          root={active}
          target={peek}
          id={id}
          renderConversation={renderConversation}
          onUnavailable={sessionId => { if (peek.sessionId === sessionId) setView(current => endPeek(current)); }}
        />
        : active !== undefined
          ? <ConversationBody active={active} root={active} id={id} renderConversation={renderConversation} />
          : selectionRequired
            ? <p className="kb-empty">Select a conversation tab explicitly before continuing.</p>
            : <p className="kb-empty">All conversations are closed. Use + to start a new one, or reopen one from the closed conversations above.</p>}
  </div></ConversationActionsProvider>;
}

/** A fork the drawer claimed: either still attaching, or a failure the person can leave. */
function ForkClaimNotice({ claim, onOpenInMain, onDismiss }: { claim: { sessionId: string; error?: string }; onOpenInMain?: ((sessionId: string) => void) | undefined; onDismiss: () => void }) {
  if (claim.error === undefined) {
    return <p className="kb-claim-pending" role="status">
      <span className="kb-claim-spinner" aria-hidden="true" />
      <span>Attaching the branch…</span>
    </p>;
  }
  // The alert carries the message only: the actions stay outside it so assistive
  // technology announces the reason without swallowing a control.
  return <div className="kb-claim-notice">
    <div className="kb-error">
      <strong className="kb-claim-title">Branch not added</strong>
      <span role="alert">{claim.error}</span>
    </div>
    <div className="kb-actions">
      {onOpenInMain === undefined ? null : <button type="button" className="kb-button kb-primary" onClick={() => onOpenInMain(claim.sessionId)}>Open in main chat</button>}
      <button type="button" className="kb-link-button" onClick={onDismiss}>Dismiss</button>
    </div>
  </div>;
}
