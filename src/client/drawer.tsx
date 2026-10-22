import React, { Component, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BoardState, ClientApi, Column, Problem, Task } from '../shared/types.js';
import { InfoPanel, NotesPanel } from './forms.js';
import { GitPanel, OperationStatus, PendingTransitionStatus } from './git.js';
import { creationReceiptId, ErrorNotice, Tabs, useAction, type RunCommand } from './ui.js';
import { createTaskPageState, usePageField, type DrawerSection, type TaskPageState } from './page-state.js';

interface DrawerProps { task: Task; state: BoardState; api: ClientApi; run: RunCommand; renderConversation: (id: string) => ReactNode; onClose: () => void; onMove: (task: Task, column: Column) => void; onDanger: (task: Task, type: 'task.delete' | 'worktree.remove') => void; viewState?: TaskPageState }

export function TaskDrawer({ task, state, api, run, renderConversation, onClose, onMove, onDanger, viewState }: DrawerProps) {
  const [localViewState] = useState(createTaskPageState); const preferences = viewState ?? localViewState;
  const [section, setSection] = usePageField(preferences, 'section'); const [dismissed, setDismissed] = useState(false); const id = useId(); const close = useRef<HTMLButtonElement>(null); const action = useAction(run);
  useEffect(() => { const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; close.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => { setDismissed(false); }, [task.worktree?.path]);
  const project = state.projects.find(value => value.id === task.projectId); const current = state.workflow.columns.find(value => value.id === task.columnId); const blocked = Boolean(task.operation || task.pendingTransition);
  return <aside className="kb-drawer" aria-label="Task details" aria-labelledby={id + '-title'}><header className="kb-drawer-header"><div><h2 id={id + '-title'}>{task.title}</h2><p className="kb-hint">{project?.name ?? task.projectId}{task.archivedAt ? ' · Archived' : ''}</p></div><button ref={close} type="button" className="kb-button kb-icon-button" aria-label="Close task details" onClick={onClose}>×</button></header>
    <label className="kb-field kb-stage-control">Workflow stage<select className="kb-input" aria-label="Move task to" value={task.columnId} disabled={blocked || Boolean(task.archivedAt)} onChange={event => { const column = state.workflow.columns.find(value => value.id === event.target.value); if (column && column.id !== task.columnId) onMove(task, column); }}>{state.workflow.columns.map(column => <option key={column.id} value={column.id} disabled={column.id !== task.columnId && current?.allowedTransitions !== undefined && !current.allowedTransitions.includes(column.id)}>{column.name}</option>)}</select></label>
    <Tabs label="Task sections" values={['Conversations', 'Info', 'Git', 'Notes']} selected={section} onSelect={value => setSection(value as DrawerSection)} id={id} />
    <PendingTransitionStatus task={task} run={run} columnName={state.workflow.columns.find(column => column.id === task.pendingTransition?.columnId)?.name ?? task.pendingTransition?.columnId ?? ''} />
    <section className={'kb-drawer-panel ' + (section === 'Conversations' ? 'kb-chat-panel' : '')} role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
      {section === 'Conversations' && <>{!task.worktree && !dismissed && <div className="kb-notice" role="note" aria-label="Worktree not created"><strong>No worktree has been created</strong><p>Agents are working in the base project directory. Isolation is optional.</p><div className="kb-actions"><button type="button" className="kb-button kb-primary" disabled={blocked} onClick={() => setSection('Git')}>Create worktree</button><button type="button" className="kb-button" onClick={() => setDismissed(true)}>Dismiss</button></div></div>}<OperationStatus task={task} run={run} /><Conversations task={task} viewState={preferences} run={run} renderConversation={renderConversation} /></>}
      {section === 'Info' && <InfoPanel task={task} state={state} run={run} />}
      {section === 'Git' && <GitPanel task={task} project={project} api={api} run={run} onRemove={() => onDanger(task, 'worktree.remove')} />}
      {section === 'Notes' && <NotesPanel task={task} state={state} run={run} />}
    </section>
    <footer className="kb-drawer-footer"><ErrorNotice problem={action.error} /><div className="kb-actions">{task.archivedAt ? <button className="kb-button" disabled={action.pending || blocked} onClick={async () => { if (await action.execute({ type: 'task.restore', taskId: task.id })) onClose(); }}>Restore task</button> : <button className="kb-button" disabled={action.pending || blocked} onClick={async () => { if (await action.execute({ type: 'task.archive', taskId: task.id })) onClose(); }}>Archive task</button>}<button className="kb-button kb-danger" disabled={action.pending || blocked} onClick={() => onDanger(task, 'task.delete')}>Delete task</button></div><p className="kb-hint">Archive is reversible. Deleting a task archives native chats; it never purges their histories.</p></footer>
  </aside>;
}

function Conversations({ task, run, renderConversation, viewState }: { task: Task; run: RunCommand; renderConversation: (id: string) => ReactNode; viewState: TaskPageState }) {
  const open = task.sessionIds.filter(id => !task.closedSessionIds.includes(id)); const openKey = JSON.stringify(open); const [selected, setSelected] = usePageField(viewState, 'conversationId'); const [selectionRequired, setSelectionRequired] = usePageField(viewState, 'conversationSelectionRequired'); const action = useAction(run); const id = useId();
  const [creationPending, setCreationPending] = useState(false); const [creationError, setCreationError] = useState<Problem | null>(null);
  const canSelectDefault = !creationPending && !creationError && !selectionRequired;
  useEffect(() => { if (canSelectDefault && (selected === null || !open.includes(selected))) setSelected(open[0] ?? null); }, [openKey, selected, setSelected, canSelectDefault]);
  const active = selected !== null && open.includes(selected) ? selected : canSelectDefault ? open[0] : undefined;
  function chooseConversation(sessionId: string) { setSelected(sessionId); setSelectionRequired(false); setCreationError(null); }
  async function createConversation() {
    if (creationPending || creationError || selectionRequired) return;
    setCreationPending(true);
    try {
      const result = await action.execute({ type: 'conversation.create', taskId: task.id });
      if (!result) return;
      const sessionId = creationReceiptId(result, 'conversation');
      const createdTask = result.state.tasks.find(value => value.id === task.id);
      if (!sessionId || !createdTask?.sessionIds.includes(sessionId) || createdTask.closedSessionIds.includes(sessionId)) {
        setSelectionRequired(true);
        setCreationError({ code: !sessionId ? 'CREATION_RECEIPT_REQUIRED' : 'CREATED_CONVERSATION_UNAVAILABLE', message: 'The saved conversation could not be identified safely from its exact creation receipt. Select a tab explicitly or refresh the application before creating another conversation.' });
        return;
      }
      chooseConversation(sessionId);
    } finally { setCreationPending(false); }
  }
  const label = (sessionId: string) => 'Agent ' + (task.sessionIds.indexOf(sessionId) + 1);
  return <div className="kb-conversations"><div className="kb-session-toolbar"><div className="kb-tabs kb-agent-tabs" role="tablist" aria-label="Agent conversations">{open.map((sessionId, index) => <button type="button" key={sessionId} className="kb-tab" id={id + '-tab-' + sessionId} role="tab" aria-selected={active === sessionId} aria-controls={id + '-conversation'} tabIndex={active === sessionId ? 0 : -1} title={sessionId} onClick={() => chooseConversation(sessionId)} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % open.length; else if (event.key === 'ArrowLeft') next = (index + open.length - 1) % open.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = open.length - 1; else return; event.preventDefault(); const value = open[next]; if (value) { chooseConversation(value); document.getElementById(id + '-tab-' + value)?.focus(); } }}>{label(sessionId)}</button>)}</div>
      <button type="button" className="kb-button kb-icon-button" aria-label="New conversation" title="New conversation" disabled={action.pending || creationPending || Boolean(creationError || selectionRequired) || Boolean(task.operation || task.pendingTransition) || Boolean(task.archivedAt)} onClick={() => void createConversation()}>+</button>{active && <button type="button" className="kb-button" aria-label={'Close ' + label(active)} disabled={action.pending} onClick={() => void action.execute({ type: 'conversation.close', taskId: task.id, sessionId: active })}>Close tab</button>}
    </div><p className="kb-hint kb-directory">Agent cwd: <code>{task.effectiveCwd}</code></p><ErrorNotice problem={action.error} /><ErrorNotice problem={creationError ?? (selectionRequired ? { code: 'CREATION_RECEIPT_REQUIRED', message: 'Select a conversation tab explicitly or refresh the application before creating another conversation.' } : null)} />
    {task.closedSessionIds.length > 0 && <details className="kb-closed"><summary>Closed conversations ({task.closedSessionIds.length})</summary><div className="kb-actions">{task.closedSessionIds.map(sessionId => <button key={sessionId} type="button" className="kb-button" disabled={action.pending} onClick={async () => { const result = await action.execute({ type: 'conversation.reopen', taskId: task.id, sessionId }); if (result) chooseConversation(sessionId); }}>Reopen {label(sessionId)}</button>)}</div><p className="kb-hint">Closing a tab preserves its conversation and history.</p></details>}
    {active ? <div className="kb-native-conversation" role="tabpanel" id={id + '-conversation'} aria-labelledby={id + '-tab-' + active}><NativeBoundary key={active}><NativeView sessionId={active} renderConversation={renderConversation} /></NativeBoundary></div> : <p className="kb-empty">{creationPending ? 'Resolving the newly created conversation…' : selectionRequired ? 'Select a conversation tab explicitly before continuing.' : 'All conversation tabs are closed. Reopen an existing conversation or use + to add one.'}</p>}
  </div>;
}

function NativeView({ sessionId, renderConversation }: { sessionId: string; renderConversation: (id: string) => ReactNode }) { return <>{renderConversation(sessionId)}</>; }
class NativeBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : 'Native conversation rendering failed.' }; }
  render() { return this.state.error ? <div role="alert" className="kb-error"><strong>Native conversation unavailable</strong><p>{this.state.error}</p><button type="button" className="kb-button" onClick={() => this.setState({ error: null })}>Retry native view</button></div> : this.props.children; }
}
