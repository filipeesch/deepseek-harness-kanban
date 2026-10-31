import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EMPTY_ATTENTION, type Attention, type BoardState, type ClientApi, type Column, type Task } from '../shared/types.js';
import { isGitProject } from '../shared/project.js';
import { requiresWorktreeDecision } from '../shared/worktree-decision.js';
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
import type { AutoRunController } from './auto-run.js';
import { DrawerAutoRunNotice } from './auto-run-view.js';
import { autoModeView, AutoModeNotice, DrawerAutoModeToggle } from './auto-mode.js';
import { DrawerConversations } from './drawer-conversations.js';
import type { SessionTitles } from './conversation-label.js';
import type { ConversationLineagePort, DrawerSubagentAddress } from './conversation-navigation.js';
import { ConversationLeaseRegistry, type ConversationLeaseEnvironment } from './conversation-leases.js';
import { ConversationLeasesProvider } from './conversation-lease-context.js';
import { openSessionIds } from '../shared/conversations.js';

interface DrawerProps {
  task: Task; attention?: Attention; conversationAttention?: Readonly<Record<string, Attention>>; state: BoardState; api: ClientApi; run: RunCommand; autoRun?: AutoRunController;
  renderConversation: (id: string, target?: DrawerSubagentAddress) => ReactNode;
  onClose: () => void;
  onMove: (task: Task, column: Column, beforeTaskId?: string | null) => Promise<boolean>;
  onDanger: (task: Task, type: 'task.delete' | 'worktree.remove') => void;
  onToggleAutoMode?: (taskId: string, enabled: boolean) => void;
  autoModePending?: boolean;
  onForce?: (taskId: string) => void;
  viewState?: TaskPageState; sessionTitles?: SessionTitles;
  /** Lease scope for this drawer; omitted only by isolated render harnesses. */
  conversationLeases?: ConversationLeaseEnvironment;
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

export function TaskDrawer({ task, attention = EMPTY_ATTENTION, conversationAttention, state, api, run, autoRun, renderConversation, onClose, onMove, onDanger, onForce, onToggleAutoMode, autoModePending = false, viewState, sessionTitles, conversationLeases, lineage, peek: controlledPeek, onPeek, entering = false, closing = false }: DrawerProps) {
  const [localViewState] = useState(createTaskPageState); const preferences = viewState ?? localViewState;
  const [section, setSection] = usePageField(preferences, 'section'); const id = useId(); const close = useRef<HTMLButtonElement>(null);
  const [localPeek, setLocalPeek] = useState<DrawerSubagentAddress | null>(null);
  const peek = controlledPeek === undefined ? localPeek : controlledPeek;
  const setPeek = onPeek ?? setLocalPeek;
  const taskId = useRef(task.id);
  const [width, setWidth] = useState(storedWidth); const widthRef = useRef(width); widthRef.current = width;
  const aside = useRef<HTMLElement>(null);
  const [leases] = useState<ConversationLeaseRegistry | null>(() => conversationLeases === undefined ? null : new ConversationLeaseRegistry(conversationLeases));
  const openKey = JSON.stringify(openSessionIds(task));
  const [movingTo, setMovingTo] = useState<string | null>(null); const alive = useRef(true);
  useEffect(() => {
    close.current?.focus();
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { const element = aside.current; if (!element) return; if (closing) element.setAttribute('inert', ''); else element.removeAttribute('inert'); return () => element.removeAttribute('inert'); }, [closing]);
  useEffect(() => { if (closing || section !== 'Conversations') setPeek(null); }, [closing, section]);
  useEffect(() => {
    if (taskId.current === task.id) return;
    taskId.current = task.id;
    setPeek(null);
  }, [task.id, setPeek]);
  const project = state.projects.find(value => value.id === task.projectId); const blocked = Boolean(task.operation || task.pendingTransition);
  const autoMode = autoModeView(task, state.workflow);
  const gitBacked = project !== undefined && isGitProject(project);
  const worktreeDecisionRequired = requiresWorktreeDecision(task, project);
  const sections = ['Conversations', 'Info', ...(gitBacked ? ['Git'] : []), 'Notes'];
  const destinations = transitionDestinations(state.workflow, task.columnId);
  const worktreeDraft = useWorktreeDraft({ api, task, project, basePath: state.settings?.worktreeBasePath, enabled: gitBacked && !task.worktree && (section === 'Conversations' || section === 'Git') });
  useEffect(() => { if (!gitBacked && section === 'Git') setSection('Info'); }, [gitBacked, section, setSection]);
  useEffect(() => () => { leases?.dispose(); }, [leases]);
  useEffect(() => { if (leases !== null) leases.retainOnly(openSessionIds(task)); }, [leases, openKey]);

  async function moveTo(column: Column) {
    if (blocked || movingTo) return;
    setMovingTo(column.id);
    try { await onMove(task, column); }
    finally { if (alive.current) setMovingTo(null); }
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

  const body = <aside ref={aside} className="kb-drawer" aria-label="Task details" aria-labelledby={id + '-title'} style={{ width }} data-entering={entering ? 'true' : undefined} data-closing={closing ? 'true' : undefined}>
    <div className="kb-drawer-resize" role="separator" aria-orientation="vertical" aria-label="Resize task drawer" aria-valuenow={Math.round(width)} aria-valuemin={360} aria-valuemax={Math.round(Math.max(360, (typeof window === 'undefined' ? 1200 : window.innerWidth) * 0.9))} tabIndex={0} onPointerDown={startResize} onDoubleClick={() => persistWidth(clampWidth(DRAWER_DEFAULT_WIDTH))} onKeyDown={resizeKey} />
    <header className="kb-drawer-header"><div><h2 id={id + '-title'}>{task.title}</h2><p className="kb-hint">{project?.name ?? task.projectId}</p><TaskActivity attention={attention} /></div><div className="kb-drawer-header-actions">
      {onToggleAutoMode && <DrawerAutoModeToggle view={autoMode} pending={autoModePending} onToggle={enabled => onToggleAutoMode(task.id, enabled)} />}
      <button type="button" className="kb-button kb-icon-button kb-danger" aria-label="Delete task" title="Delete task" disabled={blocked} onClick={() => onDanger(task, 'task.delete')}><TrashIcon size={16} /></button>
      <button ref={close} type="button" className="kb-button kb-icon-button" aria-label="Close task details" title="Close task details" onClick={onClose}><CloseIcon size={16} /></button>
    </div></header>
    {(task.operation || task.pendingTransition) && <div className="kb-status-stack">
      <OperationStatus task={task} run={run} sessionTitles={sessionTitles} {...(onForce ? { onForce } : {})} />
      {task.pendingTransition && <PendingTransitionStatus task={task} run={run} columnName={state.workflow.columns.find(column => column.id === task.pendingTransition?.columnId)?.name ?? task.pendingTransition?.columnId ?? ''} />}
    </div>}
    <div className="kb-drawer-toolbar"><Tabs label="Task sections" values={sections} selected={section} onSelect={value => setSection(value as DrawerSection)} id={id} /><label className="kb-stage-compact"><span className="kb-sr">Move task to</span><select className="kb-input kb-stage-select" aria-label="Move task to" aria-describedby={id + '-stage-hint'} value={movingTo ?? task.columnId} disabled={blocked || movingTo !== null} onChange={event => { const column = state.workflow.columns.find(value => value.id === event.target.value); if (column && column.id !== task.columnId) void moveTo(column); }}>{destinations.map(({ column, access }) => <option key={column.id} value={column.id} className={access === 'restricted' ? 'kb-stage-option-restricted' : undefined} aria-label={access === 'restricted' ? column.name + ', requires confirmation' : undefined}>{column.name}</option>)}</select></label><span className="kb-sr" id={id + '-stage-hint'}>Stages that this workflow does not permit require confirmation before moving.</span></div>
    {autoRun && <DrawerAutoRunNotice task={task} controller={autoRun} columns={state.workflow.columns} sessionTitles={sessionTitles} />}
    {onToggleAutoMode && (!task.pendingTransition || task.pendingTransition.origin !== 'auto') && <AutoModeNotice view={autoMode} />}
    <section className={'kb-drawer-panel ' + (section === 'Conversations' ? 'kb-chat-panel' : '')} role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
      {section === 'Conversations' && <>{!gitBacked && task.worktree && <p className="kb-hint" role="note" aria-label="Plain checkout">This checkout is no longer Git-managed. Git actions are unavailable and the directory is kept when the task is deleted.</p>}{gitBacked && !task.worktree && !task.worktreeDismissed && <WorktreeNotice task={task} project={project} draft={worktreeDraft} run={run} disabled={blocked} onReview={() => setSection('Git')} />}<DrawerConversations task={task} viewState={preferences} sessionTitles={sessionTitles} run={run} renderConversation={renderConversation} peek={peek} onPeek={setPeek} lineage={lineage} worktreeDecisionRequired={worktreeDecisionRequired} projectUnavailable={project === undefined} conversationAttention={conversationAttention} /></>}
      {section === 'Info' && <InfoPanel task={task} state={state} run={run} viewState={preferences} />}
      {section === 'Git' && gitBacked && <GitPanel task={task} project={project} api={api} run={run} worktreeBasePath={state.settings?.worktreeBasePath} draft={worktreeDraft} />}
      {section === 'Notes' && <NotesPanel task={task} state={state} run={run} viewState={preferences} />}
    </section>
  </aside>;
  return leases === null ? body : <ConversationLeasesProvider registry={leases}>{body}</ConversationLeasesProvider>;
}
