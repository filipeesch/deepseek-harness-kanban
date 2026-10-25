import React, { Component, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { Problem, Task } from '../shared/types.js';
import { creationReceiptId, ErrorNotice, useAction, type RunCommand } from './ui.js';
import { CloseIcon } from './icons.js';
import { resolveActiveConversation, usePageField, type TaskPageState } from './page-state.js';
import {
  ConversationNavigationProvider, createConversationNavigation,
  type ConversationLineagePort, type ConversationNavigation, type DrawerSubagentAddress,
} from './conversation-navigation.js';

export interface SessionTitles { title(sessionId: string): string | undefined; rename(sessionId: string, title: string): Promise<void> }

export interface DrawerConversationsProps {
  task: Task;
  run: RunCommand;
  renderConversation: (id: string, target?: DrawerSubagentAddress) => ReactNode;
  viewState: TaskPageState;
  sessionTitles?: SessionTitles;
  peek: DrawerSubagentAddress | null;
  onPeek: (target: DrawerSubagentAddress | null) => void;
  lineage?: ConversationLineagePort;
}

export function conversationLabel(task: Task, sessionId: string, titles?: SessionTitles): string {
  return titles?.title(sessionId)?.trim() || 'Agent ' + (task.sessionIds.indexOf(sessionId) + 1);
}

export function DrawerConversations({ task, run, renderConversation, viewState, sessionTitles, peek, onPeek, lineage }: DrawerConversationsProps) {
  const open = task.sessionIds.filter(id => !task.closedSessionIds.includes(id));
  const openKey = JSON.stringify(open);
  const [selected, setSelected] = usePageField(viewState, 'conversationId');
  const [selectionRequired, setSelectionRequired] = usePageField(viewState, 'conversationSelectionRequired');
  const action = useAction(run);
  const id = useId();
  const [creationPending, setCreationPending] = useState(false);
  const [creationError, setCreationError] = useState<Problem | null>(null);
  const [renaming, setRenaming] = useState<{ sessionId: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState<Problem | null>(null);
  const canSelectDefault = !creationPending && !creationError && !selectionRequired;
  useEffect(() => {
    if (canSelectDefault && (selected === null || !open.includes(selected))) setSelected(open[0] ?? null);
  }, [openKey, selected, setSelected, canSelectDefault]);
  const active = resolveActiveConversation(task.sessionIds, task.closedSessionIds, selected, canSelectDefault) ?? undefined;
  const chooseConversation = useCallback((sessionId: string) => {
    onPeek(null);
    setSelected(sessionId);
    setSelectionRequired(false);
    setCreationError(null);
  }, [onPeek, setSelected, setSelectionRequired]);
  const navigation = useMemo<ConversationNavigation>(() => createConversationNavigation({
    task,
    selectRoot: chooseConversation,
    setPeek: onPeek,
    ...(lineage === undefined ? {} : { lineage }),
  }), [task, chooseConversation, onPeek, lineage]);
  const label = (sessionId: string) => conversationLabel(task, sessionId, sessionTitles);

  async function createConversation() {
    if (creationPending || creationError || selectionRequired) return;
    setCreationPending(true);
    try {
      const result = await action.execute({ type: 'conversation.create', taskId: task.id });
      if (!result) return;
      const sessionId = creationReceiptId(result, 'conversation');
      const createdTask = result.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === task.id);
      if (!sessionId || !createdTask?.sessionIds.includes(sessionId) || createdTask.closedSessionIds.includes(sessionId)) {
        setSelectionRequired(true);
        setCreationError({ code: !sessionId ? 'CREATION_RECEIPT_REQUIRED' : 'CREATED_CONVERSATION_UNAVAILABLE', message: 'The saved conversation could not be identified safely from its exact creation receipt. Select a tab explicitly or refresh the application before creating another conversation.' });
        return;
      }
      chooseConversation(sessionId);
    } finally { setCreationPending(false); }
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
    if (!active) return;
    onPeek(null);
    void action.execute({ type: 'conversation.close', taskId: task.id, sessionId: active });
  }

  const viewed = active === undefined ? undefined : peek?.childSessionId ?? active;
  return <ConversationNavigationProvider value={navigation}><div className="kb-conversations"><ConversationTabs
    open={open} active={active} id={id} label={label} sessionTitles={sessionTitles}
    renaming={renaming} setRenaming={setRenaming} chooseConversation={chooseConversation}
    beginRename={beginRename} commitRename={commitRename} createConversation={createConversation}
    closeConversation={closeConversation} creating={creationPending}
    createBlocked={Boolean(creationError || selectionRequired)} busy={Boolean(task.operation || task.pendingTransition)}
    actionPending={action.pending} /><ErrorNotice problem={action.error} /><ErrorNotice problem={renameError} /><ErrorNotice problem={creationError ?? (selectionRequired ? { code: 'CREATION_RECEIPT_REQUIRED', message: 'Select a conversation tab explicitly or refresh the application before creating another conversation.' } : null)} />
    {task.closedSessionIds.length > 0 && <details className="kb-closed"><summary>Closed conversations ({task.closedSessionIds.length})</summary><div className="kb-actions">{task.closedSessionIds.map(sessionId => <button key={sessionId} type="button" className="kb-button" disabled={action.pending} onClick={async () => { const result = await action.execute({ type: 'conversation.reopen', taskId: task.id, sessionId }); if (result) chooseConversation(sessionId); }}>Reopen {label(sessionId)}</button>)}</div><p className="kb-hint">Closing a tab preserves its conversation and history.</p></details>}
    {viewed ? <ConversationBody active={viewed} root={active} target={peek ?? undefined} id={id} renderConversation={renderConversation} /> : <p className="kb-empty">{creationPending ? 'Resolving the newly created conversation…' : selectionRequired ? 'Select a conversation tab explicitly before continuing.' : 'All conversation tabs are closed. Reopen an existing conversation or use + to add one.'}</p>}
  </div></ConversationNavigationProvider>;
}

interface ConversationTabsProps {
  open: readonly string[]; active?: string; id: string; label: (sessionId: string) => string; sessionTitles?: SessionTitles;
  renaming: { sessionId: string; value: string } | null;
  setRenaming: (value: { sessionId: string; value: string } | null) => void;
  chooseConversation: (sessionId: string) => void; beginRename: (sessionId: string) => void; commitRename: () => Promise<void>;
  createConversation: () => void; closeConversation: () => void;
  creating: boolean; createBlocked: boolean; busy: boolean; actionPending: boolean;
}

function ConversationTabs({ open, active, id, label, sessionTitles, renaming, setRenaming, chooseConversation, beginRename, commitRename, createConversation, closeConversation, creating, createBlocked, busy, actionPending }: ConversationTabsProps) {
  return <div className="kb-session-toolbar"><div className="kb-tabs kb-agent-tabs" role="tablist" aria-label="Agent conversations">{open.map((sessionId, index) => renaming?.sessionId === sessionId
    ? <input key={sessionId} className="kb-input kb-tab-input" autoFocus aria-label={'Rename ' + label(sessionId)} value={renaming.value} onChange={event => setRenaming({ sessionId, value: event.target.value })} onBlur={() => void commitRename()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); } }} />
    : <button type="button" key={sessionId} className="kb-tab" id={id + '-tab-' + sessionId} role="tab" aria-selected={active === sessionId} aria-controls={id + '-conversation'} tabIndex={active === sessionId ? 0 : -1} title={sessionTitles?.title(sessionId) ?? sessionId} onClick={() => chooseConversation(sessionId)} onDoubleClick={() => beginRename(sessionId)} onContextMenu={event => { if (!sessionTitles) return; event.preventDefault(); beginRename(sessionId); }} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % open.length; else if (event.key === 'ArrowLeft') next = (index + open.length - 1) % open.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = open.length - 1; else return; event.preventDefault(); const value = open[next]; if (value) { chooseConversation(value); document.getElementById(id + '-tab-' + value)?.focus(); } }}>{label(sessionId)}</button>)}</div>
    <button type="button" className="kb-button kb-icon-button" aria-label="New conversation" title="New conversation" disabled={actionPending || creating || createBlocked || busy} onClick={createConversation}><span aria-hidden="true">+</span></button>
    {active && <button type="button" className="kb-button kb-icon-button" aria-label={'Close ' + label(active)} title={'Close ' + label(active)} disabled={actionPending} onClick={closeConversation}><CloseIcon size={14} /></button>}
  </div>;
}

function ConversationBody({ active, root, target, id, renderConversation }: { active: string; root?: string; target?: DrawerSubagentAddress; id: string; renderConversation: (id: string, target?: DrawerSubagentAddress) => ReactNode }) {
  const labelledBy = root === undefined ? undefined : id + '-tab-' + root;
  return <div className="kb-conversation-panel" role="tabpanel" id={id + '-conversation'} aria-labelledby={labelledBy}><NativeBoundary key={active}>{renderConversation(active, target)}</NativeBoundary></div>;
}

class NativeBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : 'Native conversation rendering failed.' }; }
  render() { return this.state.error ? <div role="alert" className="kb-error"><strong>Native conversation unavailable</strong><p>{this.state.error}</p><button type="button" className="kb-button" onClick={() => this.setState({ error: null })}>Retry native view</button></div> : this.props.children; }
}
