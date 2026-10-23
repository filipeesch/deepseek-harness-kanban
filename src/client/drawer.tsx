import React, { Component, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BoardState, ClientApi, Column, Problem, Task } from '../shared/types.js';
import { InfoPanel, NotesPanel } from './forms.js';
import { GitPanel, PendingTransitionStatus } from './git.js';
import { OperationStatus } from './operation-status.js';
import { WorktreeNotice } from './worktree-notice.js';
import { useWorktreeDraft } from './worktree-draft.js';
import { creationReceiptId, ErrorNotice, Tabs, useAction, type RunCommand } from './ui.js';
import { CloseIcon, TrashIcon } from './icons.js';
import { createTaskPageState, usePageField, type DrawerSection, type TaskPageState } from './page-state.js';
import { permittedDestinations } from '../domain/transitions.js';
import type { DraftResult, InstructionDraftPort } from './instruction-draft.js';

export interface SessionTitles { title(sessionId: string): string | undefined; rename(sessionId: string, title: string): Promise<void> }
export function conversationLabel(task: Task, sessionId: string, titles?: SessionTitles): string {
  return titles?.title(sessionId)?.trim() || 'Agent ' + (task.sessionIds.indexOf(sessionId) + 1);
}

interface PrefillStatus { status: 'pending' | DraftResult; sessionId: string | null; column: Column; message?: string }
interface DrawerProps { task: Task; state: BoardState; api: ClientApi; run: RunCommand; renderConversation: (id: string) => ReactNode; onClose: () => void; onMove: (task: Task, column: Column, beforeTaskId?: string | null) => Promise<boolean>; onDanger: (task: Task, type: 'task.delete' | 'worktree.remove') => void; viewState?: TaskPageState; sessionTitles?: SessionTitles; draftPort?: InstructionDraftPort; entering?: boolean; closing?: boolean }

const DRAWER_WIDTH_KEY = 'dsh-kanban.drawer.width';
const DRAWER_DEFAULT_WIDTH = 620;
function clampWidth(value: number): number { const max = Math.max(360, (typeof window === 'undefined' ? 1200 : window.innerWidth) * 0.9); return Math.min(Math.max(value, 360), max); }
function storedWidth(): number { try { const value = Number(window.localStorage.getItem(DRAWER_WIDTH_KEY)); if (Number.isFinite(value) && value > 0) return clampWidth(value === 560 ? DRAWER_DEFAULT_WIDTH : value); } catch { /* storage is optional */ } return clampWidth(DRAWER_DEFAULT_WIDTH); }

export function TaskDrawer({ task, state, api, run, renderConversation, onClose, onMove, onDanger, viewState, sessionTitles, draftPort, entering = false, closing = false }: DrawerProps) {
  const [localViewState] = useState(createTaskPageState); const preferences = viewState ?? localViewState;
  const [section, setSection] = usePageField(preferences, 'section'); const [dismissed, setDismissed] = useState(false); const id = useId(); const close = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(storedWidth); const widthRef = useRef(width); widthRef.current = width;
  const aside = useRef<HTMLElement>(null);
  const [movingTo, setMovingTo] = useState<string | null>(null); const [prefill, setPrefill] = useState<PrefillStatus | null>(null); const prefillAbort = useRef<AbortController | null>(null); const prefillTimer = useRef<number | null>(null); const alive = useRef(true);
  useEffect(() => {
    close.current?.focus();
    alive.current = true;
    return () => {
      alive.current = false;
      prefillAbort.current?.abort();
      if (prefillTimer.current !== null) { window.clearTimeout(prefillTimer.current); prefillTimer.current = null; }
    };
  }, []);
  useEffect(() => { const element = aside.current; if (!element) return; if (closing) element.setAttribute('inert', ''); else element.removeAttribute('inert'); return () => element.removeAttribute('inert'); }, [closing]);
  useEffect(() => { setDismissed(false); }, [task.worktree?.path]);
  const project = state.projects.find(value => value.id === task.projectId); const blocked = Boolean(task.operation || task.pendingTransition);
  const permitted = permittedDestinations(state.workflow, task.columnId);
  const worktreeDraft = useWorktreeDraft({ api, task, project, basePath: state.settings?.worktreeBasePath, enabled: !task.worktree && (section === 'Conversations' || section === 'Git') });

  async function moveTo(column: Column) {
    if (blocked || movingTo) return;
    const controller = new AbortController();
    prefillAbort.current?.abort();
    if (prefillTimer.current !== null) { window.clearTimeout(prefillTimer.current); prefillTimer.current = null; }
    prefillAbort.current = controller;
    setPrefill(null); setMovingTo(column.id);
    let moved = false;
    try { moved = await onMove(task, column); }
    finally { if (alive.current) setMovingTo(null); }
    if (!moved || !alive.current || controller.signal.aborted) return;
    const instruction = column.onEnterPrompt ?? '';
    if (!instruction.trim()) return;
    if (preferences.conversationSelectionRequired) {
      setPrefill({ status: 'unavailable', sessionId: null, column, message: 'Select a conversation tab before inserting the instruction.' });
      return;
    }
    const active = preferences.conversationId && task.sessionIds.includes(preferences.conversationId) && !task.closedSessionIds.includes(preferences.conversationId)
      ? preferences.conversationId
      : task.sessionIds.find(value => !task.closedSessionIds.includes(value)) ?? null;
    if (!active) { setPrefill({ status: 'unavailable', sessionId: null, column, message: 'No open conversation is available for the instruction. Open a conversation or use the card run action.' }); return; }
    if (!draftPort) { setPrefill({ status: 'unavailable', sessionId: active, column, message: 'The conversation composer is unavailable, so the instruction was not inserted.' }); return; }
    if (section !== 'Conversations') setSection('Conversations');
    setPrefill({ status: 'pending', sessionId: active, column });
    prefillTimer.current = window.setTimeout(() => {
      if (!alive.current || controller.signal.aborted) return;
      controller.abort();
      prefillTimer.current = null;
      setPrefill({ status: 'unavailable', sessionId: active, column, message: 'The conversation did not become ready for the instruction. Select the conversation and use the card run action.' });
    }, 8000);
    let result: DraftResult;
    try { result = await draftPort.prepare(active, instruction, controller.signal); }
    catch { result = 'unavailable'; }
    if (prefillTimer.current !== null) { window.clearTimeout(prefillTimer.current); prefillTimer.current = null; }
    if (alive.current && !controller.signal.aborted) setPrefill({ status: result, sessionId: active, column });
  }
  async function replaceDraft() {
    if (!prefill || prefill.status !== 'preserved' || !prefill.sessionId || !draftPort || !alive.current) return;
    const currentPrefill = prefill; const sessionId = prefill.sessionId;
    const controller = new AbortController(); prefillAbort.current?.abort(); prefillAbort.current = controller;
    setPrefill({ ...currentPrefill, status: 'pending' });
    let result: DraftResult;
    try { result = await draftPort.replace(sessionId, currentPrefill.column.onEnterPrompt ?? '', controller.signal); }
    catch { result = 'unavailable'; }
    if (alive.current && !controller.signal.aborted) setPrefill({ ...currentPrefill, status: result });
  }
  function prefillText(value: PrefillStatus): string {
    const label = value.sessionId ? conversationLabel(task, value.sessionId, sessionTitles) : null;
    if (value.status === 'pending') return 'Inserting the ' + value.column.name + ' instruction…';
    if (value.status === 'applied') return 'Instruction inserted into ' + (label ?? 'the conversation') + "'s composer.";
    if (value.status === 'preserved') return 'The composer already has unsent text or attachments. The instruction was not inserted.';
    if (value.status === 'blocked') return 'The conversation is busy. The instruction was not inserted.';
    return value.message ?? 'No open conversation is available for the instruction.';
  }

  function persistWidth(next: number) { setWidth(next); try { window.localStorage.setItem(DRAWER_WIDTH_KEY, String(next)); } catch { /* storage is optional */ } }
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX; const startWidth = widthRef.current;
    const move = (moveEvent: PointerEvent) => setWidth(clampWidth(startWidth + (startX - moveEvent.clientX)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); persistWidth(widthRef.current); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function resizeKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); persistWidth(clampWidth(width + 16)); }
    if (event.key === 'ArrowRight') { event.preventDefault(); persistWidth(clampWidth(width - 16)); }
    if (event.key === 'Home') { event.preventDefault(); persistWidth(clampWidth(DRAWER_DEFAULT_WIDTH)); }
  }

  return <aside ref={aside} className="kb-drawer" aria-label="Task details" aria-labelledby={id + '-title'} style={{ width }} data-entering={entering ? 'true' : undefined} data-closing={closing ? 'true' : undefined}>
    <div className="kb-drawer-resize" role="separator" aria-orientation="vertical" aria-label="Resize task drawer" aria-valuenow={Math.round(width)} aria-valuemin={360} aria-valuemax={Math.round(Math.max(360, (typeof window === 'undefined' ? 1200 : window.innerWidth) * 0.9))} tabIndex={0} onPointerDown={startResize} onDoubleClick={() => persistWidth(clampWidth(DRAWER_DEFAULT_WIDTH))} onKeyDown={resizeKey} />
    <header className="kb-drawer-header"><div><h2 id={id + '-title'}>{task.title}</h2><p className="kb-hint">{project?.name ?? task.projectId}</p></div><div className="kb-drawer-header-actions">
      <button type="button" className="kb-button kb-icon-button kb-danger" aria-label="Delete task" title="Delete task" disabled={blocked} onClick={() => onDanger(task, 'task.delete')}><TrashIcon size={16} /></button>
      <button ref={close} type="button" className="kb-button kb-icon-button" aria-label="Close task details" title="Close task details" onClick={onClose}><CloseIcon size={16} /></button>
    </div></header>
    {(task.operation || task.pendingTransition) && <div className="kb-status-stack">
      <OperationStatus task={task} run={run} sessionTitles={sessionTitles} />
      <PendingTransitionStatus task={task} run={run} columnName={state.workflow.columns.find(column => column.id === task.pendingTransition?.columnId)?.name ?? task.pendingTransition?.columnId ?? ''} />
    </div>}
    <div className="kb-drawer-toolbar"><Tabs label="Task sections" values={['Conversations', 'Info', 'Git', 'Notes']} selected={section} onSelect={value => setSection(value as DrawerSection)} id={id} /><label className="kb-stage-compact"><span className="kb-sr">Move task to</span><select className="kb-input kb-stage-select" aria-label="Move task to" value={movingTo ?? task.columnId} disabled={blocked || movingTo !== null} onChange={event => { const column = state.workflow.columns.find(value => value.id === event.target.value); if (column && column.id !== task.columnId) void moveTo(column); }}>{permitted.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label></div>
    {prefill && <div className={'kb-prefill kb-prefill-' + prefill.status} role="status"><p>{prefillText(prefill)}</p>{prefill.status === 'preserved' && <button type="button" className="kb-button" onClick={() => void replaceDraft()}>Replace draft</button>}</div>}
    <section className={'kb-drawer-panel ' + (section === 'Conversations' ? 'kb-chat-panel' : '')} role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
      {section === 'Conversations' && <>{!task.worktree && !dismissed && <WorktreeNotice task={task} project={project} draft={worktreeDraft} run={run} disabled={blocked} onReview={() => setSection('Git')} onDismiss={() => setDismissed(true)} />}<Conversations task={task} viewState={preferences} sessionTitles={sessionTitles} run={run} renderConversation={renderConversation} /></>}
      {section === 'Info' && <InfoPanel task={task} state={state} run={run} viewState={preferences} />}
      {section === 'Git' && <GitPanel task={task} project={project} api={api} run={run} worktreeBasePath={state.settings?.worktreeBasePath} draft={worktreeDraft} />}
      {section === 'Notes' && <NotesPanel task={task} state={state} run={run} viewState={preferences} />}
    </section>
  </aside>;
}

function Conversations({ task, run, renderConversation, viewState, sessionTitles }: { task: Task; run: RunCommand; renderConversation: (id: string) => ReactNode; viewState: TaskPageState; sessionTitles?: SessionTitles }) {
  const open = task.sessionIds.filter(id => !task.closedSessionIds.includes(id)); const openKey = JSON.stringify(open); const [selected, setSelected] = usePageField(viewState, 'conversationId'); const [selectionRequired, setSelectionRequired] = usePageField(viewState, 'conversationSelectionRequired'); const action = useAction(run); const id = useId();
  const [creationPending, setCreationPending] = useState(false); const [creationError, setCreationError] = useState<Problem | null>(null);
  const [renaming, setRenaming] = useState<{ sessionId: string; value: string } | null>(null); const [renameError, setRenameError] = useState<Problem | null>(null);
  const canSelectDefault = !creationPending && !creationError && !selectionRequired;
  useEffect(() => { if (canSelectDefault && (selected === null || !open.includes(selected))) setSelected(open[0] ?? null); }, [openKey, selected, setSelected, canSelectDefault]);
  const active = selected !== null && open.includes(selected) ? selected : canSelectDefault ? open[0] : undefined;
  function chooseConversation(sessionId: string) { setSelected(sessionId); setSelectionRequired(false); setCreationError(null); }
  const label = (sessionId: string) => conversationLabel(task, sessionId, sessionTitles);
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
  function beginRename(sessionId: string) { if (!sessionTitles) return; const labelValue = sessionTitles.title(sessionId) ?? ''; setRenaming({ sessionId, value: labelValue }); setRenameError(null); }
  async function commitRename() {
    if (!renaming || !sessionTitles) return;
    const value = renaming.value.trim(); const sessionId = renaming.sessionId; setRenaming(null);
    if (!value || value === sessionTitles.title(sessionId)) return;
    try { await sessionTitles.rename(sessionId, value); }
    catch (error) { setRenameError({ code: 'RENAME_FAILED', message: error instanceof Error ? error.message : 'The conversation title could not be renamed.' }); }
  }
  return <div className="kb-conversations"><div className="kb-session-toolbar"><div className="kb-tabs kb-agent-tabs" role="tablist" aria-label="Agent conversations">{open.map((sessionId, index) => renaming?.sessionId === sessionId ? <input key={sessionId} className="kb-input kb-tab-input" autoFocus aria-label={'Rename ' + label(sessionId)} value={renaming.value} onChange={event => setRenaming({ sessionId, value: event.target.value })} onBlur={() => void commitRename()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitRename(); } if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); } }} /> : <button type="button" key={sessionId} className="kb-tab" id={id + '-tab-' + sessionId} role="tab" aria-selected={active === sessionId} aria-controls={id + '-conversation'} tabIndex={active === sessionId ? 0 : -1} title={sessionTitles?.title(sessionId) ?? sessionId} onClick={() => chooseConversation(sessionId)} onDoubleClick={() => beginRename(sessionId)} onContextMenu={event => { if (!sessionTitles) return; event.preventDefault(); beginRename(sessionId); }} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % open.length; else if (event.key === 'ArrowLeft') next = (index + open.length - 1) % open.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = open.length - 1; else return; event.preventDefault(); const value = open[next]; if (value) { chooseConversation(value); document.getElementById(id + '-tab-' + value)?.focus(); } }}>{label(sessionId)}</button>)}</div>
    <button type="button" className="kb-button kb-icon-button" aria-label="New conversation" title="New conversation" disabled={action.pending || creationPending || Boolean(creationError || selectionRequired) || Boolean(task.operation || task.pendingTransition)} onClick={() => void createConversation()}><span aria-hidden="true">+</span></button>{active && <button type="button" className="kb-button kb-icon-button" aria-label={'Close ' + label(active)} title={'Close ' + label(active)} disabled={action.pending} onClick={() => void action.execute({ type: 'conversation.close', taskId: task.id, sessionId: active })}><CloseIcon size={14} /></button>}
  </div><ErrorNotice problem={action.error} /><ErrorNotice problem={renameError} /><ErrorNotice problem={creationError ?? (selectionRequired ? { code: 'CREATION_RECEIPT_REQUIRED', message: 'Select a conversation tab explicitly or refresh the application before creating another conversation.' } : null)} />
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
