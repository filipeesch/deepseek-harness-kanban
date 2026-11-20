import React, { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { EMPTY_ATTENTION, type Attention, type BoardState, type ClientApi, type Column, type Task } from '../shared/types.js';
import { isGitProject } from '../shared/project.js';
import { requiresWorktreeDecision } from '../shared/worktree-decision.js';
import { InfoPanel } from './forms.js';
import { NotesPanel } from './notes/notes-panel.js';
import { HistoryPanel } from './history/history-panel.js';
import { RelationsPanel } from './relations/relations-panel.js';
import { GitPanel, PendingTransitionStatus } from './git.js';
import { OperationStatus } from './operation-status.js';
import { WorktreeNotice, showsWorktreeNotice } from './worktree-notice.js';
import { useWorktreeDraft } from './worktree-draft.js';
import { type RunCommand } from './ui.js';
import { createTaskPageState, usePageField, type DrawerSection, type TaskPageState } from './page-state.js';
import { transitionAccess, transitionDestinations } from '../domain/transitions.js';
import { resolveNextStageRoute } from '../domain/transition-route.js';
import type { AutoRunController } from './auto-run.js';
import { DrawerAutoRunNotice } from './auto-run-view.js';
import { autoModeView } from './auto-mode.js';
import { ScriptPanel } from './scripted-panel.js';
import { DecisionPanel } from './decision-panel.js';
import type { DecisionWindowController } from './decision-window.js';
import type { StageEditorTab } from './stage/stage-tabs.js';
import { ScriptedHoldNotice } from './scripted-hold-notice.js';
import { useScriptSummary } from './scripted-context.js';
import { ownedScript, scriptActive } from './scripted-view.js';
import { DrawerHeader } from './drawer-header.js';
import { DrawerConversations } from './drawer-conversations.js';
import { DrawerWidthProvider, useDrawerWidth } from './drawer-width.js';
import type { SessionTitles } from './conversation-label.js';
import { ConversationLeaseRegistry, type ConversationLeaseEnvironment } from './conversation-leases.js';
import { ConversationLeasesProvider } from './conversation-lease-context.js';
import type { ConversationSurfaceMode } from './conversation-surface.js';
import { endPeek } from './drawer-view.js';
import type { DrawerNavigationSource } from './drawer-navigation-coordinator.js';
import { openSessionIds } from '../shared/conversations.js';

interface DrawerProps {
  task: Task; attention?: Attention; conversationAttention?: Readonly<Record<string, Attention>>; state: BoardState; api: ClientApi; run: RunCommand; autoRun?: AutoRunController;
  renderConversation: (id: string, mode?: ConversationSurfaceMode) => ReactNode;
  /** Reveals one Session in the host's main chat; used by a branch this task could not adopt. */
  onOpenInMain?: ((sessionId: string) => void) | undefined;
  /** Client navigation outcomes that change this drawer's presented view. */
  navigation?: DrawerNavigationSource | undefined;
  onClose: () => void;
  onMove: (task: Task, column: Column, beforeTaskId?: string | null) => Promise<boolean>;
  onDanger: (task: Task, type: 'task.delete' | 'worktree.remove') => void;
  /** Opens the board's stage editor; the script panel asks for its Execution tab. */
  onEditStage?: (stageId: string, initialTab?: StageEditorTab) => void;
  onToggleAutoMode?: (taskId: string, enabled: boolean) => void;
  autoModePending?: boolean;
  onForce?: (taskId: string) => void;
  /** The board's decision window; the panel is absent when the drawer renders without one. */
  decisionWindow?: DecisionWindowController;
  viewState?: TaskPageState; sessionTitles?: SessionTitles;
  /** Lease scope for this drawer; omitted only by isolated render harnesses. */
  conversationLeases?: ConversationLeaseEnvironment;
  entering?: boolean; closing?: boolean;
}

/** A drawer rendered without the client navigation coordinator still subscribes to a stable source. */
const NO_NAVIGATION: DrawerNavigationSource = { subscribe: () => () => {}, getSnapshot: () => 0 };


export function TaskDrawer({ task, decisionWindow, attention = EMPTY_ATTENTION, conversationAttention, state, api, run, autoRun, renderConversation, onOpenInMain, navigation, onClose, onMove, onDanger, onForce, onToggleAutoMode, autoModePending = false, viewState, sessionTitles, conversationLeases, entering = false, closing = false, onEditStage }: DrawerProps) {
  // A client navigation outcome is written to the drawer's page state outside React;
  // this subscription is what re-renders the drawer with the new view.
  const navigationSource = navigation ?? NO_NAVIGATION;
  void useSyncExternalStore(navigationSource.subscribe, navigationSource.getSnapshot, navigationSource.getSnapshot);
  const script = ownedScript(task, useScriptSummary(task.id));
  const [localViewState] = useState(createTaskPageState); const preferences = viewState ?? localViewState;
  const [section, setSection] = usePageField(preferences, 'section'); const id = useId(); const close = useRef<HTMLButtonElement>(null);
  const [, setPageView] = usePageField(preferences, 'view');
  // A peek is a view of the Conversations section; leaving it forgets the peek.
  useEffect(() => {
    if (section === 'Conversations') return;
    setPageView(current => endPeek(current));
  }, [section, setPageView]);
  const width = useDrawerWidth();
  const aside = useRef<HTMLElement>(null);
  const [leases] = useState<ConversationLeaseRegistry | null>(() => conversationLeases === undefined ? null : new ConversationLeaseRegistry(conversationLeases));
  const openKey = JSON.stringify(openSessionIds(task));
  const [movingTo, setMovingTo] = useState<string | null>(null); const alive = useRef(true);
  const [stageNotice, setStageNotice] = useState<string | null>(null);
  // Whether a model-fallback notice was read is this open drawer's own view state, held
  // here rather than in the Conversations section so that visiting Info, Git, or Notes
  // and coming back does not resurrect a notice the person already dismissed. Closing
  // the conversation forgets it, and closing the drawer forgets all of them.
  const [modelNoticeDismissed, setModelNoticeDismissed] = useState<string[]>([]);
  // The preset fallback keeps its own dismissal, for the same reasons and with the
  // same lifetime as the model notice.
  const [presetNoticeDismissed, setPresetNoticeDismissed] = useState<string[]>([]);
  useEffect(() => {
    setModelNoticeDismissed(previous => {
      const open = openSessionIds(task);
      const kept = previous.filter(sessionId => open.includes(sessionId));
      return kept.length === previous.length ? previous : kept;
    });
    setPresetNoticeDismissed(previous => {
      const open = openSessionIds(task);
      const kept = previous.filter(sessionId => open.includes(sessionId));
      return kept.length === previous.length ? previous : kept;
    });
  }, [openKey]);
  useEffect(() => {
    close.current?.focus();
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { const element = aside.current; if (!element) return; if (closing) element.setAttribute('inert', ''); else element.removeAttribute('inert'); return () => element.removeAttribute('inert'); }, [closing]);
  const project = state.projects.find(value => value.id === task.projectId); const blocked = Boolean(task.operation || task.pendingTransition);
  // The task-level attention already merges every conversation's pending user work,
  // including a closed one, so the control reads that instead of re-merging.
  const autoMode = autoModeView(task, state.workflow, attention.pending, script !== undefined);
  const gitBacked = project !== undefined && isGitProject(project);
  const worktreeDecisionRequired = requiresWorktreeDecision(task, project);
  const sections: DrawerSection[] = gitBacked ? ['Conversations', 'Info', 'Git', 'Notes', 'Relations', 'History'] : ['Conversations', 'Info', 'Notes', 'Relations', 'History'];
  const destinations = transitionDestinations(state.workflow, task.columnId);
  // The next-stage action follows a recorded transition; without one it still
  // steps to the adjacent stage, so the manual action keeps its meaning.
  const stageRoute = resolveNextStageRoute(state.workflow, task);
  const next = stageRoute.kind === 'advance'
    ? { column: stageRoute.column, access: transitionAccess(state.workflow, task.columnId, stageRoute.column.id) }
    : undefined;
  const staleNext = stageRoute.kind === 'stale' ? stageRoute.message : undefined;
  const projectName = project?.name ?? task.projectId;
  const worktreeDraft = useWorktreeDraft({ api, task, project, basePath: state.settings?.worktreeBasePath, enabled: gitBacked && !task.worktree && (section === 'Conversations' || section === 'Git') });
  useEffect(() => { if (!gitBacked && section === 'Git') setSection('Info'); }, [gitBacked, section, setSection]);
  // A refusal explains the current routing state, so it clears when the task moves.
  useEffect(() => { setStageNotice(null); }, [task.id, task.columnId]);
  useEffect(() => () => { leases?.dispose(); }, [leases]);
  useEffect(() => { if (leases !== null) leases.retainOnly(openSessionIds(task)); }, [leases, openKey]);

  async function moveTo(column: Column) {
    if (blocked || movingTo) return;
    setMovingTo(column.id);
    try { await onMove(task, column); }
    finally { if (alive.current) setMovingTo(null); }
  }

  const body = <aside ref={aside} className="kb-drawer" aria-label="Task details" aria-labelledby={id + '-title'} style={{ width: width.width }} data-entering={entering ? 'true' : undefined} data-closing={closing ? 'true' : undefined}>
    <div className="kb-drawer-resize" role="separator" aria-orientation="vertical" aria-label="Resize task drawer" aria-valuenow={Math.round(width.width)} aria-valuemin={width.minWidth} aria-valuemax={width.maxWidth} tabIndex={0} onPointerDown={event => { event.stopPropagation(); width.beginResize(event); }} onDoubleClick={width.resetWidth} onKeyDown={width.resizeKey} />
    <DrawerHeader
      title={{ id: id + '-title', title: task.title, projectName }}
      sectionNav={{ id, sections, selected: section, onSelect: value => setSection(value), activity: { ...attention, script: scriptActive(script) } }}
      stage={{ id, destinations, currentColumnId: task.columnId, next, ...(staleNext === undefined ? {} : { staleNext, onRefuse: () => setStageNotice(staleNext) }), movingTo, blocked, onMove: column => { void moveTo(column); } }}
      actions={{ ...(onToggleAutoMode ? { autoMode, onToggleAutoMode: (enabled: boolean) => onToggleAutoMode(task.id, enabled) } : {}), autoModePending, blocked, onDelete: () => onDanger(task, 'task.delete'), onClose, closeRef: close }}
    />
    {(task.operation || task.pendingTransition) && <div className="kb-status-stack">
      <OperationStatus task={task} run={run} sessionTitles={sessionTitles} {...(onForce ? { onForce } : {})} {...(state.settings?.worktreeBasePath ? { worktreeBasePath: state.settings.worktreeBasePath } : {})} />
      {task.pendingTransition && <PendingTransitionStatus task={task} run={run} columnName={state.workflow.columns.find(column => column.id === task.pendingTransition?.columnId)?.name ?? task.pendingTransition?.columnId ?? ''} />}
    </div>}
    {stageNotice !== null && <div className="kb-status-stack"><div className="kb-error" role="alert"><strong>The recorded transition is no longer valid</strong><span>{stageNotice}</span></div></div>}
    {script?.hold && <div className="kb-status-stack"><ScriptedHoldNotice task={task} hold={script.hold} run={run} /></div>}
    {decisionWindow !== undefined && <DecisionPanel task={task} column={state.workflow.columns.find(column => column.id === task.columnId)} columns={state.workflow.columns} controller={decisionWindow} {...(state.localStageIdentities === undefined ? {} : { stageIdentities: state.localStageIdentities })} />}
    <ScriptPanel task={task} column={state.workflow.columns.find(column => column.id === task.columnId)} projectName={projectName} api={api} run={run} {...(onEditStage === undefined ? {} : { onEditStage: () => onEditStage(task.columnId, 'execution') })} />
    {autoRun && !script && <DrawerAutoRunNotice task={task} controller={autoRun} columns={state.workflow.columns} sessionTitles={sessionTitles} />}
    <section className={'kb-drawer-panel ' + (section === 'Conversations' ? 'kb-chat-panel' : '')} role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
{section === 'Conversations' && <>{!gitBacked && task.worktree && <p className="kb-hint" role="note" aria-label="Plain checkout">This checkout is no longer Git-managed. Git actions are unavailable and the directory is kept when the task is deleted.</p>}{showsWorktreeNotice(task, project) && <WorktreeNotice task={task} project={project} draft={worktreeDraft} run={run} disabled={blocked} onReview={() => setSection('Git')} />}<DrawerConversations task={task} viewState={preferences} sessionTitles={sessionTitles} run={run} renderConversation={renderConversation} worktreeDecisionRequired={worktreeDecisionRequired} projectUnavailable={project === undefined} conversationAttention={conversationAttention} modelNoticeDismissed={modelNoticeDismissed} onDismissModelNotice={sessionId => setModelNoticeDismissed(current => current.includes(sessionId) ? current : [...current, sessionId])} boardDefaultPreset={state.effectiveDefaultPreset ?? state.workflow.agentPreset} presetNoticeDismissed={presetNoticeDismissed} onDismissPresetNotice={sessionId => setPresetNoticeDismissed(current => current.includes(sessionId) ? current : [...current, sessionId])} onOpenInMain={onOpenInMain} /></>}
      {section === 'Info' && <InfoPanel task={task} state={state} run={run} viewState={preferences} api={api} />}
      {section === 'Git' && gitBacked && <GitPanel task={task} project={project} api={api} run={run} worktreeBasePath={state.settings?.worktreeBasePath} draft={worktreeDraft} />}
      {section === 'Notes' && <NotesPanel task={task} state={state} run={run} viewState={preferences} />}
      {section === 'Relations' && <RelationsPanel taskId={task.id} taskBoardId={state.boardId ?? ''} relations={state.relations ?? []} />}
      {section === 'History' && <HistoryPanel history={task.history} columns={state.workflow.columns} />}
    </section>
  </aside>;
  const framed = <DrawerWidthProvider value={width}>{body}</DrawerWidthProvider>;
  return leases === null ? framed : <ConversationLeasesProvider registry={leases}>{framed}</ConversationLeasesProvider>;
}