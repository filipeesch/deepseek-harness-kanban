import React, { useEffect, useRef, useState } from 'react';
import type { BoardState, Problem, Task } from '../shared/types.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { creationReceiptId, ErrorNotice, Markdown, Modal, useAction, type RunCommand } from './ui.js';
import { createTaskPageState, usePageField, type TaskPageState } from './page-state.js';

/** The creation choices the board needs after the receipt: whether to start the first execution. */
export interface CreatedTaskOptions { start: boolean }

export function NewTaskDialog({ state, run, onClose, onCreated }: { state: BoardState; run: RunCommand; onClose: () => void; onCreated: (id: string, options: CreatedTaskOptions) => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(''); const [autoMode, setAutoMode] = useState(false); const [start, setStart] = useState(true);
  const action = useAction(run); const [creationError, setCreationError] = useState<Problem | null>(null);
  const initialColumn = state.workflow.columns.find(column => column.id === state.workflow.initialColumnId);
  const hasInstruction = entryInstruction(initialColumn) !== undefined;
  const startApplies = hasInstruction && start;
  const columnName = initialColumn?.name ?? state.workflow.initialColumnId;
  return <Modal title="New task" onClose={onClose} busy={action.pending}><form className="kb-form" onSubmit={async event => { event.preventDefault(); if (!title.trim() || !projectId || creationError) return; const result = await action.execute({ type: 'task.create', title: title.trim(), description, projectId, ...(autoMode ? { autoMode: true } : {}) }); if (result) { const id = creationReceiptId(result, 'task'); if (!id) { setCreationError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The host saved the task but did not return its exact task creation receipt. Close this dialog and inspect or refresh the board before creating another task.' }); return; } if (!result.state.hubs.some(hub => hub.tasks.some(task => task.id === id))) { setCreationError({ code: 'CREATED_TASK_UNAVAILABLE', message: 'The created task is not available in the current board snapshot. Close this dialog and refresh the board before continuing.' }); return; } onCreated(id, { start: startApplies }); onClose(); } }}>
    <label className="kb-field">Title<input className="kb-input" required value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="kb-field">Description<textarea className="kb-input" rows={7} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className="kb-field">Project<select className="kb-input" required value={projectId} onChange={event => setProjectId(event.target.value)}><option value="" disabled>Select a project</option>{state.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
    <label className="kb-choice"><input type="checkbox" checked={autoMode} onChange={event => setAutoMode(event.target.checked)} /> Auto mode</label>
    <p className="kb-hint">Advance this task to its next configured stage after each completed turn.</p>
    {hasInstruction && <><label className="kb-choice"><input type="checkbox" checked={start} onChange={event => setStart(event.target.checked)} /> Start execution now</label>
      <p className="kb-hint">Runs the {columnName} instruction after a five-second countdown once the worktree and the first conversation are ready.</p></>}
    <p className="kb-hint">Creates in {columnName}.{startApplies ? '' : ' No agent starts automatically.'}</p>
    <ErrorNotice problem={action.error} /><ErrorNotice problem={creationError} /><div className="kb-actions"><button className="kb-button" type="button" disabled={action.pending} onClick={onClose}>{creationError ? 'Close and inspect board' : 'Cancel'}</button><button className="kb-button kb-primary" disabled={action.pending || Boolean(creationError) || !title.trim() || !projectId}>{action.pending ? 'Creating…' : 'Create task'}</button></div>
  </form></Modal>;
}

type TaskPanelProps = { task: Task; state: BoardState; run: RunCommand; viewState?: TaskPageState };

export function InfoPanel(props: TaskPanelProps) { return <InfoEditor key={props.task.id} {...props} />; }

function InfoEditor({ task, state, run, viewState }: TaskPanelProps) {
  const [localViewState] = useState(createTaskPageState); const preferences = viewState ?? localViewState;
  const [draft, setDraft] = usePageField(preferences, 'infoDraft');
  const [editing, setEditing] = useState(() => Boolean(draft)); const [saved, setSaved] = useState(false); const action = useAction(run);
  const draftGeneration = useRef(0);
  const title = editing && draft ? draft.title : task.title;
  const description = editing && draft ? draft.description : task.description;
  const previousTask = useRef(task.id);
  useEffect(() => () => { draftGeneration.current++; }, []);
  useEffect(() => { if (previousTask.current !== task.id) { previousTask.current = task.id; draftGeneration.current++; setDraft(undefined); setEditing(false); setSaved(false); } }, [task.id, setDraft]);
  function beginEdit() { if (action.pending) return; draftGeneration.current++; setDraft(draft ?? { title: task.title, description: task.description }); setEditing(true); setSaved(false); action.clearError(); }
  function cancelEdit() { if (action.pending) return; draftGeneration.current++; setDraft(undefined); setEditing(false); setSaved(false); action.clearError(); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (action.pending || !title.trim() || !draft) return;
    const generation = draftGeneration.current;
    const result = await action.execute({ type: 'task.edit', taskId: task.id, title: title.trim(), description, expectedRevision: state.revision });
    if (result && generation === draftGeneration.current) { setDraft(undefined); setEditing(false); setSaved(true); }
  }
  if (!editing) return <div className="kb-form" aria-label="Task information">
    <div className="kb-info-read"><h3>{task.title}</h3>{task.description.trim() ? <Markdown>{task.description}</Markdown> : <p className="kb-hint">No description yet.</p>}</div>
    <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={beginEdit}>Edit</button></div>
    <ErrorNotice problem={action.error} />{saved && <p role="status">Task saved.</p>}
  </div>;
  return <form className="kb-form" aria-label="Task information" onSubmit={save}>
    <label className="kb-field">Title<input className="kb-input" required disabled={action.pending} value={draft?.title ?? ''} onChange={event => { if (action.pending) return; draftGeneration.current++; setDraft({ title: event.target.value, description: draft?.description ?? task.description }); setSaved(false); }} /></label>
    <label className="kb-field">Description<textarea className="kb-input" rows={9} disabled={action.pending} value={draft?.description ?? ''} onChange={event => { if (action.pending) return; draftGeneration.current++; setDraft({ title: draft?.title ?? task.title, description: event.target.value }); setSaved(false); }} /></label>
    <ErrorNotice problem={action.error} />
    <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={cancelEdit}>Cancel</button><button className="kb-button kb-primary" disabled={action.pending || !title.trim()}>{action.pending ? 'Saving…' : 'Save task'}</button></div>{saved && <p role="status">Task saved.</p>}
  </form>;
}