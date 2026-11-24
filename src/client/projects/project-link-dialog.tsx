import React, { useState } from 'react';
import type { Board, Problem, Project, PublishedProject } from '../../shared/types.js';
import { isRegisteredProject } from '../../shared/project.js';
import { publishedIdentityOf } from '../../domain/board-project-scope.js';
import { ErrorNotice, Modal, useAction, type RunCommand } from '../ui.js';

/**
 * Link one identity a team board names to a project this Hub already registered.
 *
 * Linking writes the project's published key, so the team's boards allow it without
 * that project being renamed and without any scope being rewritten by hand. The
 * confirmation names the boards that follow, because a board still naming the
 * project's previous identity has its scope rewritten in the same save.
 */
export function ProjectLinkDialog({ placeholder, candidates, boards, revision, run, onClose, onLinked }: {
  placeholder: PublishedProject;
  candidates: readonly Project[];
  boards: readonly Board[];
  revision: number;
  run: RunCommand;
  onClose: () => void;
  onLinked: (projectId: string) => void;
}) {
  const identity = publishedIdentityOf(placeholder);
  const registered = candidates.filter(isRegisteredProject);
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<Problem | null>(null);
  const action = useAction(run);
  const chosen = registered.find(project => project.id === projectId);
  const previous = chosen === undefined ? null : publishedIdentityOf(chosen);
  const following = previous === null ? [] : boards.filter(board => board.allowedProjectKeys?.includes(previous) === true).map(board => board.name);
  async function link(): Promise<void> {
    if (chosen === undefined) return;
    setError(null);
    const input = {
      id: chosen.id,
      name: chosen.name,
      projectPath: chosen.projectPath,
      publishedKey: identity,
      ...(chosen.gitRootPath === undefined ? {} : { gitRootPath: chosen.gitRootPath }),
      ...(chosen.gitRootPath === undefined || chosen.defaultBranch === undefined ? {} : { defaultBranch: chosen.defaultBranch }),
      ...(chosen.worktreePolicy === undefined ? {} : { worktreePolicy: chosen.worktreePolicy }),
    };
    const result = await action.execute({ type: 'project.save', project: input, expectedRevision: revision });
    if (result === null) return;
    onLinked(chosen.id);
  }
  return <Modal title={'Link ' + placeholder.name + ' to a project'} onClose={onClose} busy={action.pending} initialFocus="cancel">
    <div className="kb-form" aria-label="Link a received project to an existing project">
      <p>Boards name this project by <code>{identity}</code>. Linking an existing project makes those boards allow it without renaming anything.</p>
      <label className="kb-field">Project<select className="kb-input" required aria-label="Project to link" value={projectId} disabled={action.pending} onChange={event => { setProjectId(event.target.value); setError(null); }}><option value="">Select a project</option>{registered.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      {registered.length === 0 && <p className="kb-hint" role="status">This Hub has no registered project to link. Adopt the identity by choosing its directory instead.</p>}
      {chosen !== undefined && <>
        <div className="kb-destructive-identity"><code>{previous ?? identity}</code><span className="kb-hint">becomes</span><code>{identity}</code></div>
        <ul className="kb-batch-list">
          <li>{chosen.name} keeps its name, its local key, and its directories.</li>
          <li>Every board that names <code>{identity}</code> allows {chosen.name} from now on.</li>
          {following.length > 0 && <li>{following.length === 1 ? 'One board scope is rewritten' : String(following.length) + ' board scopes are rewritten'} to name <code>{identity}</code>: {following.join(', ')}.</li>}
        </ul>
      </>}
      <ErrorNotice problem={error ?? action.error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={action.pending} onClick={onClose}>Cancel</button>
        <button type="button" className="kb-button kb-primary" disabled={action.pending || chosen === undefined} onClick={() => void link()}>{action.pending ? 'Linking…' : 'Link project'}</button>
      </div>
    </div>
  </Modal>;
}
