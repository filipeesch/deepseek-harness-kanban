import React, { useEffect, useRef, useState } from 'react';
import type { BoardState, ClientApi, Problem, Project, Task } from '../shared/types.js';
import { TaskFilesSection } from './task-files-section.js';
import { base64Size, readFilesBase64 } from '../attachments/bytes.js';
import { AttachButton } from '../attachments/AttachButton.js';
import { AttachmentChips } from '../attachments/AttachmentChips.js';
import { AttachmentFailureNotice } from '../attachments/AttachmentFailureNotice.js';
import { useAttachmentPicks } from '../attachments/picks.js';
import { clipboardFiles } from '../attachments/clipboard.js';
import { useRestoreFocusAfterFailure } from '../attachments/focus.js';
import { toProblem } from './task-files-section.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { creationReceiptId, ErrorNotice, Markdown, Modal, useAction, type RunCommand } from './ui.js';
import { createTaskPageState, usePageField, type TaskPageState } from './page-state.js';

/** The creation choices the board needs after the receipt: whether to start the first execution. */
export interface CreatedTaskOptions { start: boolean }

/** One file the New task dialog will attach in the same operation that creates the task. */
interface CreationFile {
  /** Local identity for the token list; never sent to the host. */
  readonly id: string;
  readonly name: string;
  readonly origin: 'upload' | 'clipboard';
  /** Exact bytes, base64-encoded. */
  readonly data: string;
}

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
  // without the evidence it was created with. The footer owns the one add action and
  // the tokens, and the shared hook owns the read order and the failure gate.
  const [attachmentUploads, setAttachmentUploads] = useState<readonly CreationFile[]>([]);
  const attachmentIds = useRef(0);
  const picks = useAttachmentPicks();
  const attachRef = useRef<HTMLButtonElement>(null);
  /**
   * Read the picked files into one creation attachment batch. The read is
   * all-or-nothing: nothing is added unless every file in the batch could be read,
   * so a retry cannot duplicate a prefix.
   */
  function acceptPick(origin: CreationFile['origin']): (files: readonly File[]) => Promise<void> {
    return async picked => {
      const reads = await readFilesBase64(picked);
      const uploads = reads.map(read => ({ id: 'creation-' + (++attachmentIds.current), name: read.file.name, origin, data: read.data }));
      setAttachmentUploads(current => [...current, ...uploads]);
    };
  }
  /**
   * Queue the files one source handed over. A creation already in flight has fixed its
   * command, so it takes no further file from either source.
   */
  function pickFiles(files: readonly File[], origin: CreationFile['origin']): void {
    if (action.pending) return;
    picks.pick(files, acceptPick(origin));
  }
  const action = useAction(run); const [creationError, setCreationError] = useState<Problem | null>(null);
  // The board may change while this dialog is open: a project that is no longer allowed,
  // or a board that is now closed, must stop the save instead of failing on the host.
  const selectable = projects.some(project => project.id === projectId);
  const cannotSave = closedForCreation || !selectable;
  // A read in flight or a read that failed both stop creation, so a task is never
  // created without the files the person selected for it.
  const filesBlocked = picks.pending > 0 || picks.failed > 0;
  const attachmentFailure = picks.failure === undefined ? '' : toProblem(picks.failure).message;
  useRestoreFocusAfterFailure(picks.failed, !action.pending, attachRef);
  useEffect(() => { if (projectId !== '' && !selectable) setProjectId(''); }, [projectId, selectable]);
  const initialColumn = state.workflow.columns.find(column => column.id === state.workflow.initialColumnId);
  const hasInstruction = entryInstruction(initialColumn) !== undefined;
  const startApplies = hasInstruction && start;
  const columnName = initialColumn?.name ?? state.workflow.initialColumnId;
  return <Modal title="New task" onClose={onClose} busy={action.pending}><form className="kb-form" onPaste={event => {
    // A file pasted anywhere in the dialog belongs to the task being created; pasted
    // text stays text.
    const pasted = clipboardFiles(event.clipboardData);
    if (pasted.length === 0) return;
    event.preventDefault();
    pickFiles(pasted, 'clipboard');
  }} onSubmit={async event => { event.preventDefault(); if (!title.trim() || !projectId || cannotSave || creationError || filesBlocked || picks.outstanding() || action.pending) return; const result = await action.execute({ type: 'task.create', title: title.trim(), description, projectId, ...(autoMode ? { autoMode: true } : {}), ...(attachmentUploads.length === 0 ? {} : { attachmentUploads: attachmentUploads.map(file => ({ name: file.name, origin: file.origin, data: file.data })) }) }); if (result) { const id = creationReceiptId(result, 'task'); if (!id) { setCreationError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The host saved the task but did not return its exact task creation receipt. Close this dialog and inspect or refresh the board before creating another task.' }); return; } if (!result.state.hubs.some(hub => hub.tasks.some(task => task.id === id))) { setCreationError({ code: 'CREATED_TASK_UNAVAILABLE', message: 'The created task is not available in the current board snapshot. Close this dialog and refresh the board before continuing.' }); return; } onCreated(id, { start: startApplies }); onClose(); } }}>
    <label className="kb-field">Title<input className="kb-input" required value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="kb-field">Description<textarea className="kb-input" rows={7} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className="kb-field">Project<select className="kb-input" required disabled={closedForCreation} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="" disabled>Select a project</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
    {closedForCreation && <p className="kb-hint" role="status">This board allows no project, so it accepts no new task. Change its project scope in the board's configuration, from Configuration → Boards.</p>}
    {!closedForCreation && projects.length === 0 && <p className="kb-hint" role="status">No project of this Hub can create a task here yet. Register or adopt a project in Configuration → Projects, or widen this board's project scope.</p>}
    <label className="kb-choice"><input type="checkbox" checked={autoMode} onChange={event => setAutoMode(event.target.checked)} /> Auto mode</label>
    <p className="kb-hint">Advance this task to its next configured stage after each completed turn.</p>
    {hasInstruction && <><label className="kb-choice"><input type="checkbox" checked={start} onChange={event => setStart(event.target.checked)} /> Start execution now</label>
      <p className="kb-hint">Runs the {columnName} instruction after a five-second countdown once the worktree and the first conversation are ready.</p></>}
    <p className="kb-hint">Creates in {columnName}.{startApplies ? '' : ' No agent starts automatically.'}</p>
    <AttachmentFailureNotice failed={picks.failed} message={attachmentFailure} disabled={action.pending} onRetry={picks.retryFailed} onDiscard={picks.discardFailed} />
    <ErrorNotice problem={action.error} /><ErrorNotice problem={creationError} /><div className="kb-actions kb-actions-split">
      <div className="ka-attachment-bar kb-actions-start" role="group" aria-label="Files for this task">
        <AttachButton label="Attach files" buttonRef={attachRef} disabled={action.pending} onPick={files => pickFiles(files, 'upload')} />
        <AttachmentChips attachments={attachmentUploads.map(file => ({ id: file.id, name: file.name, bytes: base64Size(file.data) }))} disabled={action.pending} focusFallback={attachRef} onRemove={id => { setAttachmentUploads(current => current.filter(file => file.id !== id)); }} />
      </div>
      <div className="kb-actions-end">
        <button className="kb-button" type="button" disabled={action.pending} onClick={onClose}>{creationError ? 'Close and inspect board' : 'Cancel'}</button>
        <button className="kb-button kb-primary" disabled={action.pending || Boolean(creationError) || !title.trim() || cannotSave || filesBlocked}>{action.pending ? 'Creating…' : picks.pending > 0 ? 'Reading files…' : 'Create task'}</button>
      </div>
    </div>
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
    {/* Files live with the task text they describe, so the section is the one place
        to see what a task carries and to change it. */}
    <TaskFilesSection task={task} {...(state.boardId === undefined ? {} : { hubId: state.boardId })} run={run} />
  </div>;
  return <form className="kb-form" aria-label="Task information" onSubmit={save}>
    <label className="kb-field">Title<input className="kb-input" required disabled={action.pending} value={draft?.title ?? ''} onChange={event => { if (action.pending) return; draftGeneration.current++; setDraft({ title: event.target.value, description: draft?.description ?? task.description }); setSaved(false); }} /></label>
    <label className="kb-field">Description<textarea className="kb-input" rows={9} disabled={action.pending} value={draft?.description ?? ''} onChange={event => { if (action.pending) return; draftGeneration.current++; setDraft({ title: draft?.title ?? task.title, description: event.target.value }); setSaved(false); }} /></label>
    <ErrorNotice problem={action.error} />
    <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={cancelEdit}>Cancel</button><button className="kb-button kb-primary" disabled={action.pending || !title.trim()}>{action.pending ? 'Saving…' : 'Save task'}</button></div>{saved && <p role="status">Task saved.</p>}
  </form>;
}
