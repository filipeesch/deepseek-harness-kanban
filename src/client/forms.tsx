import React, { useEffect, useId, useRef, useState } from 'react';
import type { BoardState, ClientApi, Problem, Project, Task } from '../shared/types.js';
import { creationReceiptId, ErrorNotice, Markdown, Modal, Tabs, useAction, type RunCommand } from './ui.js';
import { WorkflowEditor } from './workflow-editor.js';
import { createTaskPageState, usePageField, type TaskPageState } from './page-state.js';
import { worktreePathForBranch } from '../shared/worktree-name.js';

export function NewTaskDialog({ state, run, onClose, onCreated }: { state: BoardState; run: RunCommand; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(state.projects[0]?.id ?? ''); const action = useAction(run); const [creationError, setCreationError] = useState<Problem | null>(null);
  return <Modal title="New task" onClose={onClose} busy={action.pending}><form className="kb-form" onSubmit={async event => { event.preventDefault(); if (!title.trim() || !projectId || creationError) return; const result = await action.execute({ type: 'task.create', title: title.trim(), description, projectId }); if (result) { const id = creationReceiptId(result, 'task'); if (!id) { setCreationError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The host saved the task but did not return its exact task creation receipt. Close this dialog and inspect or refresh the board before creating another task.' }); return; } if (!result.state.tasks.some(task => task.id === id)) { setCreationError({ code: 'CREATED_TASK_UNAVAILABLE', message: 'The created task is not available in the current board snapshot. Close this dialog and refresh the board before continuing.' }); return; } onCreated(id); onClose(); } }}>
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

export function Configuration({ state, run, api, pickDirectory, onClose, initial = 'General' }: { state: BoardState; run: RunCommand; api?: ClientApi; pickDirectory?: () => Promise<string | null>; onClose: () => void; initial?: string }) {
  const [section, setSection] = useState(initial); const id = useId();
  const [workflowDraft, setWorkflowDraft] = useState<{ yaml: string; revision: number } | null>(null);
  const [closePending, setClosePending] = useState(false);
  const dirty = workflowDraft !== null && workflowDraft.yaml !== state.workflowYaml;
  useEffect(() => { if (!dirty) setClosePending(false); }, [dirty]);
  function requestClose() {
    if (closePending) { setClosePending(false); return; }
    if (dirty) { setClosePending(true); return; }
    onClose();
  }
  return <Modal title="Kanban configuration" onClose={requestClose} size={section === 'Workflow' ? 'wide' : 'default'}>
    <Tabs label="Configuration sections" values={['General', 'Projects', 'Workflow']} selected={section} onSelect={setSection} id={id} />
    {closePending && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard workflow changes">
      <p>You have unsaved workflow changes. Discard them and close configuration?</p>
      <div className="kb-actions"><button type="button" className="kb-button" onClick={() => setClosePending(false)}>Keep editing</button><button type="button" className="kb-button kb-danger" onClick={onClose}>Discard and close</button></div>
    </div>}
    <section className="kb-panel" role="tabpanel" id={id + '-panel-' + section} aria-labelledby={id + '-tab-' + section}>
      {section === 'General' ? <General state={state} run={run} pickDirectory={pickDirectory} /> : section === 'Projects' ? <Projects state={state} run={run} api={api} pickDirectory={pickDirectory} /> : <WorkflowEditor state={state} run={run} yaml={workflowDraft?.yaml ?? state.workflowYaml} baseRevision={workflowDraft?.revision ?? state.revision} onYamlChange={yaml => setWorkflowDraft(current => current ? { ...current, yaml } : { yaml, revision: state.revision })} onSaved={() => setWorkflowDraft(null)} onReload={() => setWorkflowDraft(null)} />}
    </section>
  </Modal>;
}

function General({ state, run, pickDirectory }: { state: BoardState; run: RunCommand; pickDirectory?: () => Promise<string | null> }) {
  const stored = state.settings?.worktreeBasePath ?? '';
  const [basePath, setBasePath] = useState(stored); const [revision, setRevision] = useState(state.revision); const [saved, setSaved] = useState(false); const [browseError, setBrowseError] = useState<Problem | null>(null); const action = useAction(run);
  const draftGeneration = useRef(0);
  useEffect(() => () => { draftGeneration.current++; }, []);
  const change = (value: string) => { if (action.pending) return; draftGeneration.current++; setBasePath(value); setSaved(false); };
  async function browse() {
    if (!pickDirectory) return;
    setBrowseError(null);
    let picked: string | null;
    try { picked = await pickDirectory(); }
    catch (error) { setBrowseError({ code: 'DIRECTORY_PICKER_FAILED', message: error instanceof Error ? error.message : 'The directory picker could not open.' }); return; }
    if (picked) change(picked);
  }
  function reload() { if (action.pending) return; draftGeneration.current++; setBasePath(stored); setRevision(state.revision); setSaved(false); action.clearError(); }
  const example = worktreePathForBranch(basePath.trim(), 'fix-login');
  return <form className="kb-form" aria-label="General settings" onSubmit={async event => {
    event.preventDefault(); if (action.pending) return;
    const generation = draftGeneration.current; const path = basePath.trim();
    const result = await action.execute({ type: 'settings.save', settings: path ? { worktreeBasePath: path } : {}, expectedRevision: revision });
    if (!result || generation !== draftGeneration.current) return;
    setBasePath(result.state.settings?.worktreeBasePath ?? ''); setRevision(result.state.revision); setSaved(true);
  }}>
    <h3>Worktree base path</h3>
    <label className="kb-field">Worktree base path<div className="kb-input-row"><input className="kb-input" aria-label="Worktree base path" disabled={action.pending} value={basePath} placeholder="Absolute path for task worktrees" onChange={event => change(event.target.value)} /><button type="button" className="kb-button" aria-label="Browse for worktree base path" disabled={action.pending || !pickDirectory} onClick={() => void browse()}>Browse…</button></div></label>
    <p className="kb-hint">New task worktrees default to this directory plus the branch name. Leave empty to enter each task's destination manually.</p>
    <p className="kb-hint">Example default: <code>{example || '<base path>/fix-login'}</code></p>
    <p className="kb-hint">Existing worktrees keep their current paths when this setting changes. A base path inside a repository is allowed; its worktrees appear as untracked content.</p>
    <ErrorNotice problem={action.error} /><ErrorNotice problem={browseError} />
    <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={reload}>Reload saved settings</button><button className="kb-button kb-primary" disabled={action.pending}>{action.pending ? 'Saving…' : 'Save settings'}</button></div>
    {saved && <p role="status">Settings saved.</p>}
  </form>;
}

function Projects({ state, run, api, pickDirectory }: { state: BoardState; run: RunCommand; api?: ClientApi; pickDirectory?: () => Promise<string | null> }) {
  const [selected, setSelected] = useState<string | null>(null); const [name, setName] = useState(''); const [projectPath, setProjectPath] = useState(''); const [gitRootPath, setGitRootPath] = useState(''); const [defaultBranch, setDefaultBranch] = useState('');
  const [revision, setRevision] = useState(state.revision); const [saved, setSaved] = useState(false); const [deleted, setDeleted] = useState(false); const [deleting, setDeleting] = useState<string | null>(null); const [browseError, setBrowseError] = useState<Problem | null>(null); const action = useAction(run); const [creationError, setCreationError] = useState<Problem | null>(null);
  const draftGeneration = useRef(0);
  useEffect(() => () => { draftGeneration.current++; }, []);
  const changeDraft = (change: () => void) => { if (action.pending) return; draftGeneration.current++; change(); setSaved(false); };
  const load = (project?: Project) => { if (action.pending) return; draftGeneration.current++; setSelected(project?.id ?? null); setName(project?.name ?? ''); setProjectPath(project?.projectPath ?? ''); setGitRootPath(project?.gitRootPath ?? ''); setDefaultBranch(project?.defaultBranch ?? ''); setRevision(state.revision); setSaved(false); setDeleted(false); setDeleting(null); setCreationError(null); action.clearError(); };
  async function browse() {
    if (!pickDirectory || !api) return;
    setBrowseError(null);
    let picked: string | null;
    try { picked = await pickDirectory(); }
    catch (error) { setBrowseError({ code: 'DIRECTORY_PICKER_FAILED', message: error instanceof Error ? error.message : 'The directory picker could not open.' }); return; }
    if (!picked) return;
    setProjectPath(picked);
    try {
      const inferred = await api.inferProject(picked);
      setProjectPath(inferred.projectPath); setGitRootPath(inferred.gitRootPath);
      if (!name.trim()) setName(inferred.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
    } catch (error) { setBrowseError({ code: 'PROJECT_INFERENCE_FAILED', message: error instanceof Error ? error.message : 'The Git root could not be inferred.' }); }
  }
  async function remove(project: Project) {
    const result = await action.execute({ type: 'project.delete', projectId: project.id, confirmed: true, expectedRevision: state.revision });
    if (!result) return;
    setDeleting(null); setDeleted(true); setRevision(result.state.revision);
    if (selected === project.id) { setSelected(null); setName(''); setProjectPath(''); setGitRootPath(''); setDefaultBranch(''); }
  }
  return <div className="kb-form">
    <div className="kb-row"><h3>Projects</h3><button className="kb-button" type="button" disabled={action.pending} onClick={() => load()}>New project</button></div>
    <ul className="kb-project-list">{state.projects.map(project => {
      const used = state.tasks.some(task => task.projectId === project.id);
      return <li key={project.id}>
        <strong>{project.name}</strong><span className="kb-hint">{project.projectPath}</span>
        <button className="kb-button" type="button" aria-label={'Edit project ' + project.name} disabled={action.pending} onClick={() => load(project)}>Edit</button>
        <button className="kb-button kb-danger" type="button" aria-label={'Delete project ' + project.name} disabled={action.pending || used} title={used ? 'Move or delete the tasks in this project first.' : 'Delete this project registration'} onClick={() => { setDeleting(project.id); setDeleted(false); }}>Delete</button>
        {deleting === project.id && <div className="kb-inline-confirm" role="alertdialog" aria-label={'Confirm deleting project ' + project.name}><p>Delete <strong>{project.name}</strong>? The project registration is removed; files and native workspaces are kept.</p><div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="kb-button kb-danger" disabled={action.pending} onClick={() => void remove(project)}>{action.pending ? 'Deleting…' : 'Delete project'}</button></div></div>}
      </li>;
    })}</ul>
    <form className="kb-form" aria-label={selected ? 'Edit project' : 'New project'} aria-busy={action.pending} onSubmit={async event => { event.preventDefault(); if (!name.trim() || !projectPath.trim() || !gitRootPath.trim() || creationError || action.pending) return; const generation = draftGeneration.current; const result = await action.execute({ type: 'project.save', project: { ...(selected ? { id: selected } : {}), name: name.trim(), projectPath: projectPath.trim(), gitRootPath: gitRootPath.trim(), ...(defaultBranch.trim() ? { defaultBranch: defaultBranch.trim() } : {}) }, expectedRevision: revision }); if (generation !== draftGeneration.current) return; if (result) { const id = selected ?? creationReceiptId(result, 'project'); if (!id) { setCreationError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The host saved the project but did not return its exact project creation receipt. Select the saved project explicitly from the list or refresh before saving again.' }); return; } if (!result.state.projects.some(project => project.id === id)) { setCreationError({ code: 'CREATED_PROJECT_UNAVAILABLE', message: 'The saved project is not available in the current list. Refresh and select the saved project explicitly before saving again.' }); return; } setSelected(id); setRevision(result.state.revision); setSaved(true); } }}>
      <h3>{selected ? 'Edit project' : 'New project'}</h3><label className="kb-field">Project name<input className="kb-input" required disabled={action.pending} value={name} onChange={event => changeDraft(() => setName(event.target.value))} /></label>
      <label className="kb-field">Project path<div className="kb-input-row"><input className="kb-input" aria-label="Project path" required disabled={action.pending} value={projectPath} onChange={event => changeDraft(() => setProjectPath(event.target.value))} /><button type="button" className="kb-button" aria-label="Browse for project path" disabled={action.pending || !pickDirectory || !api} onClick={() => void browse()}>Browse…</button></div></label><label className="kb-field">Git root<input className="kb-input" required disabled={action.pending} value={gitRootPath} onChange={event => changeDraft(() => setGitRootPath(event.target.value))} /></label><p className="kb-hint">The project path can be a subdirectory of the Git root. Agents work in the project path, including its equivalent subdirectory in a worktree.</p>
      <label className="kb-field">Default branch (optional)<input className="kb-input" disabled={action.pending} value={defaultBranch} onChange={event => changeDraft(() => setDefaultBranch(event.target.value))} /></label><ErrorNotice problem={action.error} /><ErrorNotice problem={creationError} /><ErrorNotice problem={browseError} /><button className="kb-button kb-primary" disabled={action.pending || Boolean(creationError) || !name.trim() || !projectPath.trim() || !gitRootPath.trim()}>{action.pending ? 'Saving…' : 'Save project'}</button>{saved && <p role="status">Project saved.</p>}{deleted && <p role="status">Project deleted.</p>}
    </form>
  </div>;
}


export function NotesPanel(props: TaskPanelProps) { return <NotesEditor key={props.task.id} {...props} />; }

function NotesEditor({ task, state, run }: TaskPanelProps) {
  const notes = state.notes.filter(note => note.taskId === task.id); const [noteId, setNoteId] = useState<string | undefined>(); const [content, setContent] = useState(''); const [saved, setSaved] = useState(false); const action = useAction(run);
  const draftGeneration = useRef(0);
  useEffect(() => () => { draftGeneration.current++; }, []);
  return <div className="kb-form"><p className="kb-hint">Notes belong to this task and are shared by all of its conversations.</p><div className="kb-row"><h3>Shared notes</h3><button className="kb-button" type="button" disabled={action.pending} onClick={() => { if (action.pending) return; draftGeneration.current++; setNoteId(undefined); setContent(''); setSaved(false); action.clearError(); }}>New note</button></div>{notes.length === 0 && <p>No notes yet.</p>}<ul className="kb-note-list">{notes.map(note => <li className="kb-note" key={note.id}><Markdown>{note.content}</Markdown>{note.tags?.length ? <p className="kb-hint">{note.tags.join(', ')}</p> : null}<button className="kb-button" type="button" aria-label={'Edit note ' + note.id} disabled={action.pending} onClick={() => { if (action.pending) return; draftGeneration.current++; setNoteId(note.id); setContent(note.content); setSaved(false); action.clearError(); }}>Edit note</button></li>)}</ul><form className="kb-form" onSubmit={async event => { event.preventDefault(); if (action.pending || !content.trim()) return; const generation = draftGeneration.current; const result = await action.execute({ type: 'note.save', taskId: task.id, ...(noteId ? { noteId } : {}), content }); if (result && generation === draftGeneration.current) { setContent(''); setNoteId(undefined); setSaved(true); } }}><label className="kb-field">{noteId ? 'Edit note Markdown' : 'New note Markdown'}<textarea className="kb-input" rows={6} disabled={action.pending} value={content} onChange={event => { if (action.pending) return; draftGeneration.current++; setContent(event.target.value); setSaved(false); }} /></label><ErrorNotice problem={action.error} /><button className="kb-button kb-primary" disabled={action.pending || !content.trim()}>{action.pending ? 'Saving…' : 'Save note'}</button>{saved && <p role="status">Note saved for all task conversations.</p>}</form></div>;
}
