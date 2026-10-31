import type { Project, Task } from '../shared/types.js';
import { ErrorNotice, useAction, type RunCommand } from './ui.js';
import { cleanWorktree, validWorktree, type WorktreeDraft } from './worktree-draft.js';

/** Conversation-area notice with a one-click create path and an explicit Git review path. */
export function WorktreeNotice({ task, project, draft, run, disabled, onReview }: {
  task: Task; project?: Project; draft: WorktreeDraft; run: RunCommand; disabled: boolean; onReview: () => void;
}) {
  const action = useAction(run);
  const value = draft.value;
  const hasPath = Boolean(value.path.trim());
  const source = value.sourceBranch?.trim() || project?.defaultBranch?.trim() || 'HEAD';

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

  return <div className="kb-notice kb-worktree-notice" role="note" aria-label="Worktree not created">
    <strong>No worktree has been created</strong>
    <p>{task.sessionIds.length === 0 ? 'Choose an isolated worktree or continue in the base project before starting the first conversation.' : 'Agents are working in the base project directory. Isolation is optional.'}</p>
    <dl className="kb-worktree-preview">
      <div><dt>Branch</dt><dd><code>{value.branchName || 'Not set'}</code></dd></div>
      <div><dt>Path</dt><dd><code>{value.path || 'No destination configured'}</code></dd></div>
      <div><dt>Source</dt><dd><code>{source}</code></dd></div>
    </dl>
    {draft.suggestionPending && <p className="kb-hint" role="status">Resolving worktree defaults…</p>}
    <ErrorNotice problem={draft.suggestionError} />
    <ErrorNotice problem={action.error} />
    {draft.suggestionError && <button type="button" className="kb-button" disabled={draft.suggestionPending} onClick={draft.reloadSuggestion}>Retry defaults</button>}
    <div className="kb-actions">
      {hasPath
        ? <button type="button" className="kb-button kb-primary" disabled={disabled || action.pending || !validWorktree(value)} onClick={() => void create()}>{action.pending ? 'Preparing…' : 'Create worktree'}</button>
        : <button type="button" className="kb-button kb-primary" onClick={onReview}>Set destination in Git</button>}
      {hasPath && <button type="button" className="kb-button" onClick={onReview}>Review in Git</button>}
      <button type="button" className="kb-button" disabled={disabled || action.pending} onClick={() => void dismiss()}>Continue in base project</button>
    </div>
  </div>;
}
