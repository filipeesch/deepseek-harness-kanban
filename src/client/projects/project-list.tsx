import React, { useState } from 'react';
import type { Project, Task } from '../../shared/types.js';
import { isGitProject, isPublishedProject } from '../../shared/project.js';
import { useAction, type RunCommand } from '../ui.js';

function relocationLabel(project: Project): string | null {
  const operation = project.operation;
  if (!operation) return null;
  if (operation.phase === 'failed') return operation.error?.message ?? 'The relocation failed.';
  if (operation.phase === 'waiting') return 'Waiting for current work to finish.';
  if (operation.phase === 'queued' || operation.phase === 'preflight') return 'Queued.';
  return 'Relocating…';
}

function canCancelRelocation(project: Project): boolean {
  const phase = project.operation?.phase;
  return (phase === 'queued' || phase === 'preflight' || phase === 'waiting') && project.operation?.started !== true;
}

/** Registry list: management only; creation and editing live in the dialog. */
export function ProjectList({ projects, tasks, revision, run, onAdd, onEdit }: {
  projects: Project[];
  tasks: Task[];
  revision: number;
  run: RunCommand;
  onAdd: () => void;
  onEdit: (project: Project) => void;
}) {
  const action = useAction(run);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  async function remove(project: Project): Promise<void> {
    const result = await action.execute({ type: 'project.delete', projectId: project.id, confirmed: true, expectedRevision: revision });
    if (result === null) return;
    setDeleting(null); setDeleted(true);
  }

  async function retryRelocation(project: Project): Promise<void> {
    await action.execute({ type: 'project.relocationRetry', projectId: project.id });
  }

  async function cancelRelocation(project: Project): Promise<void> {
    await action.execute({ type: 'project.relocationCancel', projectId: project.id });
  }

  return <div className="kb-form">
    <div className="kb-row"><h3>Projects</h3><button className="kb-button" type="button" disabled={action.pending} onClick={onAdd}>New project</button></div>
    {deleted && <p role="status">Project deleted.</p>}
    <ul className="kb-project-list">{projects.map(project => {
      const used = tasks.some(task => task.projectId === project.id);
      const gitBacked = isGitProject(project);
      return <li key={project.id}>
        <strong>{project.name}</strong><span className="kb-hint">{project.projectPath ?? 'No directory yet; edit to adopt this published project.'}</span>
        <span className={'kb-badge ' + (gitBacked ? 'kb-badge-git' : 'kb-badge-folder')}>{isPublishedProject(project) ? 'Awaiting adoption' : gitBacked ? 'Git' : 'Folder'}</span>
        {project.operation && <span className="kb-hint" role={project.operation.phase === 'failed' ? 'alert' : 'status'}>{relocationLabel(project)}</span>}
        {project.operation?.phase === 'failed' && <button className="kb-button" type="button" aria-label={'Retry relocation of ' + project.name} disabled={action.pending} onClick={() => void retryRelocation(project)}>Retry relocation</button>}
        {canCancelRelocation(project) && <button className="kb-button" type="button" aria-label={'Cancel relocation of ' + project.name} disabled={action.pending} onClick={() => void cancelRelocation(project)}>Cancel relocation</button>}
        <button className="kb-button" type="button" aria-label={'Edit project ' + project.name} disabled={action.pending} onClick={() => onEdit(project)}>Edit</button>
        <button className="kb-button kb-danger" type="button" aria-label={'Delete project ' + project.name} disabled={action.pending || used || project.operation !== undefined} title={project.operation ? 'Resolve the project relocation first.' : used ? 'Move or delete the tasks in this project first.' : 'Delete this project registration'} onClick={() => { setDeleting(project.id); setDeleted(false); }}>Delete</button>
        {deleting === project.id && <div className="kb-inline-confirm" role="alertdialog" aria-label={'Confirm deleting project ' + project.name}><p>Delete <strong>{project.name}</strong>? The project registration is removed; files and native workspaces are kept.</p><div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="kb-button kb-danger" disabled={action.pending} onClick={() => void remove(project)}>{action.pending ? 'Deleting…' : 'Delete project'}</button></div></div>}
      </li>;
    })}</ul>
    {projects.length === 0 && <p className="kb-hint">No projects in this Hub yet.</p>}
    {action.error !== null && <div className="kb-error" role="alert"><strong>{action.error.code}</strong><span>{action.error.message}</span></div>}
  </div>;
}
