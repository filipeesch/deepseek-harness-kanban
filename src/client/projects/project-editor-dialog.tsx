import React from 'react';
import type { ClientApi, Project, ProjectLocation } from '../../shared/types.js';
import { ErrorNotice, Modal, type RunCommand } from '../ui.js';
import { canSaveProject, type ProjectDraft } from './project-draft.js';
import { useProjectEditor } from './use-project-editor.js';

/** Focused create/edit surface; the registry list never embeds a form. */
export function ProjectEditorDialog({ api, hubId, expectedRevision, project, run, onClose, onSaved }: {
  api?: ClientApi;
  hubId?: string;
  expectedRevision?: number;
  project?: Project;
  run: RunCommand;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const editor = useProjectEditor({ api, hubId, expectedRevision, project, run, onClose, onSaved });
  const { draft, detection } = editor;
  const title = project === undefined ? 'New project' : 'Edit project';
  return <Modal title={title} onClose={editor.cancel} busy={editor.pending}>
    <form className="kb-form" aria-label={title} aria-busy={editor.pending} onSubmit={event => { event.preventDefault(); void editor.save(); }}>
      <label className="kb-field">Project name<input className="kb-input" required aria-label="Project name" disabled={editor.pending} value={draft.name} onChange={event => editor.change('name', event.target.value)} /></label>
      <label className="kb-field">Project path
        <div className="kb-input-row">
          <input className="kb-input" required aria-label="Project path" disabled={editor.pending} value={draft.projectPath} onChange={event => editor.change('projectPath', event.target.value)} onBlur={() => editor.blurPath()} />
          <button type="button" className="kb-button" aria-label="Browse for project path" disabled={editor.pending || !editor.canBrowse || editor.picking} onClick={() => void editor.browse()}>{editor.picking ? 'Choosing…' : 'Browse…'}</button>
        </div>
      </label>
      {!editor.canBrowse && <p className="kb-hint">No folder picker is available in this host; type an absolute path instead.</p>}
      <DetectionCard detection={detection} draft={draft} />
      <label className="kb-field">Git root<input className="kb-input" aria-label="Git root" disabled={editor.pending} value={draft.gitRootPath} onChange={event => editor.change('gitRootPath', event.target.value)} /></label>
      <label className="kb-field">Default branch (optional)<input className="kb-input" aria-label="Default branch (optional)" disabled={editor.pending} value={draft.defaultBranch} onChange={event => editor.change('defaultBranch', event.target.value)} /></label>
      <p className="kb-hint">Detection only suggests the Git root and default branch; both stay editable. Leave the Git root empty to register a plain folder project. The project path can be a subdirectory of the Git root.</p>
      <ErrorNotice problem={editor.error} />
      <div className="kb-actions">
        <button type="button" className="kb-button" disabled={editor.pending} onClick={editor.cancel}>Cancel</button>
        <button className="kb-button kb-primary" disabled={editor.pending || editor.blocked || !canSaveProject(draft)}>{editor.pending ? 'Saving…' : 'Save project'}</button>
      </div>
    </form>
  </Modal>;
}

function DetectionCard({ detection, draft }: { detection: ProjectLocation | null; draft: ProjectDraft }) {
  if (detection === null) return <div className="kb-detection" role="status"><strong>Detection</strong><span className="kb-hint">Choose or type a project folder to detect its Git repository.</span></div>;
  const hasGitRoot = draft.gitRootPath.trim().length > 0;
  if (detection.kind === 'folder') return <div className={'kb-detection' + (hasGitRoot ? '' : ' kb-detection-folder')} role="status">
    <strong>No Git repository found</strong>
    <span className="kb-hint">{hasGitRoot ? 'A Git root is still set, so saving registers this project as Git-backed. Clear it to register a plain folder.' : 'Leaving the Git root empty registers a plain folder project. Worktrees and Git actions stay unavailable.'}</span>
  </div>;
  return <div className="kb-detection kb-detection-git" role="status">
    <strong>Git repository</strong>
    <code>{detection.gitRootPath}</code>
    <span className="kb-hint">{hasGitRoot ? (detection.defaultBranch === undefined ? 'No default branch detected.' : 'Suggested default branch: ' + detection.defaultBranch) : 'The Git root is empty, so saving registers a plain folder project.'}</span>
  </div>;
}
