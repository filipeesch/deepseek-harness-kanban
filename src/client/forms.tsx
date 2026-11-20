import React, { useEffect, useRef, useState } from 'react';
import type { BoardState, ClientApi, Problem, Project, Task } from '../shared/types.js';
import { TaskFilesSection } from './task-files-section.js';
import { readFileBase64 } from './task-files.js';
import { toProblem } from './task-files-section.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { creationReceiptId, ErrorNotice, Markdown, Modal, useAction, type RunCommand } from './ui.js';
import { createTaskPageState, usePageField, type TaskPageState } from './page-state.js';

/** The creation choices the board needs after the receipt: whether to start the first execution. */
export interface CreatedTaskOptions { start: boolean }

export function NewTaskDialog({ state, projects, closedForCreation, run, onClose, onCreated }: {
  state: BoardState;
  /** The projects the active board allows; a placeholder is never offered. */
  projects: readonly Project[];
  /** A board whose scope records no project accepts no new task. */
  closedForCreation: boolean;
  run: RunCommand;
  onClose: () => void;
  onCreated: (id: string, options: CreatedTaskOptions) => void;
}) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(''); const [autoMode, setAutoMode] = useState(false); const [start, setStart] = useState(true);
  // Attachments are supplied with the creation, so the task is never observed
  // without the evidence it was created with.
  const [attachmentPaths, setAttachmentPaths] = useState<readonly string[]>([]);
  const [attachmentUploads, setAttachmentUploads] = useState<readonly { name: string; origin: 'upload' | 'clipboard'; data: string }[]>([]);
  const [attachmentProblem, setAttachmentProblem] = useState<Problem | null>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A file picked a moment before Create must not be dropped from the task, so the
  // read is counted while it runs and Create waits for it.
  const [readingFiles, setReadingFiles] = useState(0);
  /** Failed selections that still block creation until the person retries or removes them. */
  const [attachmentFailures, setAttachmentFailures] = useState<ReadonlyArray<{ selection: number; problem: Problem }>>([]);
  /** One identity per pick, so a retry clears exactly the selection it retries. */
  const selectionIds = useRef(0);
  /** How to retry each failed selection with the files it already carried. */
  const failedSelection = useRef(new Map<number, () => void>());
  /** Retry every failed selection with its own files and identity. */
  function retryFailedAttachments(): void {
    // Each closure deletes its own entry before saving, so a second click in the same
    // breath cannot replay a selection that is already retrying.
    for (const [selection, retry] of [...failedSelection.current]) {
      failedSelection.current.delete(selection);
      retry();
    }
  }
  /** Drop every failed selection, so creation proceeds without those files. */
  function discardFailedAttachments(): void { failedSelection.current.clear(); setAttachmentFailures([]); setAttachmentProblem(null); }
  async function addAttachments(files: readonly File[], origin: 'upload' | 'clipboard', retrying?: number): Promise<void> {
    if (files.length === 0) return;
    // A retry keeps the identity of the selection it retries, so only that failure clears.
    const selection = retrying ?? ++selectionIds.current;
    setReadingFiles(current => current + 1);
    try {
      const uploads = await Promise.all(files.map(async file => ({ name: file.name, origin, data: await readFileBase64(file) })));
      setAttachmentUploads(current => [...current, ...uploads]);
      // This pick succeeded, so only its own failure clears; another selection keeps
      // blocking Create until the person retries or removes it.
      setAttachmentFailures(current => current.filter(entry => entry.selection !== selection));
      failedSelection.current.delete(selection);
      setAttachmentProblem(null);
    } catch (failure) {
      // Each failed selection is remembered on its own, so a later successful pick
      // cannot release the gate and let the task be created without it.
      setAttachmentFailures(current => [...current.filter(entry => entry.selection !== selection), { selection, problem: toProblem(failure) }]);
      failedSelection.current.set(selection, () => { void addAttachments(files, origin, selection); });
      setAttachmentProblem(toProblem(failure));
    } finally { setReadingFiles(current => current - 1); }
  }
  const action = useAction(run); const [creationError, setCreationError] = useState<Problem | null>(null);
  // The board may change while this dialog is open: a project that is no longer allowed,
  // or a board that is now closed, must stop the save instead of failing on the host.
  const selectable = projects.some(project => project.id === projectId);
  const cannotSave = closedForCreation || !selectable;
  // A read in flight or a read that failed both stop creation, so a task is never
  // created without the files the person selected for it.
  const filesBlocked = readingFiles > 0 || attachmentFailures.length > 0;
  useEffect(() => { if (projectId !== '' && !selectable) setProjectId(''); }, [projectId, selectable]);
  const initialColumn = state.workflow.columns.find(column => column.id === state.workflow.initialColumnId);
  const hasInstruction = entryInstruction(initialColumn) !== undefined;
  const startApplies = hasInstruction && start;
  const columnName = initialColumn?.name ?? state.workflow.initialColumnId;
  return <Modal title="New task" onClose={onClose} busy={action.pending}><form className="kb-form" onSubmit={async event => { event.preventDefault(); if (!title.trim() || !projectId || cannotSave || creationError || filesBlocked) return; const result = await action.execute({ type: 'task.create', title: title.trim(), description, projectId, ...(autoMode ? { autoMode: true } : {}), ...(attachmentPaths.length === 0 ? {} : { attachments: [...attachmentPaths] }), ...(attachmentUploads.length === 0 ? {} : { attachmentUploads: [...attachmentUploads] }) }); if (result) { const id = creationReceiptId(result, 'task'); if (!id) { setCreationError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The host saved the task but did not return its exact task creation receipt. Close this dialog and inspect or refresh the board before creating another task.' }); return; } if (!result.state.hubs.some(hub => hub.tasks.some(task => task.id === id))) { setCreationError({ code: 'CREATED_TASK_UNAVAILABLE', message: 'The created task is not available in the current board snapshot. Close this dialog and refresh the board before continuing.' }); return; } onCreated(id, { start: startApplies }); onClose(); } }}>
    <label className="kb-field">Title<input className="kb-input" required value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="kb-field">Description<textarea className="kb-input" rows={7} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className="kb-field">Project<select className="kb-input" required disabled={closedForCreation} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="" disabled>Select a project</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
    {closedForCreation && <p className="kb-hint" role="status">This board allows no project, so it accepts no new task. Change its project scope in the board's configuration, from Configuration → Boards.</p>}
    {!closedForCreation && projects.length === 0 && <p className="kb-hint" role="status">No project of this Hub can create a task here yet. Register or adopt a project in Configuration → Projects, or widen this board's project scope.</p>}
    <label className="kb-choice"><input type="checkbox" checked={autoMode} onChange={event => setAutoMode(event.target.checked)} /> Auto mode</label>
    <p className="kb-hint">Advance this task to its next configured stage after each completed turn.</p>
    {hasInstruction && <><label className="kb-choice"><input type="checkbox" checked={start} onChange={event => setStart(event.target.checked)} /> Start execution now</label>
      <p className="kb-hint">Runs the {columnName} instruction after a five-second countdown once the worktree and the first conversation are ready.</p></>}
    <fieldset className="kb-fieldset kb-create-files">
      <legend>Files</legend>
      <div className="kb-input-row">
        <input ref={pathRef} className="kb-input" placeholder="/absolute/path/to/file" aria-label="Attachment host path" onPaste={event => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return;
          event.preventDefault();
          void addAttachments(files, 'clipboard');
        }} />
        <button type="button" className="kb-button" onClick={() => {
          const value = pathRef.current?.value.trim() ?? '';
          if (value === '') return;
          setAttachmentPaths(current => [...current, value]);
          setAttachmentProblem(null);
          if (pathRef.current !== null) pathRef.current.value = '';
        }}>Add path</button>
      </div>
      <div className="kb-file-add-actions">
        <input ref={fileRef} type="file" hidden aria-label="Attach a file" onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void addAttachments(files, 'upload');
        }} />
        <button type="button" className="kb-button" onClick={() => fileRef.current?.click()}>Choose a file</button>
        <span className="kb-hint">Files are attached when the task is created; one unreadable path or a file still being read prevents creation.</span>
      </div>
      {(attachmentPaths.length > 0 || attachmentUploads.length > 0) && <ul className="kb-file-list">
        {attachmentPaths.map(path => <li key={'path:' + path}><span className="kb-file-name" title={path}>{path}</span><button type="button" className="kb-button" onClick={() => setAttachmentPaths(current => current.filter(value => value !== path))}>Remove</button></li>)}
        {attachmentUploads.map(upload => <li key={'upload:' + upload.name + ':' + upload.data.length}><span className="kb-file-name">{upload.name}</span><button type="button" className="kb-button" onClick={() => { setAttachmentUploads(current => current.filter(value => value !== upload)); }}>Remove</button></li>)}
      </ul>}
      <ErrorNotice problem={attachmentProblem} />
      {attachmentFailures.length > 0 && <div className="kb-actions" role="alert">
        <button type="button" className="kb-button" disabled={readingFiles > 0} onClick={retryFailedAttachments}>Try again</button>
        <button type="button" className="kb-button" disabled={readingFiles > 0} onClick={discardFailedAttachments}>Discard failed files</button>
      </div>}
    </fieldset>
    <p className="kb-hint">Creates in {columnName}.{startApplies ? '' : ' No agent starts automatically.'}</p>
    <ErrorNotice problem={action.error} /><ErrorNotice problem={creationError} /><div className="kb-actions"><button className="kb-button" type="button" disabled={action.pending} onClick={onClose}>{creationError ? 'Close and inspect board' : 'Cancel'}</button><button className="kb-button kb-primary" disabled={action.pending || Boolean(creationError) || !title.trim() || cannotSave || filesBlocked}>{action.pending ? 'Creating…' : readingFiles > 0 ? 'Reading files…' : 'Create task'}</button></div>
  </form></Modal>;
}

type TaskPanelProps = { task: Task; state: BoardState; run: RunCommand; viewState?: TaskPageState; api?: ClientApi };

export function InfoPanel(props: TaskPanelProps) { return <InfoEditor key={props.task.id} {...props} />; }

function InfoEditor({ task, state, run, viewState, api }: TaskPanelProps) {
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
    {/* Files live with the task text they describe, so the section is the one place
        to see what a task carries and to change it. */}
    <TaskFilesSection task={task} api={api} {...(state.boardId === undefined ? {} : { hubId: state.boardId })} run={run} />
  </div>;
  return <form className="kb-form" aria-label="Task information" onSubmit={save}>
    <label className="kb-field">Title<input className="kb-input" required disabled={action.pending} value={draft?.title ?? ''} onChange={event => { if (action.pending) return; draftGeneration.current++; setDraft({ title: event.target.value, description: draft?.description ?? task.description }); setSaved(false); }} /></label>
    <label className="kb-field">Description<textarea className="kb-input" rows={9} disabled={action.pending} value={draft?.description ?? ''} onChange={event => { if (action.pending) return; draftGeneration.current++; setDraft({ title: draft?.title ?? task.title, description: event.target.value }); setSaved(false); }} /></label>
    <ErrorNotice problem={action.error} />
    <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={cancelEdit}>Cancel</button><button className="kb-button kb-primary" disabled={action.pending || !title.trim()}>{action.pending ? 'Saving…' : 'Save task'}</button></div>{saved && <p role="status">Task saved.</p>}
  </form>;
}
