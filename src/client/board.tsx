import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Board, ClientApi, Column, ColumnGroup, Command, KanbanSnapshot, Problem, Task, Workflow } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import { NewTaskDialog } from './forms.js';
import { Configuration } from './settings/configuration.js';
import { DirectoryPickerProvider } from './services.js';
import type { DirectoryPickerPort } from './directory-picker.js';
import { TaskDrawer } from './drawer.js';
import type { SessionTitles } from './conversation-label.js';
import type { ConversationLeaseEnvironment } from './conversation-leases.js';
import type { ConversationLineagePort, DrawerSubagentAddress } from './conversation-navigation.js';
import { transitionAccess } from '../domain/transitions.js';
import { entryInstruction, hasUnresolvedEntry } from '../domain/stage-entry.js';
import { AutoRunController } from './auto-run.js';
import { autoModeView } from './auto-mode.js';
import { ACTIVE_HUB_KEY, allTasks, boardView, normalizeSnapshot, readBoardPreferences, readStorage, scopedCommand, writeBoardPreference, writeStorage } from './hub-view.js';
import { projectScopeActivity, type ScopeActivity } from './scope-activity.js';
import { HubNav } from './hub-nav.js';
import { CreateBoardDialog, CreateHubDialog } from './create-dialogs.js';
import { asProblem } from './ui.js';
import { adviseCommandFailure } from './command-failure.js';
import { BoardNotices } from './board-notices.js';
import { styles } from './styles.js';
import { DeleteTaskDialog, DiscardDialog, RemoveWorktreeDialog, type DestructiveRequest } from './destructive-dialogs.js';
import { BulkDeleteDialog, BulkResultDialog, type BulkDeletionResult, type BulkProgress } from './bulk-delete-dialogs.js';
import { ForceRemovalDialog } from './force-removal-dialog.js';
import { useDestructiveOperations } from './destructive-operations.js';
import { DestructiveOperationsNotice } from './destructive-notices.js';
import { CheckSquareIcon, PlusIcon, SettingsIcon, TrashIcon } from './icons.js';
import { useCardDrag } from './useCardDrag.js';
import { TaskCard } from './task-card.js';
import { useMoveRequest } from './useMoveRequest.js';
import { TransitionOverrideDialog } from './transition-override-dialog.js';
import { createBoardPageState, taskPageState, usePageField, type BoardPageState } from './page-state.js';
export { createBoardPageState } from './page-state.js';
export type { BoardPageState } from './page-state.js';

export interface BoardViewProps {
  api: ClientApi;
  renderConversation: (id: string, target?: DrawerSubagentAddress) => ReactNode;
  pageState?: BoardPageState;
  sessionTitles?: SessionTitles;
  /** Lease scope owned by each mounted task drawer; absent only in isolated render harnesses. */
  conversationLeases?: ConversationLeaseEnvironment;
  picker?: DirectoryPickerPort | null;
  /** Owned by its provider, which also reconciles it; the board reconciles only its own fallback. */
  autoRun?: AutoRunController;
  lineage?: ConversationLineagePort;
}

export function columnLayout(workflow: Workflow): Array<{ key: string; group?: ColumnGroup; columns: Column[] }> {
  const result: Array<{ key: string; group?: ColumnGroup; columns: Column[] }> = []; const seen = new Set<string>();
  for (const column of workflow.columns) {
    if (seen.has(column.id)) continue;
    const group = workflow.groups.find(value => value.columnIds.includes(column.id));
    const columns = group ? group.columnIds.map(id => workflow.columns.find(value => value.id === id)).filter((value): value is Column => Boolean(value) && !seen.has(value!.id)) : [column];
    const unique = columns.filter((value, index) => columns.findIndex(item => item.id === value.id) === index);
    unique.forEach(value => seen.add(value.id)); result.push({ key: group ? 'group-' + group.id : 'column-' + column.id, ...(group ? { group } : {}), columns: unique });
  }
  return result;
}

export function BoardView({ api, renderConversation, pageState, sessionTitles, conversationLeases, picker = null, autoRun: providedAutoRun, lineage }: BoardViewProps) {
  const [localPageState] = useState(createBoardPageState); const preferences = pageState ?? localPageState;
  const [snapshot, setSnapshot] = useState<KanbanSnapshot | null>(null); const latest = useRef<KanbanSnapshot | null>(null); const live = useRef(false); const currentApi = useRef(api); currentApi.current = api;
  const [loadError, setLoadError] = useState<Problem | null>(null); const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = usePageField(preferences, 'search'); const [projectFilter, setProjectFilter] = usePageField(preferences, 'projectFilter'); const [selectedId, setSelectedId] = usePageField(preferences, 'selectedTaskId');
  const [newTask, setNewTask] = useState(false); const [newHub, setNewHub] = useState(false); const [newBoard, setNewBoard] = useState(false); const [configuration, setConfiguration] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Problem | null>(null);
  const [selectionMode, setSelectionMode] = useState(false); const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [autoModePending, setAutoModePending] = useState<ReadonlySet<string>>(() => new Set());
  const autoModeInFlight = useRef(new Set<string>());
  const [retainedCheckout, setRetainedCheckout] = useState<string | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false); const [batchPending, setBatchPending] = useState(false); const [batchTasks, setBatchTasks] = useState<Task[]>([]); const [batchProgress, setBatchProgress] = useState<BulkProgress | null>(null); const [batchResult, setBatchResult] = useState<BulkDeletionResult | null>(null);
  const [drawerEntering, setDrawerEntering] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const discardRequest = useRef<((request: DestructiveRequest) => void) | undefined>(undefined);
  const restoreFocus = useRef<string | null>(null);
  const boardBody = useRef<HTMLDivElement>(null);

  const accept = useCallback((next: KanbanSnapshot) => { if (!live.current) return; const currentEpoch = latest.current?.clientEpoch ?? 0; const nextEpoch = next.clientEpoch ?? 0; if (latest.current && (nextEpoch < currentEpoch || (nextEpoch === currentEpoch && next.sequence < latest.current.sequence))) return; const normalized = normalizeSnapshot(next); latest.current = normalized; setSnapshot(normalized); }, []);
  useEffect(() => {
    let active = true; live.current = true; latest.current = null; setSnapshot(null); setLoadError(null); let unsubscribe = () => {};
    try { unsubscribe = api.subscribe(next => { if (active) accept(next); }); } catch (error) { setLoadError(asProblem(error)); }
    void Promise.resolve().then(() => api.snapshot()).then(next => { if (active) accept(next); }, error => { if (active) setLoadError(asProblem(error)); });
    return () => { active = false; live.current = false; unsubscribe(); };
  }, [api, loadAttempt, accept]);

  const [activeHubId, setActiveHubIdState] = useState<string | null>(() => readStorage(ACTIVE_HUB_KEY));
  const [activeBoardByHub, setActiveBoardByHub] = useState<Record<string, string>>(readBoardPreferences);
  const activeHub = snapshot?.state.hubs.find(hub => hub.id === activeHubId) ?? snapshot?.state.hubs[0];
  const activeBoard = activeHub ? activeHub.boards.find(board => board.id === activeBoardByHub[activeHub.id]) ?? activeHub.boards[0] : undefined;
  const state = useMemo(() => snapshot && activeHub && activeBoard ? boardView(activeHub, activeBoard, snapshot.state.settings ?? { revision: 0 }) : undefined, [snapshot, activeHub, activeBoard]);
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
  function armAfterMove(result: KanbanSnapshot, task: Task, column: Column): void {
    if (task.columnId === column.id) return;
    const normalized = normalizeSnapshot(result);
    const moved = normalized.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === task.id);
    const movedBoard = moved ? normalized.state.hubs.flatMap(hub => hub.boards).find(value => value.id === moved.boardId) : undefined;
    const destination = movedBoard?.workflow.columns.find(value => value.id === column.id);
    const instruction = entryInstruction(destination);
    if (moved && destination && instruction !== undefined && hasUnresolvedEntry(moved, destination.id)) {
      autoRun.arm({ taskId: moved.id, columnId: destination.id, enteredAt: moved.instructionPending!.enteredAt, instruction });
    }
  }
  const moveRequest = useMoveRequest({ state: state ?? null, run, onImmediateError: error => setActionError(asProblem(error)), onMoved: armAfterMove });
  const { optimistic, confirmation, pending: movePending, error: moveError, canRetry, confirm: confirmMove, cancel: cancelMove } = moveRequest;
  const destructive = useDestructiveOperations({
    run: (command, allowDiscard) => run(command, allowDiscard),
    tasks: () => latest.current ? allTasks(latest.current) : [],
    retained: setRetainedCheckout,
    closed: taskId => { if (selectedId === taskId) setSelectedId(null); },
  });
  discardRequest.current = destructive.openDiscard;
  useEffect(() => { destructive.reconcile(state?.tasks ?? []); }, [state?.tasks, destructive.reconcile]);
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
  function prefersReducedMotion(): boolean { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function requestCloseDrawer() {
    if (!selectedId || drawerClosing) return;
    if (prefersReducedMotion()) { finishClose(); return; }
    setDrawerClosing(true); setDrawerEntering(false);
    clearCloseTimer();
    closeTimer.current = setTimeout(finishClose, 180);
  }
  function openTask(taskId: string) {
    clearCloseTimer();
    const entering = selectedId === null && !prefersReducedMotion();
    setDrawerClosing(false); setDrawerEntering(entering); setSelectedId(taskId);
  }
  useEffect(() => () => clearCloseTimer(), []);
  useEffect(() => {
    if (selectedId !== null) { restoreFocus.current = null; return; }
    const closedTaskId = restoreFocus.current;
    restoreFocus.current = null;
    if (closedTaskId) document.querySelector<HTMLElement>('[data-task-id="' + closedTaskId + '"] .kb-card-open')?.focus();
  }, [selectedId]);
  useEffect(() => { if (state && selectedId && !state.tasks.some(task => task.id === selectedId)) { clearCloseTimer(); setDrawerClosing(false); setDrawerEntering(false); setSelectedId(null); } }, [state, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) requestCloseDrawer(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selectedId, drawerClosing]);


  function canDrop(columnId: string, taskId: string): boolean {
    if (!state || selectionMode) return false;
    const task = state.tasks.find(value => value.id === taskId);
    const column = state.workflow.columns.find(value => value.id === columnId);
    return Boolean(task && column && !task.operation && !task.pendingTransition);
  }

  async function moveTo(task: Task, column: Column, beforeTaskId: string | null = null): Promise<boolean> {
    setActionError(null);
    return moveRequest.move(task, column, beforeTaskId);
  }

  const { drag, begin, shouldSuppressClick } = useCardDrag({ enabled: Boolean(state) && !selectionMode, canDrop, onDrop: (taskId, columnId, beforeTaskId) => {
    const task = latest.current ? allTasks(latest.current).find(value => value.id === taskId) : undefined;
    const column = state?.workflow.columns.find(value => value.id === columnId);
    if (task && column) void moveTo(task, column, beforeTaskId);
  }});

  function requestDanger(task: Task, type: 'task.delete' | 'worktree.remove') {
    setActionError(null);
    destructive.open(task, state?.projects.find(value => value.id === task.projectId), type);
  }

  const selectedTasks = state?.tasks.filter(task => selectedIds.has(task.id)) ?? [];
  const visible = state?.tasks.filter(task => (!projectFilter || task.projectId === projectFilter) && (task.title + ' ' + task.description).toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)) ?? [];
  function tasksForColumn(columnId: string): Task[] {
    const source = optimistic ? visible.filter(task => task.id !== optimistic.taskId) : visible;
    const base = source.filter(task => task.columnId === columnId);
    if (!optimistic || optimistic.columnId !== columnId) return base;
    const moving = visible.find(task => task.id === optimistic.taskId);
    if (!moving) return base;
    const next = [...base];
    const index = optimistic.beforeTaskId ? next.findIndex(task => task.id === optimistic.beforeTaskId) : -1;
    next.splice(index >= 0 ? index : next.length, 0, moving);
    return next;
  }

  function toggleSelect(taskId: string) { setSelectedIds(previous => { const next = new Set(previous); if (next.has(taskId)) next.delete(taskId); else next.add(taskId); return next; }); }

  function toggleAutoMode(taskId: string, enabled: boolean): void {
    if (autoModeInFlight.current.has(taskId)) return;
    autoModeInFlight.current.add(taskId);
    setAutoModePending(new Set(autoModeInFlight.current));
    setActionError(null);
    void run({ type: 'task.autoMode', taskId, enabled })
      .catch(error => setActionError(asProblem(error)))
      .finally(() => {
        autoModeInFlight.current.delete(taskId);
        setAutoModePending(new Set(autoModeInFlight.current));
      });
  }
  function enterSelection() { setSelectionMode(true); setSelectedIds(new Set()); setBatchResult(null); setBatchTasks([]); setBatchProgress(null); }
  function exitSelection() { setSelectionMode(false); setSelectedIds(new Set()); setBatchTasks([]); setBatchProgress(null); }

  async function deleteSelected() {
    if (batchPending) return;
    const tasks = latest.current ? allTasks(latest.current) : [];
    const total = batchTasks.length || selectedIds.size;
    const skipped: Array<{ title: string; message: string }> = []; let queued = 0; let current = 0;
    setBatchPending(true); setActionError(null); setBatchProgress(null);
    for (const taskId of [...selectedIds]) {
      current += 1;
      const task = tasks.find(value => value.id === taskId);
      if (!task) { setSelectedIds(previous => { const next = new Set(previous); next.delete(taskId); return next; }); continue; }
      setBatchProgress({ current, total, title: task.title });
      try {
        await run({ type: 'task.delete', taskId, confirmed: true, expectedWorktreePath: task.worktree?.path ?? null, requireIdle: true }, false);
        queued += 1;
        setSelectedIds(previous => { const next = new Set(previous); next.delete(taskId); return next; });
      } catch (error) {
        skipped.push({ title: task.title, message: asProblem(error).message });
      }
    }
    setBatchPending(false); setBatchProgress(null); setBatchConfirm(false);
    setBatchResult({ queued, skipped });
    if (skipped.length === 0) exitSelection();
  }

  function renderCard(task: Task, column: Column, workflow: Workflow) {
    const attention = snapshot?.attention[task.id] ?? EMPTY_ATTENTION;
    const project = state?.projects.find(value => value.id === task.projectId)?.name ?? task.projectId;
    return <TaskCard key={task.id} task={task} column={column} projectName={project} attention={attention} selectionMode={selectionMode} selected={selectedIds.has(task.id)} autoRun={autoRun} autoMode={autoModeView(task, workflow, attention.pending)} autoModePending={autoModePending.has(task.id)} onToggleAutoMode={toggleAutoMode} onOpen={openTask} onToggleSelect={toggleSelect} onBeginDrag={begin} shouldSuppressClick={shouldSuppressClick} />;
  }

  function renderNewTaskButton(column: Column) { return <div className="kb-column-create"><button type="button" className="kb-button kb-primary" disabled={!state || state.projects.length === 0} onClick={() => setNewTask(true)} aria-label="New task"><PlusIcon size={14} /> New task</button></div>; }

  function onBoardPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedId) return;
    const target = event.target as Element;
    if (target.closest('.kb-drawer') || target.closest('.kb-card') || target.closest('button, input, select, textarea, a, [role="dialog"]')) return;
    requestCloseDrawer();
  }

  return <DirectoryPickerProvider picker={picker}><section className="dsh-kanban" aria-label="Kanban"><style>{styles}</style><header className="kb-header">
    <div className="kb-heading"><div><h1>Kanban</h1><p className="kb-hint">Hubs, boards, and workflows</p></div><div className="kb-toolbar">
    {!selectionMode ? <>
      <label className="kb-field kb-search"><span className="kb-sr">Search tasks</span><input className="kb-input" type="search" aria-label="Search tasks" placeholder="Search title or description" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="kb-field"><span className="kb-sr">Project filter</span><select className="kb-input" aria-label="Project filter" value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="">All projects</option>{state?.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      <button type="button" className="kb-button kb-icon-button" disabled={!state || state.tasks.length === 0} aria-label="Select cards to delete" title="Select cards to delete" onClick={enterSelection}><CheckSquareIcon size={16} /></button>
      <button type="button" className="kb-button kb-icon-button" disabled={!snapshot} aria-label="Configuration" title="Configuration" onClick={() => setConfiguration('General')}><SettingsIcon size={16} /></button>
    </> : <>
      <span className="kb-selection-count" role="status">{selectedIds.size} selected</span>
      <button type="button" className="kb-button kb-danger" disabled={selectedIds.size === 0 || batchPending} onClick={() => { setBatchTasks(selectedTasks); setBatchProgress(null); setBatchConfirm(true); }}><TrashIcon size={14} /> Delete {selectedIds.size || ''}</button>
      <button type="button" className="kb-button" disabled={batchPending} onClick={exitSelection}>Cancel</button>
    </>}
  </div></div>
    <HubNav
      hubs={snapshot?.state.hubs ?? []}
      boards={activeHub?.boards}
      {...(activeHub ? { activeHubId: activeHub.id } : {})}
      {...(activeBoard ? { activeBoardId: activeBoard.id } : {})}
      hubActivity={hubActivity}
      boardActivity={boardActivity}
      onSelectHub={selectHub}
      onSelectBoard={selectBoard}
      onCreateHub={() => setNewHub(true)}
      onCreateBoard={() => setNewBoard(true)}
    />
  </header>
    {configuration && <Configuration key={configuration} state={state ?? null} hub={activeHub ?? null} board={activeBoard ?? null} hubCount={snapshot?.state.hubs.length ?? 1} settings={snapshot?.state.settings} settingsRevision={snapshot?.state.settings?.revision ?? 0} run={run} api={api} initial={configuration} onClose={() => setConfiguration(null)} onHubDeleted={() => { setConfiguration(null); setActiveHubIdState(null); writeStorage(ACTIVE_HUB_KEY, null); }} onBoardDeleted={() => { setConfiguration(null); }} onBoardCreated={id => { selectBoard(activeHub!.id, id); setConfiguration(null); }} />}
    <BoardNotices loadError={loadError} actionError={actionError} onRetryLoad={() => setLoadAttempt(value => value + 1)} />{state && <DestructiveOperationsNotice tasks={state.tasks} retained={retainedCheckout} onDismissRetained={() => setRetainedCheckout(null)} onOpen={openTask} onRetry={taskId => void destructive.retryTask(taskId)} onForce={destructive.openForce} onReturn={taskId => { void run({ type: 'operation.return', taskId }).catch(error => setActionError(asProblem(error))); }} />}{!snapshot && !loadError && <p className="kb-empty" role="status">Loading Kanban…</p>}{snapshot && !activeHub && <div className="kb-empty"><h2>No Hub available</h2><p>Create a Hub to continue.</p><button type="button" className="kb-button kb-primary" onClick={() => setNewHub(true)}>Create Hub</button></div>}{snapshot && activeHub && !activeBoard && <div className="kb-empty"><h2>Create your first board</h2><p>Boards hold a workflow and their tasks inside this Hub.</p><button type="button" className="kb-button kb-primary" onClick={() => setNewBoard(true)}>Create board</button></div>}
    {state && <><div className="kb-page-body" ref={boardBody} onPointerDown={onBoardPointerDown}>{state.projects.length === 0 && <div className="kb-empty"><h2>Add your first project</h2><p>Register a project folder, and its Git root when it is a repository, to create tasks.</p><button type="button" className="kb-button kb-primary" onClick={() => setConfiguration('Projects')}>Configure projects</button></div>}
      <div className="kb-columns" aria-label="Workflow columns">{columnLayout(state.workflow).map(slot => <section key={slot.key} className={'kb-column-slot ' + (slot.group ? 'kb-column-group' : '')} aria-label={slot.group?.name}>{slot.group && <h2 className="kb-group-heading">{slot.group.name}</h2>}{slot.columns.map(column => { const tasks = tasksForColumn(column.id); const restricted = Boolean(drag && drag.overColumnId === column.id && transitionAccess(state.workflow, drag.sourceColumnId, column.id) === 'restricted');
        return <section className={'kb-column' + (restricted ? ' kb-drop-restricted' : '')} key={column.id} aria-label={column.name + ' column'} data-column-id={column.id}><header className="kb-column-header"><h2>{column.name}</h2><span aria-label={tasks.length + ' tasks'}>{tasks.length}</span></header>{column.id === state.workflow.initialColumnId && renderNewTaskButton(column)}<div className="kb-card-list">{tasks.map(task => renderCard(task, column, state.workflow))}{drag?.overColumnId === column.id && <div className={'kb-drop-indicator' + (restricted ? ' kb-drop-indicator-restricted' : '')} style={{ top: drag.indicatorY }} aria-hidden="true" />}{tasks.length === 0 && <p className="kb-empty-column">No matching tasks</p>}</div></section>; })}</section>)}</div></div>
      {selected && <TaskDrawer key={selected.id} task={selected} attention={snapshot?.attention[selected.id] ?? EMPTY_ATTENTION} conversationAttention={snapshot?.conversationAttention} viewState={taskPageState(preferences, selected.id)} state={state} api={api} run={run} renderConversation={renderConversation} onClose={requestCloseDrawer} onMove={moveTo} onDanger={requestDanger} onForce={destructive.openForce} onToggleAutoMode={toggleAutoMode} autoModePending={autoModePending.has(selected.id)} sessionTitles={sessionTitles} {...(conversationLeases === undefined ? {} : { conversationLeases })} entering={drawerEntering} closing={drawerClosing} autoRun={autoRun} lineage={lineage} />}

    {newTask && state && <NewTaskDialog state={state} run={run} onClose={() => setNewTask(false)} onCreated={openTask} />}
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
    {batchConfirm && <BulkDeleteDialog tasks={batchTasks} attention={snapshot?.attention ?? {}} pending={batchPending} progress={batchProgress} onCancel={() => { if (!batchPending) setBatchConfirm(false); }} onConfirm={() => void deleteSelected()} />}
    {batchResult && <BulkResultDialog result={batchResult} onClose={() => setBatchResult(null)} />}
    </>}
    {newHub && <CreateHubDialog run={run} onClose={() => setNewHub(false)} onCreated={id => { setActiveHubIdState(id); writeStorage(ACTIVE_HUB_KEY, id); setNewHub(false); }} />}
    {newBoard && activeHub && <CreateBoardDialog hubId={activeHub.id} run={run} onClose={() => setNewBoard(false)} onCreated={id => { selectBoard(activeHub.id, id); setNewBoard(false); }} />}
    {confirmation && <TransitionOverrideDialog taskTitle={confirmation.taskTitle} workflowName={confirmation.workflowName} sourceName={confirmation.fromName} destinationName={confirmation.toName} pending={movePending} problem={moveError} canRetry={canRetry} onCancel={cancelMove} onConfirm={() => void confirmMove()} />}
  </section></DirectoryPickerProvider>;
}
