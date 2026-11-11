import React, { Component, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Attention, Command, Problem, Task } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import { closedSessionIds, openSessionIds } from '../shared/conversations.js';
import { AttentionDots, AttentionStatusText } from './attention-dots.js';
import { creationReceiptId, useAction, type RunCommand } from './ui.js';
import { resolveActiveConversation, usePageField, type TaskPageState } from './page-state.js';
import { conversationLabel, type SessionTitles } from './conversation-label.js';
import { ClosedConversationsMenu } from './closed-conversations.js';
import { ConversationActionsProvider, ConversationCloseAction, type ConversationActions } from './conversation-actions.js';
import { ConversationNotices } from './conversation-notices.js';
import { useOptionalConversationLeases } from './conversation-lease-context.js';
import { AgentPresetCards } from './agent-preset-cards.js';
import { useAgentPresetPort } from './agent-preset-context.js';

export interface DrawerConversationsProps {
  task: Task;
  run: RunCommand;
  renderConversation: (id: string) => ReactNode;
  viewState: TaskPageState;
  sessionTitles?: SessionTitles;
  conversationAttention?: Readonly<Record<string, Attention>>;
  /** The task must resolve its worktree choice before an explicit first conversation. */
  worktreeDecisionRequired?: boolean;
  /** The client snapshot cannot resolve the task's project. */
  projectUnavailable?: boolean;
}

type CommandScope = 'create' | 'close' | 'reopen';

export function DrawerConversations({ task, run, renderConversation, viewState, sessionTitles, conversationAttention = {}, worktreeDecisionRequired = false, projectUnavailable = false }: DrawerConversationsProps) {
  const open = openSessionIds(task);
  const closed = closedSessionIds(task);
  const noConversations = task.sessionIds.length === 0;
  const noOpenConversations = open.length === 0;
  const openKey = JSON.stringify(open);
  const [selected, setSelected] = usePageField(viewState, 'conversationId');
  const [selectionRequired, setSelectionRequired] = usePageField(viewState, 'conversationSelectionRequired');
  const action = useAction(run);
  const leases = useOptionalConversationLeases();
  const { port: presetPort, translate: presetTranslate } = useAgentPresetPort();
  const id = useId();
  const [commandScope, setCommandScope] = useState<CommandScope | null>(null);
  const [creationPending, setCreationPending] = useState(false);
  const [creationError, setCreationError] = useState<Problem | null>(null);
  const [choosingPreset, setChoosingPreset] = useState(false);
  const [pendingConversation, setPendingConversation] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const presetGeneration = useRef(0);
  const [renaming, setRenaming] = useState<{ sessionId: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState<Problem | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const canSelectDefault = !creationPending && !creationError && !selectionRequired;
  useEffect(() => {
    if (!canSelectDefault || (selected !== null && open.includes(selected))) return;
    const next = open[0] ?? null;
    setSelected(next);
    if (next !== null) leases?.acquireRoot(next);
  }, [openKey, selected, setSelected, canSelectDefault, leases]);
  const active = resolveActiveConversation(task.sessionIds, task.closedSessionIds, selected, canSelectDefault) ?? undefined;
  const chooseConversation = useCallback((sessionId: string) => {
    presetGeneration.current += 1;
    leases?.acquireRoot(sessionId);
    setSelected(sessionId);
    setSelectionRequired(false);
    setCreationError(null);
    setChoosingPreset(false);
    setPendingConversation(null);
    setPresetError(null);
  }, [leases, setSelected, setSelectionRequired]);
  const label = (sessionId: string) => conversationLabel(task, sessionId, sessionTitles);
  const busy = Boolean(task.operation || task.pendingTransition);
  const createBlocked = Boolean(creationError || selectionRequired || worktreeDecisionRequired || projectUnavailable);
  const startHint = projectUnavailable
    ? 'Refresh the board: the task project is unavailable.'
    : worktreeDecisionRequired
    ? task.worktree === null
      ? 'Create a worktree or continue in the base project using the notice above before starting.'
      : 'Resolve the worktree setup in Git before starting.'
    : creationError || selectionRequired
      ? 'Resolve the conversation creation error before starting.'
      : busy ? 'Wait for the current task operation to finish.' : undefined;

  function execute(command: Command, scope: CommandScope) {
    setCommandScope(scope);
    return action.execute(command);
  }

  /** Create the conversation, validate its receipt, and keep it pending until its preset is chosen. */
  async function createConversationSession(): Promise<string | null> {
    if (creationPending || creationError || selectionRequired || worktreeDecisionRequired || projectUnavailable || busy) return null;
    setCreationPending(true);
    try {
      // The first start reuses a conversation created while this request was queued;
      // the plus action on an existing task intentionally adds another one.
      const result = await execute({ type: 'conversation.create', taskId: task.id, ...(task.sessionIds.length === 0 ? { ensureFirst: true } : {}) }, 'create');
      if (!result) return null;
      const sessionId = creationReceiptId(result, 'conversation');
      const createdTask = result.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === task.id);
      if (!sessionId || !createdTask?.sessionIds.includes(sessionId) || createdTask.closedSessionIds.includes(sessionId)) {
        setSelectionRequired(true);
        setCreationError({ code: !sessionId ? 'CREATION_RECEIPT_REQUIRED' : 'CREATED_CONVERSATION_UNAVAILABLE', message: 'The saved conversation could not be identified safely from its exact creation receipt. Select a tab explicitly or refresh the application before creating another conversation.' });
        return null;
      }
      return sessionId;
    } finally { setCreationPending(false); }
  }

  /** Create (once), select the chosen preset on that conversation, and open its window. */
  async function pickPreset(presetId: string, isDefault: boolean) {
    if (presetBusy || createBlocked || busy || action.pending) return;
    const generation = presetGeneration.current;
    setPresetError(null);
    setPresetBusy(true);
    try {
      let sessionId = pendingConversation;
      if (sessionId === null) {
        sessionId = await createConversationSession();
        if (sessionId === null) return;
        if (generation !== presetGeneration.current) return;
        setPendingConversation(sessionId);
      }
      // The created conversation already runs the deployment default; selecting
      // that same preset again would only ask the host to reapply it.
      if (!isDefault) {
        if (presetPort === null) throw new Error('The native agent-preset roster is unavailable.');
        const result = await presetPort.select(sessionId, presetId);
        if (generation !== presetGeneration.current) return;
        if (!result.ok) throw new Error(result.message ?? 'The agent preset could not be selected.');
      }
      chooseConversation(sessionId);
      setFocusTarget(sessionId);
    } catch (error) {
      if (generation !== presetGeneration.current) return;
      setPresetError(error instanceof Error ? error.message : String(error));
    } finally { setPresetBusy(false); }
  }

  function cancelPresetChoice() {
    presetGeneration.current += 1;
    setChoosingPreset(false);
    setPendingConversation(null);
    setPresetError(null);
    if (active !== undefined) setFocusTarget(active);
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
    chooseConversation(sessionId);
    return true;
  }
  function clearReopenProblem() {
    if (commandScope === 'reopen') action.clearError();
  }

  const actions: ConversationActions = {
    activeSessionId: active ?? null,
    pending: action.pending,
    close: closeConversation,
    label,
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

  const viewed = active;
  const cancelPreset = presetBusy || creationPending || (noOpenConversations && pendingConversation === null)
    ? undefined
    : cancelPresetChoice;
  const presetHint = startHint ?? (!noConversations && noOpenConversations
    ? 'All conversations are closed. Choose a preset to start a new one, or reopen one from the closed conversations above.'
    : undefined);
  const notices = [
    { key: 'command', problem: commandScope === 'reopen' ? null : action.error },
    { key: 'create', problem: creationError },
    { key: 'rename', problem: renameError },
  ];
  const closedMenu = <ClosedConversationsMenu
    closed={closed}
    label={label}
    pending={action.pending}
    error={commandScope === 'reopen' ? action.error : null}
    onOpen={clearReopenProblem}
    onReopen={reopenConversation}
    onReopened={setFocusTarget}
  />;

  return <ConversationActionsProvider value={actions}><div className="kb-conversations"><ConversationTabs
    open={open} active={active} id={id} label={label} sessionTitles={sessionTitles}
    renaming={renaming} setRenaming={setRenaming} chooseConversation={chooseConversation}
    beginRename={beginRename} commitRename={commitRename} onRequestNew={() => { setChoosingPreset(true); setPresetError(null); }}
    creating={creationPending} createBlocked={createBlocked} blockedReason={startHint} busy={busy}
    actionPending={action.pending} conversationAttention={conversationAttention} closedMenu={closedMenu} />
    <ConversationNotices notices={notices} />
    {selectionRequired && creationError === null && viewed !== undefined && <p className="kb-hint" role="status">Select a conversation tab explicitly before creating another conversation.</p>}
    {choosingPreset || noOpenConversations || pendingConversation !== null
      ? <AgentPresetCards
        port={presetPort}
        translate={presetTranslate}
        disabled={createBlocked || busy || action.pending}
        hint={presetHint}
        busy={presetBusy || creationPending}
        error={presetError}
        onPick={(presetId, isDefault) => void pickPreset(presetId, isDefault)}
        {...(cancelPreset === undefined ? {} : { onCancel: cancelPreset })}
      />
      : viewed
        ? <ConversationBody active={viewed} root={active} id={id} renderConversation={renderConversation} />
        : selectionRequired
          ? <p className="kb-empty">Select a conversation tab explicitly before continuing.</p>
          : <p className="kb-empty">All conversations are closed. Use + to start a new one, or reopen one from the closed conversations above.</p>}
  </div></ConversationActionsProvider>;
}

interface ConversationTabsProps {
  open: readonly string[]; active?: string; id: string; label: (sessionId: string) => string; sessionTitles?: SessionTitles;
  renaming: { sessionId: string; value: string } | null;
  setRenaming: (value: { sessionId: string; value: string } | null) => void;
  chooseConversation: (sessionId: string) => void; beginRename: (sessionId: string) => void; commitRename: () => Promise<void>;
  onRequestNew: () => void;
  creating: boolean; createBlocked: boolean; blockedReason?: string; busy: boolean; actionPending: boolean;
  conversationAttention: Readonly<Record<string, Attention>>;
  closedMenu: ReactNode;
}

function ConversationTabs({ open, active, id, label, sessionTitles, renaming, setRenaming, chooseConversation, beginRename, commitRename, onRequestNew, creating, createBlocked, blockedReason, busy, actionPending, conversationAttention, closedMenu }: ConversationTabsProps) {
  return <div className="kb-session-toolbar"><div className="kb-tabs kb-agent-tabs" role="tablist" aria-label="Agent conversations">{open.map((sessionId, index) => {
    if (renaming?.sessionId === sessionId) return <input key={sessionId} className="kb-input kb-tab-input" autoFocus aria-label={'Rename ' + label(sessionId)} value={renaming.value} onChange={event => setRenaming({ sessionId, value: event.target.value })} onBlur={() => void commitRename()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); } }} />;
    const attention = conversationAttention[sessionId] ?? EMPTY_ATTENTION;
    return <div key={sessionId} className="kb-tab-item" data-active={active === sessionId ? 'true' : undefined}>
      <button type="button" className="kb-tab" id={id + '-tab-' + sessionId} role="tab" aria-selected={active === sessionId} aria-controls={id + '-conversation'} tabIndex={active === sessionId ? 0 : -1} title={sessionTitles?.title(sessionId) ?? sessionId} onClick={() => chooseConversation(sessionId)} onDoubleClick={() => beginRename(sessionId)} onContextMenu={event => { if (!sessionTitles) return; event.preventDefault(); beginRename(sessionId); }} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % open.length; else if (event.key === 'ArrowLeft') next = (index + open.length - 1) % open.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = open.length - 1; else return; event.preventDefault(); const value = open[next]; if (value) { chooseConversation(value); document.getElementById(id + '-tab-' + value)?.focus(); } }}>{label(sessionId)}<AttentionDots value={attention} decorative /><AttentionStatusText value={attention} /></button>
      {active === sessionId && <ConversationCloseAction />}
    </div>;
  })}</div>
    {closedMenu}
    <button type="button" className="kb-button kb-icon-button" aria-label="New conversation" title={blockedReason ?? 'New conversation'} disabled={actionPending || creating || createBlocked || busy} onClick={onRequestNew}><span aria-hidden="true">+</span></button>
  </div>;
}

function ConversationBody({ active, root, id, renderConversation }: { active: string; root?: string; id: string; renderConversation: (id: string) => ReactNode }) {
  const labelledBy = root === undefined ? undefined : id + '-tab-' + root;
  return <div className="kb-conversation-panel" role="tabpanel" id={id + '-conversation'} aria-labelledby={labelledBy}><NativeBoundary key={active}>{renderConversation(active)}</NativeBoundary></div>;
}

class NativeBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : 'Native conversation rendering failed.' }; }
  render() { return this.state.error ? <div role="alert" className="kb-error"><strong>Native conversation unavailable</strong><p>{this.state.error}</p><div className="kb-actions"><button type="button" className="kb-button" onClick={() => this.setState({ error: null })}>Retry native view</button></div></div> : this.props.children; }
}
