import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Board, ClientApi, Column, ColumnGroup, Command, HubState, KanbanSnapshot, Problem, Task, Workflow } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import { Configuration, NewTaskDialog } from './forms.js';
import { TaskDrawer, type SessionTitles } from './drawer.js';
import type { ConversationLineagePort, DrawerSubagentAddress } from './conversation-navigation.js';
import { TaskActivity } from './activity.js';
import { transitionAccess } from '../domain/transitions.js';
import { entryInstruction, hasUnresolvedEntry } from '../domain/stage-entry.js';
import { AutoRunController } from './auto-run.js';
import { CardInstructionAction } from './auto-run-view.js';
import { ACTIVE_HUB_KEY, allTasks, boardView, normalizeSnapshot, readBoardPreferences, readStorage, scopeAttention, scopedCommand, writeBoardPreference, writeStorage } from './hub-view.js';
import { CreateBoardDialog, CreateHubDialog } from './create-dialogs.js';
import { asProblem, ErrorNotice, type RunCommand } from './ui.js';
import { styles } from './styles.js';
import { BulkDeleteDialog, BulkResultDialog, DeleteTaskDialog, DiscardDialog, type BulkDeletionResult, type BulkProgress, type DestructiveCommand, type DestructiveRequest } from './destructive-dialogs.js';
import { CheckSquareIcon, PlusIcon, SettingsIcon, TrashIcon } from './icons.js';
import { useCardDrag } from './useCardDrag.js';
import { useMoveRequest } from './useMoveRequest.js';
import { TransitionOverrideDialog } from './transition-override-dialog.js';
import { createBoardPageState, taskPageState, usePageField, type BoardPageState } from './page-state.js';
export { createBoardPageState } from './page-state.js';
export type { BoardPageState } from './page-state.js';

export interface BoardViewProps { api: ClientApi; renderConversation: (id: string, target?: DrawerSubagentAddress) => ReactNode; pageState?: BoardPageState; sessionTitles?: SessionTitles; pickDirectory?: () => Promise<string | null>; autoRun?: AutoRunController; onRunReady?: (run: RunCommand) => void; lineage?: ConversationLineagePort }

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

export function BoardView({ api, renderConversation, pageState, sessionTitles, pickDirectory, autoRun: providedAutoRun, onRunReady, lineage }: BoardViewProps) {
  const [localPageState] = useState(createBoardPageState); const preferences = pageState ?? localPageState;
  const [snapshot, setSnapshot] = useState<KanbanSnapshot | null>(null); const latest = useRef<KanbanSnapshot | null>(null); const live = useRef(false); const currentApi = useRef(api); currentApi.current = api;
  const [loadError, setLoadError] = useState<Problem | null>(null); const [loadAttempt, setLoadAttempt] = useState(0); const [pending, setPending] = useState(0);
  const [search, setSearch] = usePageField(preferences, 'search'); const [projectFilter, setProjectFilter] = usePageField(preferences, 'projectFilter'); const [selectedId, setSelectedId] = usePageField(preferences, 'selectedTaskId');
  const [newTask, setNewTask] = useState(false); const [newHub, setNewHub] = useState(false); const [newBoard, setNewBoard] = useState(false); const [configuration, setConfiguration] = useState<string | null>(null);
  const [destruction, setDestruction] = useState<DestructiveRequest | null>(null); const [destructionStarted, setDestructionStarted] = useState(false); const [discard, setDiscard] = useState<DestructiveRequest | null>(null); const [destructionError, setDestructionError] = useState<Problem | null>(null); const [destructionPending, setDestructionPending] = useState(false); const [actionError, setActionError] = useState<Problem | null>(null);
  const [selectionMode, setSelectionMode] = useState(false); const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchConfirm, setBatchConfirm] = useState(false); const [batchPending, setBatchPending] = useState(false); const [batchTasks, setBatchTasks] = useState<Task[]>([]); const [batchProgress, setBatchProgress] = useState<BulkProgress | null>(null); const [batchResult, setBatchResult] = useState<BulkDeletionResult | null>(null);
  const [drawerEntering, setDrawerEntering] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
  function attentionForHub(hub: HubState) { return snapshot ? scopeAttention(hub.tasks, snapshot.attention) : { unread: false, running: false, failed: false }; }
  function attentionForBoard(hub: HubState, boardId: string) { return snapshot ? scopeAttention(hub.tasks.filter(task => task.boardId === boardId), snapshot.attention) : { unread: false, running: false, failed: false }; }
  function selectHub(hubId: string) { if (hubId === activeHub?.id) return; setActiveHubIdState(hubId); writeStorage(ACTIVE_HUB_KEY, hubId); setSearch(''); setProjectFilter(''); setSelectedId(null); setSelectionMode(false); setSelectedIds(new Set()); }
  function selectBoard(hubId: string, boardId: string) { setActiveBoardByHub(previous => writeBoardPreference(hubId, boardId, previous)); setSearch(''); setProjectFilter(''); setSelectedId(null); setSelectionMode(false); setSelectedIds(new Set()); }
  useEffect(() => { if (snapshot && activeHub && activeHub.id !== activeHubId) { setActiveHubIdState(activeHub.id); writeStorage(ACTIVE_HUB_KEY, activeHub.id); } }, [snapshot, activeHub, activeHubId]);
  useEffect(() => { setSelectionMode(false); setSelectedIds(new Set()); }, [search, projectFilter]);
  const run = useCallback(async (command: Command, allowDiscard = true): Promise<KanbanSnapshot> => {
    setPending(value => value + 1);
    const scoped = scopedCommand(command, activeHub?.id, activeBoard?.id, (snapshot?.state.hubs.length ?? 1) > 1, (activeHub?.boards.length ?? 1) > 1);
    const invokedTask = 'taskId' in scoped ? latest.current ? allTasks(latest.current).find(value => value.id === scoped.taskId) : undefined : undefined;
    const priorOperation = invokedTask?.operation;
    try { const result = await api.command(scoped); if (currentApi.current === api) accept(result); return result; }
    catch (error) {
      const problem = asProblem(error); const task = invokedTask;
      let original: DestructiveCommand | undefined;
      if ((scoped.type === 'task.delete' || scoped.type === 'worktree.remove') && !scoped.discardChanges) original = scoped;
      else if (scoped.type === 'operation.retry' && task && priorOperation && (priorOperation.request.kind === 'remove' || priorOperation.request.kind === 'delete') && !priorOperation.request.discardChanges) {
        const capturedPath = priorOperation.request.expectedWorktreePath !== undefined ? priorOperation.request.expectedWorktreePath : priorOperation.targetPath;
        if (capturedPath !== undefined) original = { type: priorOperation.request.kind === 'delete' ? 'task.delete' : 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: capturedPath };
        else setActionError({ code: 'CONFIRMATION_REQUIRED', message: 'The original removal target is unavailable. Return to base and review a new removal confirmation.' });
      }
      if (allowDiscard && problem.code === 'DISCARD_REQUIRED' && original && task) setDiscard({ command: original, taskId: task.id, title: task.title, path: original.expectedWorktreePath ?? task.worktree?.path ?? null, expectedWorktreePath: original.expectedWorktreePath ?? task.worktree?.path ?? null, branch: task.worktree?.branch ?? null, owned: task.worktree?.owned, error: problem });
      throw error;
    } finally { if (live.current) setPending(value => Math.max(0, value - 1)); }
  }, [api, accept, activeHub?.id, activeBoard?.id, snapshot?.state.hubs.length, activeHub?.boards.length]);

  const selected = state?.tasks.find(task => task.id === selectedId);
  const runRef = useRef(run); runRef.current = run;
  const [fallbackAutoRun] = useState(() => new AutoRunController({ run: command => runRef.current(command) }));
  const autoRun = providedAutoRun ?? fallbackAutoRun;
  useEffect(() => { onRunReady?.(run); }, [onRunReady, run]);
  useEffect(() => { if (providedAutoRun) return; return () => fallbackAutoRun.dispose(); }, [providedAutoRun, fallbackAutoRun]);
  useEffect(() => { if (state) autoRun.reconcile(state.tasks); }, [state, autoRun]);
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
  useEffect(() => {
    if (!destruction) return;
    const task = state?.tasks.find(value => value.id === destruction.taskId);
    if (!task) {
      setDestruction(null); setDestructionError(null); setDestructionStarted(false);
      if (destruction.command.type === 'task.delete') setSelectedId(null);
      return;
    }
    if (destructionStarted && !task.operation) {
      setDestruction(null); setDestructionError(null); setDestructionStarted(false);
    }
  }, [state, destruction, destructionStarted]);
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
    setActionError(null); setDestructionError(null); setDestructionStarted(false);
    setDestruction({
      command: { type, taskId: task.id, confirmed: true, expectedWorktreePath: task.worktree?.path ?? null },
      taskId: task.id, title: task.title, path: task.worktree?.path ?? null,
      expectedWorktreePath: task.worktree?.path ?? null,
      branch: task.worktree?.branch ?? null, owned: task.worktree?.owned,
    });
  }
  function runDestruction(request: DestructiveRequest, command: Command = request.command) {
    const task = latest.current ? allTasks(latest.current).find(value => value.id === request.command.taskId) : undefined;
    if (!task || (task.worktree?.path ?? null) !== request.expectedWorktreePath) return Promise.reject({ code: 'CONTEXT_CHANGED', message: 'The task worktree changed while confirmation was open. Cancel and review the current target before trying again.' });
    return run(command);
  }
  async function confirmDestruction() {
    if (!destruction || destructionPending) return;
    const request = destruction;
    setDestructionPending(true); setDestructionError(null);
    try {
      const result = await runDestruction(request);
      const normalizedResult = normalizeSnapshot(result); const current = normalizedResult.state.hubs.flatMap(hub => hub.tasks).find(task => task.id === request.taskId);
      if (current?.operation) { setDestructionStarted(true); return; }
      setDestruction(null);
      if (!current && request.command.type === 'task.delete') setSelectedId(null);
    } catch (error) {
      const problem = asProblem(error);
      if (problem.code === 'DISCARD_REQUIRED') { setDestruction(null); setDestructionStarted(false); setDiscard({ ...request, error: problem }); }
      else setDestructionError(problem);
    } finally { setDestructionPending(false); }
  }
  async function retryDestruction() {
    if (!destruction || destructionPending) return;
    const request = destruction;
    setDestructionPending(true); setDestructionError(null);
    try {
      const result = await run({ type: 'operation.retry', taskId: request.taskId });
      const normalizedResult = normalizeSnapshot(result); const current = normalizedResult.state.hubs.flatMap(hub => hub.tasks).find(task => task.id === request.taskId);
      if (current?.operation) { setDestructionStarted(true); return; }
      setDestruction(null);
      if (!current && request.command.type === 'task.delete') setSelectedId(null);
    } catch (error) {
      const problem = asProblem(error);
      if (problem.code === 'DISCARD_REQUIRED') { setDestruction(null); setDestructionStarted(false); setDiscard({ ...request, error: problem }); }
      else setDestructionError(problem);
    } finally { setDestructionPending(false); }
  }
  async function returnDestruction() {
    if (!destruction || destructionPending) return;
    const request = destruction;
    setDestructionPending(true); setDestructionError(null);
    try {
      const result = await run({ type: 'operation.return', taskId: request.taskId });
      const normalizedResult = normalizeSnapshot(result); const current = normalizedResult.state.hubs.flatMap(hub => hub.tasks).find(task => task.id === request.taskId);
      if (current?.operation) { setDestructionStarted(true); return; }
      setDestruction(null);
      if (!current && request.command.type === 'task.delete') setSelectedId(null);
    }
    catch (error) { setDestructionError(asProblem(error)); }
    finally { setDestructionPending(false); }
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
  function enterSelection() { setSelectionMode(true); setSelectedIds(new Set()); setBatchResult(null); setBatchTasks([]); setBatchProgress(null); }
  function exitSelection() { setSelectionMode(false); setSelectedIds(new Set()); setBatchTasks([]); setBatchProgress(null); }

  async function deleteSelected() {
    if (batchPending) return;
    const tasks = latest.current ? allTasks(latest.current) : [];
    const total = batchTasks.length || selectedIds.size;
    const skipped: Array<{ title: string; message: string }> = []; let deleted = 0; let current = 0;
    setBatchPending(true); setActionError(null); setBatchProgress(null);
    for (const taskId of [...selectedIds]) {
      current += 1;
      const task = tasks.find(value => value.id === taskId);
      if (!task) { setSelectedIds(previous => { const next = new Set(previous); next.delete(taskId); return next; }); continue; }
      setBatchProgress({ current, total, title: task.title });
      try {
        await run({ type: 'task.delete', taskId, confirmed: true, expectedWorktreePath: task.worktree?.path ?? null, requireIdle: true }, false);
        deleted += 1;
        setSelectedIds(previous => { const next = new Set(previous); next.delete(taskId); return next; });
      } catch (error) {
        skipped.push({ title: task.title, message: asProblem(error).message });
      }
    }
    setBatchPending(false); setBatchProgress(null); setBatchConfirm(false);
    if (skipped.length > 0) setBatchResult({ deleted, skipped });
    else { setBatchResult(null); exitSelection(); }
  }

  function renderCard(task: Task, column: Column) {
    const attention = snapshot?.attention[task.id] ?? EMPTY_ATTENTION;
    const isSelected = selectedIds.has(task.id);
    const project = state?.projects.find(project => project.id === task.projectId)?.name ?? task.projectId;
    return <article key={task.id} className={'kb-card' + (isSelected ? ' kb-card-selected' : '') + (selectionMode ? ' kb-card-selecting' : '')} data-task-id={task.id} data-working={attention.running ? 'true' : undefined}
      onPointerDown={event => { if (selectionMode) return; if ((event.target as Element).closest('.kb-card-run, .kb-card-signals, input, select, textarea, a')) return; begin(event, task.id, task.columnId); }}>
      {selectionMode && <input type="checkbox" className="kb-card-check" aria-label={'Select ' + task.title} checked={isSelected} onClick={event => event.stopPropagation()} onChange={() => toggleSelect(task.id)} />}
      <button type="button" className="kb-card-open" data-working={attention.running ? 'true' : undefined} aria-label={(selectionMode ? 'Select task ' : 'Open task ') + task.title} aria-pressed={selectionMode ? isSelected : undefined}
        onClick={() => { if (shouldSuppressClick()) return; if (selectionMode) { toggleSelect(task.id); return; } openTask(task.id); }}>
        <span className="kb-card-text"><strong>{task.title}</strong>
          <span className="kb-card-meta">
            <span className="kb-hint kb-card-project" title={project}>{project}</span>
            <span className="kb-card-signals" role="group" aria-label={'Activity for ' + task.title}>
              {attention.unread && <span className="kb-dot kb-blue" role="img" aria-label="Unread messages" title="Unread messages" />}
              {attention.awaitingReply && <span className="kb-dot kb-orange" role="img" aria-label="Awaiting reply" title="Awaiting reply" />}
              {attention.failed && <span className="kb-dot kb-red" role="img" aria-label="Agent failure" title="Agent failure" />}
              <TaskActivity attention={attention} variant="card" label={task.title} />
            </span>
          </span>
        </span>
      </button>
      <div className="kb-attention">{!selectionMode && <CardInstructionAction key={column.id} task={task} column={column} controller={autoRun} />}</div>
      {task.operation && <p className="kb-hint">Operation: {task.operation.phase}</p>}{task.pendingTransition && <p className="kb-hint">Confirmed action: {task.pendingTransition.status}</p>}
    </article>;
  }

  function renderNewTaskButton(column: Column) { return <div className="kb-column-create"><button type="button" className="kb-button kb-primary" disabled={!state || state.projects.length === 0} onClick={() => setNewTask(true)} aria-label="New task"><PlusIcon size={14} /> New task</button></div>; }

  function onBoardPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedId) return;
    const target = event.target as Element;
    if (target.closest('.kb-drawer') || target.closest('.kb-card') || target.closest('button, input, select, textarea, a, [role="dialog"]')) return;
    requestCloseDrawer();
  }

  return <section className="dsh-kanban" aria-label="Kanban"><style>{styles}</style><header className="kb-header">
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
    <nav className="kb-hub-nav" aria-label="Hub and board navigation">
      <div className="kb-hub-tabs" role="tablist" aria-label="Hubs">
        {snapshot?.state.hubs.map(hub => { const attention = attentionForHub(hub); return <button type="button" role="tab" key={hub.id} className={'kb-hub-tab' + (hub.id === activeHub?.id ? ' is-active' : '')} aria-selected={hub.id === activeHub?.id} onClick={() => selectHub(hub.id)}>{hub.name}{attention.unread && <span className="kb-dot kb-blue" role="img" aria-label="Hub unread activity" />}{attention.running && <span className="kb-dot kb-activity" role="img" aria-label="Hub active execution" />}{attention.failed && <span className="kb-dot kb-red" role="img" aria-label="Hub failure" />}</button>; })}
        <button type="button" className="kb-tab-add" aria-label="Create Hub" title="Create Hub" onClick={() => setNewHub(true)}><PlusIcon size={13} /></button>
      </div>
      {activeHub && <div className="kb-board-tabs" role="tablist" aria-label="Boards">
        {activeHub.boards.map(board => { const attention = attentionForBoard(activeHub, board.id); return <button type="button" role="tab" key={board.id} className={'kb-board-tab' + (board.id === activeBoard?.id ? ' is-active' : '')} aria-selected={board.id === activeBoard?.id} onClick={() => selectBoard(activeHub.id, board.id)}>{board.name}{attention.unread && <span className="kb-dot kb-blue" role="img" aria-label="Board unread activity" />}{attention.running && <span className="kb-dot kb-activity" role="img" aria-label="Board active execution" />}{attention.failed && <span className="kb-dot kb-red" role="img" aria-label="Board failure" />}</button>; })}
        <button type="button" className="kb-tab-add" aria-label="Create board" title="Create board" onClick={() => setNewBoard(true)}><PlusIcon size={13} /></button>
      </div>}
    </nav>
  </header>
    {configuration && <Configuration key={configuration} state={state ?? null} hub={activeHub ?? null} board={activeBoard ?? null} hubCount={snapshot?.state.hubs.length ?? 1} settings={snapshot?.state.settings} settingsRevision={snapshot?.state.settings?.revision ?? 0} run={run} api={api} pickDirectory={pickDirectory} initial={configuration} onClose={() => setConfiguration(null)} onHubDeleted={() => { setConfiguration(null); setActiveHubIdState(null); writeStorage(ACTIVE_HUB_KEY, null); }} onBoardDeleted={() => { setConfiguration(null); }} onBoardCreated={id => { selectBoard(activeHub!.id, id); setConfiguration(null); }} />}
    <ErrorNotice problem={loadError} />{loadError && <button type="button" className="kb-button" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading board</button>}<ErrorNotice problem={actionError} />{pending > 0 && <p className="kb-save-status" role="status">Saving change…</p>}{!snapshot && !loadError && <p className="kb-empty" role="status">Loading Kanban…</p>}{snapshot && !activeHub && <div className="kb-empty"><h2>No Hub available</h2><p>Create a Hub to continue.</p><button type="button" className="kb-button kb-primary" onClick={() => setNewHub(true)}>Create Hub</button></div>}{snapshot && activeHub && !activeBoard && <div className="kb-empty"><h2>Create your first board</h2><p>Boards hold a workflow and their tasks inside this Hub.</p><button type="button" className="kb-button kb-primary" onClick={() => setNewBoard(true)}>Create board</button></div>}
    {state && <><div className="kb-page-body" ref={boardBody} onPointerDown={onBoardPointerDown}>{state.projects.length === 0 && <div className="kb-empty"><h2>Add your first project</h2><p>Register a project path and Git root to create tasks.</p><button type="button" className="kb-button kb-primary" onClick={() => setConfiguration('Projects')}>Configure projects</button></div>}
      <div className="kb-columns" aria-label="Workflow columns">{columnLayout(state.workflow).map(slot => <section key={slot.key} className={'kb-column-slot ' + (slot.group ? 'kb-column-group' : '')} aria-label={slot.group?.name}>{slot.group && <h2 className="kb-group-heading">{slot.group.name}</h2>}{slot.columns.map(column => { const tasks = tasksForColumn(column.id); const restricted = Boolean(drag && drag.overColumnId === column.id && transitionAccess(state.workflow, drag.sourceColumnId, column.id) === 'restricted');
        return <section className={'kb-column' + (restricted ? ' kb-drop-restricted' : '')} key={column.id} aria-label={column.name + ' column'} data-column-id={column.id}><header className="kb-column-header"><h2>{column.name}</h2><span aria-label={tasks.length + ' tasks'}>{tasks.length}</span></header>{column.id === state.workflow.initialColumnId && renderNewTaskButton(column)}<div className="kb-card-list">{tasks.map(task => renderCard(task, column))}{drag?.overColumnId === column.id && <div className={'kb-drop-indicator' + (restricted ? ' kb-drop-indicator-restricted' : '')} style={{ top: drag.indicatorY }} aria-hidden="true" />}{tasks.length === 0 && <p className="kb-empty-column">No matching tasks</p>}</div></section>; })}</section>)}</div></div>
      {selected && <TaskDrawer key={selected.id} task={selected} attention={snapshot?.attention[selected.id] ?? EMPTY_ATTENTION} viewState={taskPageState(preferences, selected.id)} state={state} api={api} run={run} renderConversation={renderConversation} onClose={requestCloseDrawer} onMove={moveTo} onDanger={requestDanger} sessionTitles={sessionTitles} entering={drawerEntering} closing={drawerClosing} autoRun={autoRun} lineage={lineage} />}

    {newTask && state && <NewTaskDialog state={state} run={run} onClose={() => setNewTask(false)} onCreated={openTask} />}
    {destruction && (() => {
      const task = state.tasks.find(value => value.id === destruction.taskId);
      if (!task) return null;
      return <DeleteTaskDialog request={destruction} task={task} project={state.projects.find(value => value.id === task.projectId)} attention={snapshot?.attention[task.id] ?? EMPTY_ATTENTION} sessionTitles={sessionTitles} pending={destructionPending} problem={destructionError} onCancel={() => { setDestruction(null); setDestructionError(null); setDestructionStarted(false); }} onConfirm={() => void confirmDestruction()} onRetry={() => void retryDestruction()} onReturn={() => void returnDestruction()} />;
    })()}
    {discard && <DiscardDialog key={discard.command.type + discard.command.taskId} request={discard} run={command => runDestruction(discard, command)} onClose={() => setDiscard(null)} onDeleted={() => setSelectedId(null)} />}
    {batchConfirm && <BulkDeleteDialog tasks={batchTasks} attention={snapshot?.attention ?? {}} pending={batchPending} progress={batchProgress} onCancel={() => { if (!batchPending) setBatchConfirm(false); }} onConfirm={() => void deleteSelected()} />}
    {batchResult && <BulkResultDialog result={batchResult} onClose={() => setBatchResult(null)} />}
    </>}
    {newHub && <CreateHubDialog run={run} onClose={() => setNewHub(false)} onCreated={id => { setActiveHubIdState(id); writeStorage(ACTIVE_HUB_KEY, id); setNewHub(false); }} />}
    {newBoard && activeHub && <CreateBoardDialog hubId={activeHub.id} run={run} onClose={() => setNewBoard(false)} onCreated={id => { selectBoard(activeHub.id, id); setNewBoard(false); }} />}
    {confirmation && <TransitionOverrideDialog taskTitle={confirmation.taskTitle} workflowName={confirmation.workflowName} sourceName={confirmation.fromName} destinationName={confirmation.toName} pending={movePending} problem={moveError} canRetry={canRetry} onCancel={cancelMove} onConfirm={() => void confirmMove()} />}
  </section>;
}
