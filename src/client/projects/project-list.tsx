import React, { useState } from 'react';
import type { Board, Project, PublishedProject, Task } from '../../shared/types.js';
import { isGitProject, isPublishedProject } from '../../shared/project.js';
import { publishedIdentityOf } from '../../domain/board-project-scope.js';
import { useAction, type RunCommand } from '../ui.js';
import { ProjectLinkDialog } from './project-link-dialog.js';

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

/** The boards whose scope names one identity, as names for one sentence. */
function boardsNaming(boards: readonly Board[], identity: string): string[] {
  return boards.filter(board => board.allowedProjectKeys?.includes(identity) === true).map(board => board.name);
}

/**
 * Registry list: management only; creation and editing live in the dialog.
 *
 * A project a team board names but this Hub cannot answer is presented first, because
 * it is the only row that blocks nothing but needs a person: it can be adopted by
 * choosing its directory, linked to a project that already exists, or ignored. Ignored
 * identities keep their place in every board scope and are listed apart so restoring
 * one is always reachable.
 */
export function ProjectList({ projects, boards, tasks, revision, run, onAdd, onEdit, onLinked }: {
  projects: Project[];
  boards: readonly Board[];
  tasks: Task[];
  revision: number;
  run: RunCommand;
  onAdd: () => void;
  onEdit: (project: Project) => void;
  onLinked?: (projectId: string) => void;
}) {
  const action = useAction(run);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [linking, setLinking] = useState<PublishedProject | null>(null);
  const awaiting = projects.filter((project): project is PublishedProject => isPublishedProject(project) && project.dismissed !== true);
  const ignored = projects.filter((project): project is PublishedProject => isPublishedProject(project) && project.dismissed === true);
  const registered = projects.filter(project => !isPublishedProject(project));
  // One stable presentation order: the rows a person must act on first, then the
  // registry in its stored order.
  const order = [...awaiting, ...registered];

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

  async function dismiss(project: PublishedProject, dismissed: boolean): Promise<void> {
    const result = await action.execute({ type: 'project.dismiss', projectId: project.id, dismissed, expectedRevision: revision });
    if (result === null) return;
    setIgnoring(null);
  }

  function rowActions(project: PublishedProject, identity: string, named: string[]) {
    return <>
      <span className="kb-hint">No directory yet · {identity}{named.length === 0 ? '' : ' · Named by: ' + named.join(', ')}</span>
      <span className="kb-badge kb-badge-folder">{project.dismissed === true ? 'Ignored' : 'Awaiting adoption'}</span>
      {project.dismissed === true
        ? <button type="button" className="kb-button" aria-label={'Restore ' + project.name} disabled={action.pending} onClick={() => void dismiss(project, false)}>Restore</button>
        : <>
            <button type="button" className="kb-button kb-primary" aria-label={'Adopt ' + project.name} disabled={action.pending} onClick={() => onEdit(project)}>Adopt</button>
            <button type="button" className="kb-button" aria-label={'Link ' + project.name + ' to a project'} disabled={action.pending || registered.length === 0} title={registered.length === 0 ? 'Register or adopt a project first.' : 'Link this identity to a project you already registered.'} onClick={() => { action.clearError(); setLinking(project); }}>Link to a project…</button>
            <button type="button" className="kb-button kb-danger" aria-label={'Ignore ' + project.name} disabled={action.pending} onClick={() => { setDeleted(false); setIgnoring(project.id); }}>Ignore</button>
          </>}
    </>;
  }

  return <div className="kb-form">
    <div className="kb-row"><h3>Projects</h3><button className="kb-button" type="button" disabled={action.pending} onClick={onAdd}>New project</button></div>
    {deleted && <p role="status">Project deleted.</p>}
    {awaiting.length > 0 && <p className="kb-hint" role="status">{awaiting.length === 1 ? 'One project awaits adoption.' : String(awaiting.length) + ' projects await adoption.'} A board or an imported workflow names it, and this Hub has no directory for it yet. Adopt one by choosing its directory, or link it to a project you already have. Cards already on a board keep working; creating a new task on a board needs a project that board allows.</p>}
    <ul className="kb-project-list">{order.map(project => {
      if (isPublishedProject(project)) {
        const identity = publishedIdentityOf(project);
        const named = boardsNaming(boards, identity);
        return <li key={project.id}>
          <strong>{project.name}</strong>
          {rowActions(project, identity, named)}
          {ignoring === project.id && <div className="kb-inline-confirm" role="alertdialog" aria-label={'Confirm ignoring ' + project.name}>
            <p>Ignore <strong>{project.name}</strong>? The team's boards keep naming <code>{identity}</code> and this installation stops asking. Restore it here later.</p>
            <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={() => setIgnoring(null)}>Cancel</button><button type="button" className="kb-button kb-danger" disabled={action.pending} onClick={() => void dismiss(project, true)}>{action.pending ? 'Ignoring…' : 'Ignore project'}</button></div>
          </div>}
        </li>;
      }
      const used = tasks.some(task => task.projectId === project.id);
      const gitBacked = isGitProject(project);
      return <li key={project.id}>
        <strong>{project.name}</strong><span className="kb-hint">{project.projectPath}{project.publishedKey === undefined ? '' : ' · Team key: ' + project.publishedKey}</span>
        <span className={'kb-badge ' + (gitBacked ? 'kb-badge-git' : 'kb-badge-folder')}>{gitBacked ? 'Git' : 'Folder'}</span>
        {project.operation && <span className="kb-hint" role={project.operation.phase === 'failed' ? 'alert' : 'status'}>{relocationLabel(project)}</span>}
        {project.operation?.phase === 'failed' && <button className="kb-button" type="button" aria-label={'Retry relocation of ' + project.name} disabled={action.pending} onClick={() => void retryRelocation(project)}>Retry relocation</button>}
        {canCancelRelocation(project) && <button className="kb-button" type="button" aria-label={'Cancel relocation of ' + project.name} disabled={action.pending} onClick={() => void cancelRelocation(project)}>Cancel relocation</button>}
        <button className="kb-button" type="button" aria-label={'Edit project ' + project.name} disabled={action.pending} onClick={() => onEdit(project)}>Edit</button>
        <button className="kb-button kb-danger" type="button" aria-label={'Delete project ' + project.name} disabled={action.pending || used || project.operation !== undefined} title={project.operation ? 'Resolve the project relocation first.' : used ? 'Move or delete the tasks in this project first.' : 'Delete this project registration'} onClick={() => { setDeleting(project.id); setDeleted(false); }}>Delete</button>
        {deleting === project.id && <div className="kb-inline-confirm" role="alertdialog" aria-label={'Confirm deleting project ' + project.name}><p>Delete <strong>{project.name}</strong>? The project registration is removed; files and native workspaces are kept.</p><div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="kb-button kb-danger" disabled={action.pending} onClick={() => void remove(project)}>{action.pending ? 'Deleting…' : 'Delete project'}</button></div></div>}
      </li>;
    })}</ul>
    {registered.length === 0 && awaiting.length === 0 && <p className="kb-hint">No projects in this Hub yet.</p>}
    {ignored.length > 0 && <section className="kb-project-ignored" aria-label="Ignored project identities">
      <h4>Ignored project identities</h4>
      <p className="kb-hint">These identities stay in the board scopes. Restore one to adopt it, or create a project that uses its key to bind it.</p>
      <ul className="kb-project-list">{ignored.map(project => {
        const identity = publishedIdentityOf(project);
        const named = boardsNaming(boards, identity);
        return <li key={project.id}>
          <strong>{project.name}</strong>
          {rowActions(project, identity, named)}
        </li>;
      })}</ul>
    </section>}
    {action.error !== null && <div className="kb-error" role="alert"><strong>{action.error.code}</strong><span>{action.error.message}</span></div>}
    {linking !== null && <ProjectLinkDialog
      placeholder={linking}
      candidates={registered}
      boards={boards}
      revision={revision}
      run={run}
      onClose={() => setLinking(null)}
      onLinked={projectId => { setLinking(null); onLinked?.(projectId); }}
    />}
  </div>;
}
