import React, { useEffect, useRef, useState } from 'react';
import type { BoardState, Problem, Task } from '../shared/types.js';
import { creationReceiptId, ErrorNotice, Markdown, Modal, useAction, type RunCommand } from './ui.js';
import { createTaskPageState, usePageField, type TaskPageState } from './page-state.js';

export function NewTaskDialog({ state, run, onClose, onCreated }: { state: BoardState; run: RunCommand; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(''); const action = useAction(run); const [creationError, setCreationError] = useState<Problem | null>(null);
  return <Modal title="New task" onClose={onClose} busy={action.pending}><form className="kb-form" onSubmit={async event => { event.preventDefault(); if (!title.trim() || !projectId || creationError) return; const result = await action.execute({ type: 'task.create', title: title.trim(), description, projectId }); if (result) { const id = creationReceiptId(result, 'task'); if (!id) { setCreationError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The host saved the task but did not return its exact task creation receipt. Close this dialog and inspect or refresh the board before creating another task.' }); return; } if (!result.state.hubs.some(hub => hub.tasks.some(task => task.id === id))) { setCreationError({ code: 'CREATED_TASK_UNAVAILABLE', message: 'The created task is not available in the current board snapshot. Close this dialog and refresh the board before continuing.' }); return; } onCreated(id); onClose(); } }}>
    <label className="kb-field">Title<input className="kb-input" required value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="kb-field">Description<textarea className="kb-input" rows={7} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className="kb-field">Project<select className="kb-input" required value={projectId} onChange={event => setProjectId(event.target.value)}><option value="" disabled>Select a project</option>{state.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
    <p className="kb-hint">Creates in {state.workflow.columns.find(column => column.id === state.workflow.initialColumnId)?.name ?? state.workflow.initialColumnId}. No agent starts automatically.</p>
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

export function NotesPanel(props: TaskPanelProps) { return <NotesEditor key={props.task.id} {...props} />; }

function NotesEditor({ task, state, run }: TaskPanelProps) {
  const notes = state.notes.filter(note => note.taskId === task.id); const [noteId, setNoteId] = useState<string | undefined>(); const [content, setContent] = useState(''); const [saved, setSaved] = useState(false); const action = useAction(run);
  const draftGeneration = useRef(0);
  useEffect(() => () => { draftGeneration.current++; }, []);
  return <div className="kb-form"><p className="kb-hint">Notes belong to this task and are shared by all of its conversations.</p><div className="kb-row"><h3>Shared notes</h3><button className="kb-button" type="button" disabled={action.pending} onClick={() => { if (action.pending) return; draftGeneration.current++; setNoteId(undefined); setContent(''); setSaved(false); action.clearError(); }}>New note</button></div>{notes.length === 0 && <p>No notes yet.</p>}<ul className="kb-note-list">{notes.map(note => <li className="kb-note" key={note.id}><Markdown>{note.content}</Markdown>{note.tags?.length ? <p className="kb-hint">{note.tags.join(', ')}</p> : null}<button className="kb-button" type="button" aria-label={'Edit note ' + note.id} disabled={action.pending} onClick={() => { if (action.pending) return; draftGeneration.current++; setNoteId(note.id); setContent(note.content); setSaved(false); action.clearError(); }}>Edit note</button></li>)}</ul><form className="kb-form" onSubmit={async event => { event.preventDefault(); if (action.pending || !content.trim()) return; const generation = draftGeneration.current; const result = await action.execute({ type: 'note.save', taskId: task.id, ...(noteId ? { noteId } : {}), content }); if (result && generation === draftGeneration.current) { setContent(''); setNoteId(undefined); setSaved(true); } }}><label className="kb-field">{noteId ? 'Edit note Markdown' : 'New note Markdown'}<textarea className="kb-input" rows={6} disabled={action.pending} value={content} onChange={event => { if (action.pending) return; draftGeneration.current++; setContent(event.target.value); setSaved(false); }} /></label><ErrorNotice problem={action.error} /><button className="kb-button kb-primary" disabled={action.pending || !content.trim()}>{action.pending ? 'Saving…' : 'Save note'}</button>{saved && <p role="status">Note saved for all task conversations.</p>}</form></div>;
}
