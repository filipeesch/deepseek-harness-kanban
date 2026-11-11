import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Board, ClientApi, Column, Command, KanbanSnapshot, Problem, Project, Task, Workflow, WorkflowView as WorkflowPresentation } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import { creatableProjects, isBoardClosedForCreation } from '../domain/board-project-scope.js';
import { Configuration } from './settings/configuration.js';
import { DirectoryPickerProvider } from './services.js';
import type { DirectoryPickerPort } from './directory-picker.js';
import { TaskDrawer } from './drawer.js';
import type { SessionTitles } from './conversation-label.js';
import type { ConversationLeaseEnvironment } from './conversation-leases.js';
import { AutoRunController } from './auto-run.js';
import { BoardCard } from './board-card.js';
import { BoardHeader } from './board/board-header.js';
import { BoardBody, BoardEmptyStates, ProjectsEmptyState } from './board/board-frames.js';
import { NoticeStack } from './board/notice-stack.js';
import { TeamChangesBanner } from './notices/team-banner.js';
import { useBoardNotices, type NoticeDismissalPort } from './notices/use-board-notices.js';
import type { NoticeHandlers } from './notices/model.js';
import { BoardColumnsView } from './board/board-columns-view.js';
import { StageEditorDialog } from './stage/stage-editor-dialog.js';
import { BoardCreationDialogs } from './board/board-dialogs.js';
import { useCreationDialogs } from './use-creation-dialogs.js';
import { useTaskCreation } from './use-task-creation.js';
import { WorkflowView as WorkflowDiagram } from './workflow-view/workflow-view.js';
import { WorkflowViewControl } from './workflow-view/view-control.js';
import { readBoardView, writeBoardView } from './view-preference.js';
import { cardLayoutKeys, planColumns } from './board-columns.js';
import { filterTasks } from './task-filter.js';
import { cardFocusTarget } from './card-focus.js';
import { prefersReducedMotion } from './card-motion/preference.js';
import { ACTIVE_HUB_KEY, readBoardPreferences, readStorage, writeBoardPreference, writeStorage } from './active-scope.js';
import { allTasks, normalizeSnapshot } from './snapshot-normalize.js';
import { scopedCommand } from './command-scope.js';
import { boardView } from './board-projection.js';
import { projectScopeActivity, type ScopeActivity } from './scope-activity.js';
import { BoardTabRow, HubTabRow } from './hub-nav.js';
import { asProblem } from './ui.js';
import { adviseCommandFailure } from './command-failure.js';
import { styles } from './styles/index.js';
import { DeleteTaskDialog, DiscardDialog, RemoveWorktreeDialog, type DestructiveRequest } from './destructive-dialogs.js';
import { BulkDeleteDialog } from './bulk-delete-dialogs.js';
import { ForceRemovalDialog } from './force-removal-dialog.js';
import { useDestructiveOperations } from './destructive-operations.js';
import { batchRejectionProblem, useBatchDeletion } from './useBatchDeletion.js';
import { useBoardMoves } from './board-moves.js';
import { useExecutionPreparation } from './execution-preparation/use-execution-preparation.js';
import { ModelFallbacksProvider, useModelFallbackRegistry } from './model-fallbacks.js';
import type { PreparationSeat } from './execution-preparation/model-seat.js';
import { createBoardPageState, taskPageState, usePageField, type BoardPageState } from './page-state.js';
export { createBoardPageState } from './page-state.js';
export type { BoardPageState } from './page-state.js';

export interface BoardViewProps {
  api: ClientApi;
  renderConversation: (id: string) => ReactNode;
  pageState?: BoardPageState;
  sessionTitles?: SessionTitles;
  /** Lease scope owned by each mounted task drawer; absent only in isolated render harnesses. */
  conversationLeases?: ConversationLeaseEnvironment;
  picker?: DirectoryPickerPort | null;
  /** Owned by its provider, which also reconciles it; the board reconciles only its own fallback. */
  autoRun?: AutoRunController;
  /** Native slots and locale used by the first-execution model stage; absent in isolated harnesses. */
  nativeSeat?: PreparationSeat;
  /** Opens one native conversation, used by a schedule's last-run link. */
  onOpenSession?: (sessionId: string) => void;
  /** Acknowledges the settled turns of the given conversations; absent in isolated harnesses. */
  onMarkAllRead?: (sessionIds: readonly string[]) => void;
}

const EMPTY_TASKS: readonly Task[] = [];
const EMPTY_PROJECTS: readonly Project[] = [];

export function BoardView({ api, renderConversation, pageState, sessionTitles, conversationLeases, picker = null, autoRun: providedAutoRun, nativeSeat, onOpenSession, onMarkAllRead }: BoardViewProps) {
  const [localPageState] = useState(createBoardPageState); const preferences = pageState ?? localPageState;
  const [snapshot, setSnapshot] = useState<KanbanSnapshot | null>(null); const latest = useRef<KanbanSnapshot | null>(null); const live = useRef(false); const currentApi = useRef(api); currentApi.current = api;
  const [loadError, setLoadError] = useState<Problem | null>(null); const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = usePageField(preferences, 'search'); const [projectFilter, setProjectFilter] = usePageField(preferences, 'projectFilter'); const [selectedId, setSelectedId] = usePageField(preferences, 'selectedTaskId');
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const [configuration, setConfiguration] = useState<string | null>(null);
  /**
   * The stage editor's frozen target: the stage and revision the user opened it on,
   * so a background snapshot update cannot silently rebase the draft onto newer data.
   */
  const [stageEditor, setStageEditor] = useState<{ column: Column; columns: readonly Column[]; initialStageId: string; revision: number } | null>(null);
  const [actionError, setActionError] = useState<Problem | null>(null);
  const [selectionMode, setSelectionMode] = useState(false); const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [autoModePending, setAutoModePending] = useState<ReadonlySet<string>>(() => new Set());
  const autoModeInFlight = useRef(new Set<string>());
  const [dismissedTeamBanner, setDismissedTeamBanner] = usePageField(preferences, 'dismissedTeamBanner');
  const [batchConfirm, setBatchConfirm] = useState(false); const [batchTasks, setBatchTasks] = useState<Task[]>([]);
  const [drawerEntering, setDrawerEntering] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const discardRequest = useRef<((request: DestructiveRequest) => void) | undefined>(undefined);
  const restoreFocus = useRef<string | null>(null);
  const boardBody = useRef<HTMLDivElement>(null);

  const accept = useCallback((next: KanbanSnapshot) => { if (!live.current) return; const currentEpoch = latest.current?.clientEpoch ?? 0; const nextEpoch = next.clientEpoch ?? 0; if (latest.current && (nextEpoch < currentEpoch || (nextEpoch === currentEpoch && next.sequence < latest.current.sequence))) return; const normalized = normalizeSnapshot(next); latest.current = normalized; setSnapshot(normalized); }, []);
  useEffect(() => {
    let active = true; live.current = true; latest.current = null; setSnapshot(null); setLoadError(null); let unsubscribe = () => {};
    let delivered = false;
    try { unsubscribe = api.subscribe(next => { delivered = true; if (active) accept(next); }); } catch (error) { setLoadError(asProblem(error)); }
    // The subscription replays the snapshot the client already holds, so the board paints
    // immediately. This reconcile is a background safety net for a stopped live stream.
    void Promise.resolve().then(() => api.snapshot()).then(next => { if (active) accept(next); }, error => { if (active && !delivered) setLoadError(asProblem(error)); });
    return () => { active = false; live.current = false; unsubscribe(); };
  }, [api, loadAttempt, accept]);

  const [activeHubId, setActiveHubIdState] = useState<string | null>(() => readStorage(ACTIVE_HUB_KEY));
  const [activeBoardByHub, setActiveBoardByHub] = useState<Record<string, string>>(readBoardPreferences);
  const activeHub = snapshot?.state.hubs.find(hub => hub.id === activeHubId) ?? snapshot?.state.hubs[0];
  const activeBoard = activeHub ? activeHub.boards.find(board => board.id === activeBoardByHub[activeHub.id]) ?? activeHub.boards[0] : undefined;
  const [view, setView] = usePageField(preferences, 'view');
  // A board opens with the presentation the user last chose for it in this
  // browser, and falls back to the board's configured default.
  useEffect(() => {
    if (activeBoard === undefined) return;
    setView(readBoardView(activeBoard.id) ?? activeBoard.workflow.defaultView ?? 'board');
  }, [activeBoard?.id, setView]);
  const chooseView = useCallback((next: WorkflowPresentation): void => {
    setView(next);
    if (activeBoard !== undefined) writeBoardView(activeBoard.id, next);
  }, [activeBoard?.id, setView]);
  const state = useMemo(() => snapshot && activeHub && activeBoard ? boardView(activeHub, activeBoard, snapshot.state.settings ?? { revision: 0 }) : undefined, [snapshot, activeHub, activeBoard]);
  const openStageEditor = useCallback((stageId: string) => {
    if (state === undefined) return;
    const column = state.workflow.columns.find(candidate => candidate.id === stageId);
    if (column === undefined) return;
    setStageEditor({ column, columns: state.workflow.columns, initialStageId: state.workflow.initialColumnId, revision: state.revision });
  }, [state]);
  const hubActivity = useMemo(() => {
    const values = new Map<string, ScopeActivity>();
    if (!snapshot) return values;
    for (const hub of snapshot.state.hubs) values.set(hub.id, projectScopeActivity(hub.tasks, snapshot.attention));
    return values;
  }, [snapshot]);
  const boardActivity = useMemo(() => {
    const values = new Map<string, ScopeActivity>();
    if (!snapshot || !activeHub) return values;
    for (const board of activeHub.boards) values.set(board.id, projectScopeActivity(activeHub.tasks.filter(task => task.boardId === board.id), snapshot.attention));
    return values;
  }, [snapshot, activeHub]);
  // The board's own aggregated attention already answers whether anything on it is
  // unread or failed, so the header action reuses it instead of projecting again.
  const activeBoardActivity = activeBoard === undefined ? undefined : boardActivity.get(activeBoard.id);
  // Without the capability there is nothing to call, so the action is never offered.
  const canMarkAllRead = onMarkAllRead !== undefined && activeBoardActivity !== undefined && (activeBoardActivity.unread || activeBoardActivity.failed);
  const markAllRead = useCallback(() => {
    if (state === undefined || onMarkAllRead === undefined) return;
    onMarkAllRead(state.tasks.flatMap(task => task.sessionIds));
  }, [state, onMarkAllRead]);
  function selectHub(hubId: string) { if (hubId === activeHub?.id) return; setActiveHubIdState(hubId); writeStorage(ACTIVE_HUB_KEY, hubId); setSearch(''); setProjectFilter(''); setSelectedId(null); setSelectionMode(false); setSelectedIds(new Set()); }
  function selectBoard(hubId: string, boardId: string) { setActiveBoardByHub(previous => writeBoardPreference(hubId, boardId, previous)); setSearch(''); setProjectFilter(''); setSelectedId(null); setSelectionMode(false); setSelectedIds(new Set()); }
  useEffect(() => { if (snapshot && activeHub && activeHub.id !== activeHubId) { setActiveHubIdState(activeHub.id); writeStorage(ACTIVE_HUB_KEY, activeHub.id); } }, [snapshot, activeHub, activeHubId]);
  useEffect(() => { setSelectionMode(false); setSelectedIds(new Set()); }, [search, projectFilter]);
  const run = useCallback(async (command: Command, allowDiscard = true): Promise<KanbanSnapshot> => {
    const scoped = scopedCommand(command, activeHub?.id, activeBoard?.id, (snapshot?.state.hubs.length ?? 1) > 1, (activeHub?.boards.length ?? 1) > 1);
    const invokedTask = 'taskId' in scoped ? latest.current ? allTasks(latest.current).find(value => value.id === scoped.taskId) : undefined : undefined;
    const priorOperation = invokedTask?.operation;
    try { const result = await api.command(scoped); if (currentApi.current === api) accept(result); return result; }
    catch (error) {
      const advice = adviseCommandFailure({ command: scoped, problem: asProblem(error), task: invokedTask, priorOperation: priorOperation ?? undefined, allowDiscard });
      if (advice.notice) setActionError(advice.notice);
      if (advice.discard) discardRequest.current?.(advice.discard);
      throw error;
    }
  }, [api, accept, activeHub?.id, activeBoard?.id, snapshot?.state.hubs.length, activeHub?.boards.length]);

  const selected = state?.tasks.find(task => task.id === selectedId);
  const runRef = useRef(run); runRef.current = run;
  const [fallbackAutoRun] = useState(() => new AutoRunController({ run: command => runRef.current(command) }));
  const autoRun = providedAutoRun ?? fallbackAutoRun;
  useEffect(() => { if (providedAutoRun) return; return () => fallbackAutoRun.dispose(); }, [providedAutoRun, fallbackAutoRun]);
  // Owned fallback only: a provided controller is reconciled by the client generation that owns it.
  useEffect(() => { if (providedAutoRun || !snapshot) return; fallbackAutoRun.reconcile(allTasks(snapshot)); }, [providedAutoRun, snapshot, fallbackAutoRun]);
  // One memory of what became of each conversation's board model, for as long as
  // this board is mounted: it feeds the notice, never the saved document.
  const modelFallbacks = useModelFallbackRegistry();
  const preparation = useExecutionPreparation({
    api,
    run,
    ...(nativeSeat === undefined ? {} : { seat: nativeSeat }),
    ...(conversationLeases === undefined ? {} : { leases: conversationLeases }),
    onConversationCreated: (sessionId, outcome) => modelFallbacks.record(sessionId, outcome),
  });
  const moves = useBoardMoves({
    state: state ?? null,
    run,
    autoRun,
    selectionMode,
    prepare: preparation.prepare,
    onError: error => setActionError(asProblem(error)),
    onMoveStart: () => setActionError(null),
  });
  const { optimistic, drag, begin, shouldSuppressClick } = moves;
  const destructive = useDestructiveOperations({
    run: (command, allowDiscard) => run(command, allowDiscard),
    tasks: () => latest.current ? allTasks(latest.current) : [],
    closed: taskId => { if (selectedId === taskId) setSelectedId(null); },
  });
  discardRequest.current = destructive.openDiscard;
  const batch = useBatchDeletion({ run: (command, allowDiscard) => run(command, allowDiscard), onRejected: rejections => setActionError(batchRejectionProblem(rejections)) });
  useEffect(() => {
    const view = destructive.state.view;
    if (!view || destructive.state.pending) return;
    const task = state?.tasks.find(value => value.id === view.request.taskId);
    if (!task) destructive.close();
  }, [state, destructive.state.view, destructive.state.pending, destructive.close]);
  function clearCloseTimer() { if (closeTimer.current !== undefined) { clearTimeout(closeTimer.current); closeTimer.current = undefined; } }
  function finishClose() {
    restoreFocus.current = selectedId;
    clearCloseTimer(); setDrawerClosing(false); setDrawerEntering(false); setSelectedId(null);
  }
  function requestCloseDrawer() {
    if (!selectedId || drawerClosing) return;
    if (prefersReducedMotion()) { finishClose(); return; }
    setDrawerClosing(true); setDrawerEntering(false);
    clearCloseTimer();
    closeTimer.current = setTimeout(finishClose, 180);
  }
  const openTask = useCallback((taskId: string) => {
    clearCloseTimer();
    const entering = selectedIdRef.current === null && !prefersReducedMotion();
    setDrawerClosing(false); setDrawerEntering(entering); setSelectedId(taskId);
  }, [setDrawerClosing, setDrawerEntering, setSelectedId]);
  // The notice port is the only place that knows the transport; the model stays data.
  const noticeHandlers = useMemo<NoticeHandlers>(() => ({
    openTask,
    retryOperation: taskId => { void destructive.retryTask(taskId); },
    forceOperation: destructive.openForce,
    returnToProject: taskId => { void run({ type: 'operation.return', taskId }).catch(error => setActionError(asProblem(error))); },
    retryRelocation: projectId => { void run({ type: 'project.relocationRetry', projectId }).catch(error => setActionError(asProblem(error))); },
  }), [openTask, destructive.retryTask, destructive.openForce, run]);
  const noticeDismissal = useMemo<NoticeDismissalPort>(() => ({
    dismissRetained: async paths => { await run({ type: 'retainedCheckout.dismiss', paths: [...paths] }); },
    dismissFailure: () => setActionError(null),
  }), [run]);
  const retainedCheckouts = useMemo(() => snapshot?.retainedCheckouts ?? [], [snapshot]);
  const { notices, dismissAllRetained } = useBoardNotices({
    retained: retainedCheckouts,
    tasks: state?.tasks ?? EMPTY_TASKS,
    projects: state?.projects ?? EMPTY_PROJECTS,
    actionError,
    handlers: noticeHandlers,
    dismissal: noticeDismissal,
    onDismissError: error => setActionError(asProblem(error)),
  });
  const sharingView = activeHub ? snapshot?.sharing?.[activeHub.id] : undefined;
  const focusBoard = useCallback(() => boardBody.current?.focus(), []);
  // One creation instance serves both presentations: the column board renders the
  // button it returns and the diagram opens the same dialog through its port, so the
  // two New task actions cannot drift in label, enablement, or start handoff. The
  // board answers the scope questions, because only it knows the active board and Hub.
  const creation = useTaskCreation({
    state,
    projects: state === undefined ? []
      : activeBoard === undefined ? state.projects
      : creatableProjects(activeBoard, activeHub?.projects ?? state.projects),
    closedForCreation: activeBoard !== undefined && isBoardClosedForCreation(activeBoard),
    run,
    autoRun,
    onOpenTask: openTask,
    latest: () => latest.current,
    // The same memory serves both creation paths, so a task created straight into
    // an instructed stage announces its model exactly like the preparation does.
    onConversationCreated: (sessionId, outcome) => modelFallbacks.record(sessionId, outcome),
  });
  const containers = useCreationDialogs({
    activateHub: hubId => { setActiveHubIdState(hubId); writeStorage(ACTIVE_HUB_KEY, hubId); },
    selectCreatedBoard: boardId => { if (activeHub !== undefined) selectBoard(activeHub.id, boardId); },
  });
  // The open drawer's conversations are resolved before historical ones; the response is
  // a hint-only snapshot, so opening a drawer never waits for conversation history.
  useEffect(() => {
    if (!selectedId) return;
    void api.snapshot({ priorityTaskIds: [selectedId] }).catch(() => undefined);
  }, [api, selectedId]);
  useEffect(() => () => clearCloseTimer(), []);
  useEffect(() => {
    if (selectedId !== null) { restoreFocus.current = null; return; }
    const closedTaskId = restoreFocus.current;
    restoreFocus.current = null;
    if (closedTaskId) cardFocusTarget(closedTaskId)?.focus();
  }, [selectedId]);
  useEffect(() => { if (state && selectedId && !state.tasks.some(task => task.id === selectedId)) { clearCloseTimer(); setDrawerClosing(false); setDrawerEntering(false); setSelectedId(null); } }, [state, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) requestCloseDrawer(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selectedId, drawerClosing]);


  async function moveTo(task: Task, column: Column, beforeTaskId?: string | null): Promise<boolean> {
    setActionError(null);
    return moves.moveTo(task, column, beforeTaskId);
  }
  // A stable card callback keeps a memoized card from re-rendering when an
  // unrelated snapshot publishes.
  const movesRef = useRef(moves); movesRef.current = moves;
  const [advancePending, setAdvancePending] = useState<ReadonlySet<string>>(() => new Set());
  const advanceInFlight = useRef(new Set<string>());
  /** The card's next-stage action; the pending flag is keyed by task so a card
   *  reparented by its optimistic move keeps the action disabled. */
  const advanceTask = useCallback(async (task: Task, column: Column): Promise<boolean> => {
    if (advanceInFlight.current.has(task.id)) return false;
    advanceInFlight.current.add(task.id);
    setAdvancePending(new Set(advanceInFlight.current));
    setActionError(null);
    try {
      return await movesRef.current.moveTo(task, column);
    } finally {
      advanceInFlight.current.delete(task.id);
      setAdvancePending(new Set(advanceInFlight.current));
    }
  }, []);

  function requestDanger(task: Task, type: 'task.delete' | 'worktree.remove') {
    setActionError(null);
    destructive.open(task, state?.projects.find(value => value.id === task.projectId), type);
  }

  const selectedTasks = state?.tasks.filter(task => selectedIds.has(task.id)) ?? [];
  const visible = state === undefined ? [] : filterTasks(state.tasks, { search, projectFilter });
  // The filter narrows the cards of the board, so it offers the projects those cards
  // already belong to; the board's project scope governs creation instead.
  const filterProjects = useMemo(() => {
    if (state === undefined) return [] as Project[];
    const used = new Set(state.tasks.map(task => task.projectId));
    return state.projects.filter(project => used.has(project.id));
  }, [state]);
  // One projection feeds both the painted lists and the motion frame, so the order
  // the frame compares is exactly the order the board renders.
  const columnPlan = state === undefined ? [] : planColumns(state.workflow, visible, optimistic);
  const layoutKeys = cardLayoutKeys(columnPlan);
  const motionResetKey = [activeHub?.id ?? '', activeBoard?.id ?? '', search, projectFilter].join('|');

  const toggleSelect = useCallback((taskId: string) => { setSelectedIds(previous => { const next = new Set(previous); if (next.has(taskId)) next.delete(taskId); else next.add(taskId); return next; }); }, []);

  const toggleAutoMode = useCallback((taskId: string, enabled: boolean): void => {
    if (autoModeInFlight.current.has(taskId)) return;
    autoModeInFlight.current.add(taskId);
    setAutoModePending(new Set(autoModeInFlight.current));
    setActionError(null);
    void runRef.current({ type: 'task.autoMode', taskId, enabled })
      .catch(error => setActionError(asProblem(error)))
      .finally(() => {
        autoModeInFlight.current.delete(taskId);
        setAutoModePending(new Set(autoModeInFlight.current));
      });
  }, []);
  function enterSelection() { setSelectionMode(true); setSelectedIds(new Set()); setBatchTasks([]); }
  function exitSelection() { setSelectionMode(false); setSelectedIds(new Set()); setBatchTasks([]); }
  function deleteSelected() {
    if (batch.pending || batchTasks.length === 0) return;
    // Close the confirmation and leave selection mode before admission settles,
    // so the board is free while the deletions queue.
    setBatchConfirm(false);
    setActionError(null);
    exitSelection();
    batch.confirm(batchTasks);
  }

  function renderCard(task: Task, column: Column, workflow: Workflow) {
    const attention = snapshot?.attention[task.id] ?? EMPTY_ATTENTION;
    const project = state?.projects.find(value => value.id === task.projectId)?.name ?? task.projectId;
    return <BoardCard key={task.id} task={task} column={column} projectName={project} attention={attention} workflow={workflow} selectionMode={selectionMode} selected={selectedIds.has(task.id)} autoRun={autoRun} autoModePending={autoModePending.has(task.id)} onToggleAutoMode={toggleAutoMode} onOpen={openTask} onToggleSelect={toggleSelect} onBeginDrag={begin} shouldSuppressClick={shouldSuppressClick} onMoveTask={advanceTask} advancePending={advancePending.has(task.id)} onRun={moves.requestRun} />;
  }

  function onBoardPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedId) return;
    const target = event.target as Element;
    if (target.closest('.kb-drawer') || target.closest('.kb-card') || target.closest('button, input, select, textarea, a, [role="dialog"]')) return;
    requestCloseDrawer();
  }

  return <DirectoryPickerProvider picker={picker}><ModelFallbacksProvider registry={modelFallbacks}><section className="dsh-kanban" aria-label="Kanban"><style>{styles}</style>
    <BoardHeader
      hubTabs={<HubTabRow
        hubs={snapshot?.state.hubs ?? []}
        {...(activeHub ? { activeHubId: activeHub.id } : {})}
        hubActivity={hubActivity}
        onSelectHub={selectHub}
        onCreateHub={containers.openHub}
        sharing={snapshot?.sharing ?? {}}
      />}
      boardTabs={<BoardTabRow
        boards={activeHub?.boards}
        {...(activeHub ? { activeHubId: activeHub.id } : {})}
        {...(activeBoard ? { activeBoardId: activeBoard.id } : {})}
        boardActivity={boardActivity}
        onSelectBoard={selectBoard}
        onCreateBoard={containers.openBoard}
        sharing={snapshot?.sharing ?? {}}
      />}
      filterScope={(activeHub?.id ?? '') + ':' + (activeBoard?.id ?? '')}
      canMarkAllRead={canMarkAllRead}
      onMarkAllRead={markAllRead}
      selectionMode={selectionMode}
      selectedCount={selectedIds.size}
      batchPending={batch.pending}
      search={search}
      projectFilter={projectFilter}
      projects={filterProjects}
      canSelectCards={state !== undefined && state.tasks.length > 0}
      onSearch={setSearch}
      onProjectFilter={setProjectFilter}
      onEnterSelection={enterSelection}
      onOpenConfiguration={() => setConfiguration('General')}
      onRequestDelete={() => { setBatchTasks(selectedTasks); setBatchConfirm(true); }}
      onExitSelection={exitSelection}
      {...(state === undefined ? {} : { viewControl: <WorkflowViewControl view={view} onChange={chooseView} /> })}
    />
    <TeamChangesBanner
      view={sharingView}
      {...(activeHub && dismissedTeamBanner[activeHub.id] !== undefined ? { dismissedSignature: dismissedTeamBanner[activeHub.id]! } : {})}
      onReview={() => setConfiguration('Team Settings')}
      onDismiss={signature => { if (activeHub) setDismissedTeamBanner(previous => ({ ...previous, [activeHub.id]: signature })); }}
      onFocusBoard={focusBoard}
    />
    {configuration && <Configuration key={configuration} state={state ?? null} hub={activeHub ?? null} board={activeBoard ?? null} hubCount={snapshot?.state.hubs.length ?? 1} settings={snapshot?.state.settings} settingsRevision={snapshot?.state.settings?.revision ?? 0} run={run} api={api} sharing={activeHub ? snapshot?.sharing?.[activeHub.id] : undefined} sharingAuth={snapshot?.sharingAuth} conversationAttention={snapshot?.conversationAttention} scheduleRuntime={activeHub ? snapshot?.scheduleRuntime?.[activeHub.id] : undefined} {...(onOpenSession === undefined ? {} : { onOpenSession })} initial={configuration} onClose={() => setConfiguration(null)} onHubDeleted={() => { setConfiguration(null); setActiveHubIdState(null); writeStorage(ACTIVE_HUB_KEY, null); }} onBoardDeleted={() => { setConfiguration(null); }} onBoardCreated={id => { selectBoard(activeHub!.id, id); setConfiguration(null); }} />}
    <NoticeStack
      loadError={loadError}
      onRetryLoad={() => setLoadAttempt(value => value + 1)}
      notices={notices}
      {...(dismissAllRetained === undefined ? {} : { dismissAllRetained })}
      onFocusBoard={focusBoard}
    />
    <BoardEmptyStates snapshot={snapshot} loadError={loadError} hub={activeHub} board={activeBoard} onCreateHub={containers.openHub} onCreateBoard={containers.openBoard} />
    {state && <>
      <BoardBody bodyRef={boardBody} onPointerDown={onBoardPointerDown} flow={view === 'workflow'} empty={state.projects.length === 0 && view !== 'workflow' ? <ProjectsEmptyState onConfigureProjects={() => setConfiguration('Projects')} /> : null}>
        {view === 'workflow'
          ? <WorkflowDiagram
              key={activeBoard!.id}
              hubId={activeHub!.id}
              boardId={activeBoard!.id}
              state={state}
              tasks={visible}
              optimistic={optimistic}
              drag={drag}
              beginDrag={begin}
              shouldSuppressClick={shouldSuppressClick}
              run={run}
              revision={state.revision}
              onOpenTask={openTask}
              onError={error => setActionError(asProblem(error))}
              onEditStage={openStageEditor}
              // Withheld, not hidden, when nothing can own a task: the same enablement
              // the column board's action carries, decided in one place.
              onCreateTask={creation.canCreate ? creation.openDialog : undefined}
              card={{
                attention: snapshot?.attention ?? {},
                projectNames: new Map((state.projects).map(project => [project.id, project.name])),
                autoRun,
                autoModePending,
                selectionMode,
                selectedIds,
                onToggleAutoMode: toggleAutoMode,
                onToggleSelect: toggleSelect,
                advancePending,
                onAdvance: advanceTask,
                onRun: moves.requestRun,
              }}
            />
          : <BoardColumnsView plan={columnPlan} layoutKeys={layoutKeys} resetKey={motionResetKey} workflow={state.workflow} drag={drag} renderCard={renderCard} renderNewTaskButton={creation.renderButton} onEditStage={openStageEditor} />}
      </BoardBody>
      {selected && <TaskDrawer key={selected.id} task={selected} attention={snapshot?.attention[selected.id] ?? EMPTY_ATTENTION} conversationAttention={snapshot?.conversationAttention} viewState={taskPageState(preferences, selected.id)} state={state} api={api} run={run} renderConversation={renderConversation} onClose={requestCloseDrawer} onMove={moveTo} onDanger={requestDanger} onForce={destructive.openForce} onToggleAutoMode={toggleAutoMode} autoModePending={autoModePending.has(selected.id)} sessionTitles={sessionTitles} {...(conversationLeases === undefined ? {} : { conversationLeases })} entering={drawerEntering} closing={drawerClosing} autoRun={autoRun} />}
      {destructive.state.view && (() => {
        const view = destructive.state.view;
        const task = state.tasks.find(value => value.id === view.request.taskId);
        if (!task) return null;
        if (view.kind === 'force') return <ForceRemovalDialog key={'force-' + task.id} request={view.request} blockers={view.blockers} sessionTitles={sessionTitles} pending={destructive.state.pending} problem={destructive.state.error} onCancel={destructive.close} onConfirm={destructive.confirmForce} />;
        if (view.kind === 'discard') return <DiscardDialog key={'discard-' + task.id} request={view.request} run={command => {
          const current = latest.current ? allTasks(latest.current).find(value => value.id === view.request.taskId) : undefined;
          if (!current || (current.worktree?.path ?? null) !== view.request.expectedWorktreePath) return Promise.reject({ code: 'CONTEXT_CHANGED', message: 'The task worktree changed while confirmation was open. Cancel and review the current target before trying again.' });
          return run(command, false);
        }} onClose={destructive.close} onDeleted={() => setSelectedId(null)} />;
        const Dialog = view.request.command.type === 'task.delete' ? DeleteTaskDialog : RemoveWorktreeDialog;
        return <Dialog request={view.request} task={task} project={state.projects.find(value => value.id === task.projectId)} attention={snapshot?.attention[task.id] ?? EMPTY_ATTENTION} sessionTitles={sessionTitles} pending={destructive.state.pending} problem={destructive.state.error} onCancel={destructive.close} onConfirm={destructive.confirm} onRetry={destructive.retry} onReturn={destructive.returnToBase} onForce={() => destructive.openForce(task.id)} />;
      })()}
      {batchConfirm && <BulkDeleteDialog tasks={batchTasks} attention={snapshot?.attention ?? {}} onCancel={() => setBatchConfirm(false)} onConfirm={deleteSelected} />}
    </>}
    {stageEditor !== null && <StageEditorDialog
      hubId={activeHub!.id}
      boardId={activeBoard!.id}
      revision={stageEditor.revision}
      initialStageId={stageEditor.initialStageId}
      column={stageEditor.column}
      columns={stageEditor.columns}
      tasks={state?.tasks ?? []}
      attention={snapshot?.attention ?? {}}
      run={run}
      onClose={() => setStageEditor(null)}
      onSaved={() => setStageEditor(null)}
    />}
    <BoardCreationDialogs hub={activeHub} run={run} taskDialog={creation.dialog} containers={containers} />
    {moves.overrideDialog && <div hidden={preparation.dialog !== null}>{moves.overrideDialog}</div>}
    {preparation.dialog}
  </section></ModelFallbacksProvider></DirectoryPickerProvider>;
}
