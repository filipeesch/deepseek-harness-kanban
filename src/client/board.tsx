import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BoardSnapshot, ClientApi, Column, ColumnGroup, Command, Problem, Task, Workflow } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import { Configuration, NewTaskDialog } from './forms.js';
import { TaskDrawer } from './drawer.js';
import { MoveDialog } from './move.js';
import { asProblem, ErrorNotice, Modal, type RunCommand } from './ui.js';
import { styles } from './styles.js';
import { createBoardPageState, taskPageState, usePageField, type BoardPageState } from './page-state.js';
export { createBoardPageState } from './page-state.js';
export type { BoardPageState } from './page-state.js';

export interface BoardViewProps { api: ClientApi; renderConversation: (id: string) => ReactNode; pageState?: BoardPageState }
type DestructiveCommand = Extract<Command, { type: 'task.delete' | 'worktree.remove' }>;
interface Destruction { command: DestructiveCommand; title: string; path: string | null; expectedWorktreePath: string | null; error?: Problem }

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

export function BoardView({ api, renderConversation, pageState }: BoardViewProps) {
  const [localPageState] = useState(createBoardPageState); const preferences = pageState ?? localPageState;
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null); const latest = useRef<BoardSnapshot | null>(null); const live = useRef(false); const currentApi = useRef(api); currentApi.current = api;
  const [loadError, setLoadError] = useState<Problem | null>(null); const [loadAttempt, setLoadAttempt] = useState(0); const [pending, setPending] = useState(0);
  const [search, setSearch] = usePageField(preferences, 'search'); const [projectFilter, setProjectFilter] = usePageField(preferences, 'projectFilter'); const [archive, setArchive] = usePageField(preferences, 'archive'); const [selectedId, setSelectedId] = usePageField(preferences, 'selectedTaskId');
  const [newTask, setNewTask] = useState(false); const [configuration, setConfiguration] = useState(false); const [move, setMove] = useState<{ taskId: string; columnId: string } | null>(null); const [dragging, setDragging] = useState<string | null>(null);
  const [destruction, setDestruction] = useState<Destruction | null>(null); const [discard, setDiscard] = useState<Destruction | null>(null); const [actionError, setActionError] = useState<Problem | null>(null);
  const accept = useCallback((next: BoardSnapshot) => { if (!live.current) return; const currentEpoch = latest.current?.clientEpoch ?? 0; const nextEpoch = next.clientEpoch ?? 0; if (latest.current && (nextEpoch < currentEpoch || (nextEpoch === currentEpoch && next.sequence < latest.current.sequence))) return; latest.current = next; setSnapshot(next); }, []);
  useEffect(() => {
    let active = true; live.current = true; latest.current = null; setSnapshot(null); setLoadError(null); let unsubscribe = () => {};
    try { unsubscribe = api.subscribe(next => { if (active) accept(next); }); } catch (error) { setLoadError(asProblem(error)); }
    void Promise.resolve().then(() => api.snapshot()).then(next => { if (active) accept(next); }, error => { if (active) setLoadError(asProblem(error)); });
    return () => { active = false; live.current = false; unsubscribe(); };
  }, [api, loadAttempt, accept]);
  const run: RunCommand = useCallback(async (command: Command) => {
    setPending(value => value + 1);
    const invokedTask = 'taskId' in command ? latest.current?.state.tasks.find(value => value.id === command.taskId) : undefined;
    const priorOperation = invokedTask?.operation;
    try { const result = await api.command(command); if (currentApi.current === api) accept(result); return result; }
    catch (error) {
      const problem = asProblem(error); const task = invokedTask;
      let original: DestructiveCommand | undefined;
      if ((command.type === 'task.delete' || command.type === 'worktree.remove') && !command.discardChanges) original = command;
      else if (command.type === 'operation.retry' && task && priorOperation && (priorOperation.request.kind === 'remove' || priorOperation.request.kind === 'delete') && !priorOperation.request.discardChanges) {
        const capturedPath = priorOperation.request.expectedWorktreePath !== undefined ? priorOperation.request.expectedWorktreePath : priorOperation.targetPath;
        if (capturedPath !== undefined) original = { type: priorOperation.request.kind === 'delete' ? 'task.delete' : 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: capturedPath };
        else setActionError({ code: 'CONFIRMATION_REQUIRED', message: 'The original removal target is unavailable. Return to base and review a new removal confirmation.' });
      }
      if (problem.code === 'DISCARD_REQUIRED' && original && task) setDiscard({ command: original, title: task.title, path: original.expectedWorktreePath, expectedWorktreePath: original.expectedWorktreePath, error: problem });
      throw error;
    } finally { if (live.current) setPending(value => Math.max(0, value - 1)); }
  }, [api, accept]);
  const state = snapshot?.state;
  useEffect(() => { if (state && selectedId && !state.tasks.some(task => task.id === selectedId)) setSelectedId(null); }, [state, selectedId]);
  async function simple(command: Command) { setActionError(null); try { await run(command); } catch (error) { const problem = asProblem(error); if (problem.code !== 'DISCARD_REQUIRED') setActionError(problem); } }
  function requestMove(task: Task, column: Column) {
    if (!state || task.columnId === column.id || task.archivedAt) return;
    const current = state.workflow.columns.find(value => value.id === task.columnId);
    if (current?.allowedTransitions !== undefined && !current.allowedTransitions.includes(column.id)) { setActionError({ code: 'TRANSITION_NOT_ALLOWED', message: 'This workflow does not allow that transition.' }); return; }
    if (task.operation || task.pendingTransition) { setActionError({ code: 'OPERATION_PENDING', message: 'Resolve the current task operation before moving.' }); return; }
    if (column.onEnterPrompt?.trim() || !task.worktree) setMove({ taskId: task.id, columnId: column.id });
    else void simple({ type: 'task.move', taskId: task.id, columnId: column.id, mode: 'move' });
  }
  function requestDanger(task: Task, type: 'task.delete' | 'worktree.remove') { setActionError(null); setDestruction({ command: { type, taskId: task.id, confirmed: true, expectedWorktreePath: task.worktree?.path ?? null }, title: task.title, path: task.worktree?.path ?? null, expectedWorktreePath: task.worktree?.path ?? null }); }
  function runDestruction(request: Destruction, command: Command = request.command) {
    const task = latest.current?.state.tasks.find(value => value.id === request.command.taskId);
    if (!task || (task.worktree?.path ?? null) !== request.expectedWorktreePath) return Promise.reject({ code: 'CONTEXT_CHANGED', message: 'The task worktree changed while confirmation was open. Cancel and review the current target before trying again.' });
    return run(command);
  }
  async function confirmDestruction() { if (!destruction) return; const request = destruction; setDestruction(null); try { await runDestruction(request); if (request.command.type === 'task.delete') setSelectedId(null); } catch (error) { const problem = asProblem(error); if (problem.code !== 'DISCARD_REQUIRED') setActionError(problem); } }
  const selected = state?.tasks.find(task => task.id === selectedId);
  const moveTask = state?.tasks.find(task => task.id === move?.taskId); const moveColumn = state?.workflow.columns.find(column => column.id === move?.columnId);
  const visible = state?.tasks.filter(task => Boolean(task.archivedAt) === archive && (!projectFilter || task.projectId === projectFilter) && (task.title + ' ' + task.description).toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)) ?? [];
  function renderCard(task: Task) {
    const attention = snapshot?.attention[task.id] ?? EMPTY_ATTENTION; const current = state?.workflow.columns.find(column => column.id === task.columnId);
    return <article key={task.id} className="kb-card" draggable={!archive && !task.operation && !task.pendingTransition} onDragStart={event => { if (event.target instanceof HTMLElement && event.target.closest('select')) { event.preventDefault(); return; } setDragging(task.id); event.dataTransfer?.setData('application/x-dsh-kanban-task', task.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragging(null)}>
      <button type="button" className="kb-card-open" aria-label={'Open task ' + task.title} onClick={() => setSelectedId(task.id)}><strong>{task.title}</strong><span className="kb-hint">{state?.projects.find(project => project.id === task.projectId)?.name ?? task.projectId}</span></button>
      <div className="kb-attention" role="group" aria-label={'Activity for ' + task.title}>{attention.running && <span className="kb-running">Running</span>}{attention.unread && <span className="kb-dot kb-blue" role="img" aria-label="Unread messages" title="Unread messages" />}{attention.awaitingReply && <span className="kb-dot kb-orange" role="img" aria-label="Awaiting reply" title="Awaiting reply" />}{attention.failed && <span className="kb-dot kb-red" role="img" aria-label="Agent failure" title="Agent failure" />}</div>
      {task.operation && <p className="kb-hint">Operation: {task.operation.phase}</p>}{task.pendingTransition && <p className="kb-hint">Confirmed action: {task.pendingTransition.status}</p>}
      {archive ? <div className="kb-actions"><button className="kb-button" type="button" disabled={pending > 0 || Boolean(task.operation)} onClick={() => void simple({ type: 'task.restore', taskId: task.id })}>Restore {task.title}</button><button className="kb-button kb-danger" type="button" disabled={pending > 0 || Boolean(task.operation)} onClick={() => requestDanger(task, 'task.delete')}>Delete {task.title}</button></div> : <label className="kb-field kb-card-move"><span className="kb-sr">{'Move ' + task.title + ' to'}</span><select className="kb-input" aria-label={'Move ' + task.title + ' to'} value={task.columnId} disabled={Boolean(task.operation || task.pendingTransition)} onChange={event => { const column = state?.workflow.columns.find(value => value.id === event.target.value); if (column) requestMove(task, column); }}>{state?.workflow.columns.map(column => <option key={column.id} value={column.id} disabled={column.id !== task.columnId && current?.allowedTransitions !== undefined && !current.allowedTransitions.includes(column.id)}>{column.name}</option>)}</select></label>}
    </article>;
  }
  return <section className="dsh-kanban" aria-label="Kanban"><style>{styles}</style><header className="kb-header"><div><h1>Kanban</h1><p className="kb-hint">One board for all projects</p></div><div className="kb-toolbar"><button type="button" className="kb-button kb-primary" disabled={!state || state.projects.length === 0} onClick={() => setNewTask(true)}>New task</button><label className="kb-field kb-search"><span className="kb-sr">Search tasks</span><input className="kb-input" type="search" aria-label="Search tasks" placeholder="Search title or description" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="kb-field"><span className="kb-sr">Project filter</span><select className="kb-input" aria-label="Project filter" value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="">All projects</option>{state?.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><button type="button" className="kb-button" disabled={!state} aria-pressed={archive} onClick={() => setArchive(!archive)}>{archive ? 'Back to board' : 'Archived tasks'}</button><button type="button" className="kb-button" disabled={!state} onClick={() => setConfiguration(true)}>Configuration</button></div></header>
    <ErrorNotice problem={loadError} />{loadError && <button type="button" className="kb-button" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading board</button>}<ErrorNotice problem={actionError} />{pending > 0 && <p className="kb-save-status" role="status">Saving change…</p>}{!state && !loadError && <p className="kb-empty" role="status">Loading Kanban…</p>}
    {state && <><div className="kb-page-body">{state.projects.length === 0 && <div className="kb-empty"><h2>Add your first project</h2><p>Register a project path and Git root to create tasks.</p><button type="button" className="kb-button kb-primary" onClick={() => setConfiguration(true)}>Configure projects</button></div>}
      {archive ? <section className="kb-archive" aria-label="Archived tasks"><h2>Archived tasks</h2><p className="kb-hint">Restore a task to return its retained notes and conversations to the active board.</p>{visible.length ? visible.map(renderCard) : <p>No archived tasks match the current search and project filter.</p>}</section> : <div className="kb-columns" aria-label="Workflow columns">{columnLayout(state.workflow).map(slot => <section key={slot.key} className={'kb-column-slot ' + (slot.group ? 'kb-column-group' : '')} aria-label={slot.group?.name}>{slot.group && <h2 className="kb-group-heading">{slot.group.name}</h2>}{slot.columns.map(column => { const tasks = visible.filter(task => task.columnId === column.id); const dragged = state.tasks.find(task => task.id === dragging); const source = state.workflow.columns.find(value => value.id === dragged?.columnId); const allowed = !dragged || source?.allowedTransitions === undefined || source.allowedTransitions.includes(column.id) || dragged.columnId === column.id;
        return <section className={'kb-column ' + (dragging && !allowed ? 'kb-drop-disabled' : '')} key={column.id} aria-label={column.name + ' column'} onDragOver={event => { if (allowed) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const taskId = event.dataTransfer?.getData('application/x-dsh-kanban-task') || dragging; const task = state.tasks.find(value => value.id === taskId); setDragging(null); if (task && allowed) requestMove(task, column); }}><header className="kb-column-header"><h2>{column.name}</h2><span aria-label={tasks.length + ' tasks'}>{tasks.length}</span></header><div className="kb-card-list">{tasks.map(renderCard)}{tasks.length === 0 && <p className="kb-empty-column">No matching tasks</p>}</div></section>; })}</section>)}</div>}
      <p className="kb-legend">Execution is independent of workflow stage. Blue: unread · Orange: awaiting reply · Red: failure.</p>
    </div>{selected && <TaskDrawer key={selected.id} task={selected} viewState={taskPageState(preferences, selected.id)} state={state} api={api} run={run} renderConversation={renderConversation} onClose={() => setSelectedId(null)} onMove={requestMove} onDanger={requestDanger} />}
    {newTask && <NewTaskDialog state={state} run={run} onClose={() => setNewTask(false)} onCreated={id => { setArchive(false); setSelectedId(id); }} />}{configuration && <Configuration state={state} run={run} onClose={() => setConfiguration(false)} />}{moveTask && moveColumn && <MoveDialog key={moveTask.id + ':' + moveColumn.id} task={moveTask} column={moveColumn} state={state} api={api} run={run} onClose={() => setMove(null)} />}
    {destruction && <Modal title={destruction.command.type === 'task.delete' ? 'Delete task' : 'Remove worktree'} onClose={() => setDestruction(null)}><div className="kb-form"><p>{destruction.command.type === 'task.delete' ? 'Permanently delete the Kanban task ' : 'Remove the worktree for '}<strong>{destruction.title}</strong>?</p>{destruction.path && <p>Worktree: <code>{destruction.path}</code></p>}<p>{destruction.command.type === 'task.delete' ? 'Task data and notes are deleted. Its native DSH chats are ARCHIVED, not erased: their histories remain. The Git branch is kept. Conversations return to the base project path before worktree cleanup.' : 'The task, notes, conversations, histories, and Git branch are kept. All conversations return to the base project path before the worktree is removed.'}</p>{destruction.command.type === 'task.delete' && Boolean(state.tasks.find(task => task.id === destruction.command.taskId)?.unclaimedWorktrees?.length) && <p className="kb-warning" role="note" aria-label="Unclaimed checkout deletion warning">Unclaimed checkouts remain on disk. They are not included in this deletion and require manual inspection.</p>}<p>Local changes will not be discarded without an additional explicit confirmation.</p><div className="kb-actions"><button type="button" className="kb-button" onClick={() => setDestruction(null)}>Cancel</button><button type="button" className="kb-button kb-danger" onClick={() => void confirmDestruction()}>{destruction.command.type === 'task.delete' ? 'Delete task and archive chats' : 'Confirm worktree removal'}</button></div></div></Modal>}
    {discard && <DiscardDialog key={discard.command.type + discard.command.taskId} request={discard} run={command => runDestruction(discard, command)} onClose={() => setDiscard(null)} onDeleted={() => setSelectedId(null)} />}</>}
  </section>;
}

function DiscardDialog({ request, run, onClose, onDeleted }: { request: Destruction; run: RunCommand; onClose: () => void; onDeleted: () => void }) {
  const [understood, setUnderstood] = useState(false); const [pending, setPending] = useState(false); const [error, setError] = useState<Problem | null>(null);
  return <Modal title="Discard local worktree changes?" onClose={onClose} busy={pending}><div className="kb-form"><p className="kb-warning">Additional confirmation required: modified tracked files and untracked files in this worktree can be permanently lost.</p><strong>{request.title}</strong>{request.path && <code>{request.path}</code>}<ErrorNotice problem={error ?? request.error ?? null} /><label className="kb-choice"><input type="checkbox" checked={understood} disabled={pending} onChange={event => setUnderstood(event.target.checked)} />I understand that these local changes and untracked files will be discarded.</label><div className="kb-actions"><button type="button" className="kb-button" disabled={pending} onClick={onClose}>Keep local changes</button><button type="button" className="kb-button kb-danger" disabled={pending || !understood} onClick={async () => { if (!understood) return; setPending(true); setError(null); try { await run({ ...request.command, discardChanges: true }); if (request.command.type === 'task.delete') onDeleted(); onClose(); } catch (failure) { setError(asProblem(failure)); } finally { setPending(false); } }}>{pending ? 'Removing…' : 'Discard changes and continue'}</button></div></div></Modal>;
}
