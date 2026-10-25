import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EMPTY_ATTENTION, type Attention, type BoardState, type ClientApi, type Column, type Task } from '../shared/types.js';
import { InfoPanel, NotesPanel } from './forms.js';
import { GitPanel, PendingTransitionStatus } from './git.js';
import { OperationStatus } from './operation-status.js';
import { WorktreeNotice } from './worktree-notice.js';
import { useWorktreeDraft } from './worktree-draft.js';
import { Tabs, type RunCommand } from './ui.js';
import { CloseIcon, TrashIcon } from './icons.js';
import { createTaskPageState, usePageField, type DrawerSection, type TaskPageState } from './page-state.js';
import { TaskActivity } from './activity.js';
import { transitionDestinations } from '../domain/transitions.js';
import type { DraftResult, InstructionDraftPort } from './instruction-draft.js';
import { DrawerConversations, conversationLabel, type SessionTitles } from './drawer-conversations.js';
import type { ConversationLineagePort, DrawerSubagentAddress } from './conversation-navigation.js';

export { conversationLabel } from './drawer-conversations.js';
export type { SessionTitles } from './drawer-conversations.js';

interface PrefillStatus { status: 'pending' | DraftResult; sessionId: string | null; column: Column; message?: string }
interface DrawerProps {
  task: Task; attention?: Attention; state: BoardState; api: ClientApi; run: RunCommand;
  renderConversation: (id: string, target?: DrawerSubagentAddress) => ReactNode;
  onClose: () => void;
  onMove: (task: Task, column: Column, beforeTaskId?: string | null) => Promise<boolean>;
  onDanger: (task: Task, type: 'task.delete' | 'worktree.remove') => void;
  viewState?: TaskPageState; sessionTitles?: SessionTitles; draftPort?: InstructionDraftPort;
  lineage?: ConversationLineagePort;
  /** Controlled investigation target; omitted keeps the drawer's transient local state. */
  peek?: DrawerSubagentAddress | null;
  onPeek?: (target: DrawerSubagentAddress | null) => void;
  entering?: boolean; closing?: boolean;
}

const DRAWER_WIDTH_KEY = 'dsh-kanban.drawer.width';
const DRAWER_DEFAULT_WIDTH = 620;
function clampWidth(value: number): number { const max = Math.max(360, (typeof window === 'undefined' ? 1200 : window.innerWidth) * 0.9); return Math.min(Math.max(value, 360), max); }
function storedWidth(): number { try { const value = Number(window.localStorage.getItem(DRAWER_WIDTH_KEY)); if (Number.isFinite(value) && value > 0) return clampWidth(value === 560 ? DRAWER_DEFAULT_WIDTH : value); } catch { /* storage is optional */ } return clampWidth(DRAWER_DEFAULT_WIDTH); }

export function TaskDrawer({ task, attention = EMPTY_ATTENTION, state, api, run, renderConversation, onClose, onMove, onDanger, viewState, sessionTitles, draftPort, lineage, peek: controlledPeek, onPeek, entering = false, closing = false }: DrawerProps) {
  const [localViewState] = useState(createTaskPageState); const preferences = viewState ?? localViewState;
  const [section, setSection] = usePageField(preferences, 'section'); const [dismissed, setDismissed] = useState(false); const id = useId(); const close = useRef<HTMLButtonElement>(null);
  const [localPeek, setLocalPeek] = useState<DrawerSubagentAddress | null>(null);
  const peek = controlledPeek === undefined ? localPeek : controlledPeek;
  const setPeek = onPeek ?? setLocalPeek;
  const taskId = useRef(task.id);
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
  useEffect(() => { if (closing || section !== 'Conversations') setPeek(null); }, [closing, section]);
  useEffect(() => {
    if (taskId.current === task.id) return;
    taskId.current = task.id;
    setPeek(null);
  }, [task.id, setPeek]);
  const project = state.projects.find(value => value.id === task.projectId); const blocked = Boolean(task.operation || task.pendingTransition);
  const destinations = transitionDestinations(state.workflow, task.columnId);
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
    setPeek(null);
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
    <header className="kb-drawer-header"><div><h2 id={id + '-title'}>{task.title}</h2><p className="kb-hint">{project?.name ?? task.projectId}</p><TaskActivity attention={attention} variant="drawer" /></div><div className="kb-drawer-header-actions">
      <button type="button" className="kb-button kb-icon-button kb-danger" aria-label="Delete task" title="Delete task" disabled={blocked} onClick={() => onDanger(task, 'task.delete')}><TrashIcon size={16} /></button>
      <button ref={close} type="button" className="kb-button kb-icon-button" aria-label="Close task details" title="Close task details" onClick={onClose}><CloseIcon size={16} /></button>
    </div></header>
    {(task.operation || task.pendingTransition) && <div className="kb-status-stack">
      <OperationStatus task={task} run={run} sessionTitles={sessionTitles} />
      <PendingTransitionStatus task={task} run={run} columnName={state.workflow.columns.find(column => column.id === task.pendingTransition?.columnId)?.name ?? task.pendingTransition?.columnId ?? ''} />
    </div>}
    <div className="kb-drawer-toolbar"><Tabs label="Task sections" values={['Conversations', 'Info', 'Git', 'Notes']} selected={section} onSelect={value => setSection(value as DrawerSection)} id={id} /><label className="kb-stage-compact"><span className="kb-sr">Move task to</span><select className="kb-input kb-stage-select" aria-label="Move task to" aria-describedby={id + '-stage-hint'} value={movingTo ?? task.columnId} disabled={blocked || movingTo !== null} onChange={event => { const column = state.workflow.columns.find(value => value.id === event.target.value); if (column && column.id !== task.columnId) void moveTo(column); }}>{destinations.map(({ column, access }) => <option key={column.id} value={column.id} className={access === 'restricted' ? 'kb-stage-option-restricted' : undefined} aria-label={access === 'restricted' ? column.name + ', requires confirmation' : undefined}>{column.name}</option>)}</select></label><span className="kb-sr" id={id + '-stage-hint'}>Stages that this workflow does not permit require confirmation before moving.</span></div>
    {prefill && <div className={'kb-prefill kb-prefill-' + prefill.status} role="status"><p>{prefillText(prefill)}</p>{prefill.status === 'preserved' && <button type="button" className="kb-button" onClick={() => void replaceDraft()}>Replace draft</button>}</div>}
    <section className={'kb-drawer-panel ' + (section === 'Conversations' ? 'kb-chat-panel' : '')} role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
      {section === 'Conversations' && <>{!task.worktree && !dismissed && <WorktreeNotice task={task} project={project} draft={worktreeDraft} run={run} disabled={blocked} onReview={() => setSection('Git')} onDismiss={() => setDismissed(true)} />}<DrawerConversations task={task} viewState={preferences} sessionTitles={sessionTitles} run={run} renderConversation={renderConversation} peek={peek} onPeek={setPeek} lineage={lineage} /></>}
      {section === 'Info' && <InfoPanel task={task} state={state} run={run} viewState={preferences} />}
      {section === 'Git' && <GitPanel task={task} project={project} api={api} run={run} worktreeBasePath={state.settings?.worktreeBasePath} draft={worktreeDraft} />}
      {section === 'Notes' && <NotesPanel task={task} state={state} run={run} viewState={preferences} />}
    </section>
  </aside>;
}
