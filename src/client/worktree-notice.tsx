import type { Project, Task } from '../shared/types.js';
import { isGitProject } from '../shared/project.js';
import { worktreePolicy } from '../shared/worktree-policy.js';
import { ErrorNotice, useAction, type RunCommand } from './ui.js';
import { cleanWorktree, validWorktree, type WorktreeDraft } from './worktree-draft.js';

/**
 * Whether the conversation area shows the missing-worktree notice. A project that never
 * creates worktrees has already answered the question, so it shows no notice.
 */
export function showsWorktreeNotice(task: Pick<Task, 'worktree' | 'worktreeDismissed'>, project: Project | undefined): boolean {
  return project !== undefined
    && isGitProject(project)
    && task.worktree === null
    && task.worktreeDismissed !== true
    && worktreePolicy(project) !== 'never';
}

/** Conversation-area notice with a one-click create path and an explicit Git review path. */
export function WorktreeNotice({ task, project, draft, run, disabled, onReview }: {
  task: Task; project?: Project; draft: WorktreeDraft; run: RunCommand; disabled: boolean; onReview: () => void;
}) {
  const action = useAction(run);
  const policy = worktreePolicy(project);
  // A project that always creates its own worktree has settled the base-project question,
  // so the notice keeps the create and review paths and drops that choice.
  const offersBaseProject = policy !== 'always';
  const value = draft.value;
  const hasPath = Boolean(value.path.trim());
  const source = value.sourceBranch?.trim() || project?.defaultBranch?.trim() || 'HEAD';
  const branch = value.branchName || 'Not set';
  const path = value.path || 'No destination configured';
  const tooltip = 'Branch ' + branch + ' → ' + path + '. Source: ' + source;

  async function create() {
    if (disabled || action.pending || !hasPath) return;
    let next = value;
    if (!draft.branchTouched && !draft.pathTouched) {
      const fresh = await draft.refreshSuggestion();
      if (!fresh) return;
      next = { ...value, branchName: fresh.branchName, path: fresh.path };
    }
    if (!validWorktree(next) || !next.path.trim()) { onReview(); return; }
    await action.execute({ type: 'worktree.create', taskId: task.id, ...cleanWorktree(next) });
  }

  async function dismiss() {
    if (disabled || action.pending) return;
    await action.execute({ type: 'worktree.dismiss', taskId: task.id });
  }

  return <div className="kb-notice kb-worktree-line" role="note" aria-label="Worktree not created">
    <div className="kb-worktree-line-summary" title={tooltip}>
      <strong>No worktree</strong>
      <span className="kb-worktree-line-facts">
        <code>{branch}</code>
        <span aria-hidden="true"> → </span>
        <code>{path}</code>
      </span>
    </div>
    {policy === 'always' && <p className="kb-hint">This project creates a worktree for its tasks by default.</p>}
    {draft.suggestionPending && <p className="kb-hint" role="status">Resolving worktree defaults…</p>}
    <ErrorNotice problem={draft.suggestionError} />
    <ErrorNotice problem={action.error} />
    {draft.suggestionError && <button type="button" className="kb-button" disabled={draft.suggestionPending} onClick={draft.reloadSuggestion}>Retry defaults</button>}
    <div className="kb-actions kb-worktree-line-actions">
      {hasPath
        ? <button type="button" className="kb-button kb-primary" disabled={disabled || action.pending || !validWorktree(value)} onClick={() => void create()}>{action.pending ? 'Preparing…' : 'Create worktree'}</button>
        : <button type="button" className="kb-button kb-primary" onClick={onReview}>Set destination in Git</button>}
      {hasPath && <button type="button" className="kb-button" onClick={onReview}>Review in Git</button>}
      {offersBaseProject && <button type="button" className="kb-button" disabled={disabled || action.pending} onClick={() => void dismiss()}>Continue in base project</button>}
    </div>
  </div>;
}
