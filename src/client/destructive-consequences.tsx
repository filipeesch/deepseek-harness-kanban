import React from 'react';
import type { Project, Task } from '../shared/types.js';
import { isGitProject } from '../shared/project.js';
import type { DestructiveRequest } from './destructive-dialogs.js';

/** The single deletion/removal consequence list shared by destructive dialogs. */
export function DestructiveConsequences({ request, task, project, busy = false }: { request: DestructiveRequest; task: Task; project?: Project; busy?: boolean }) {
  const isDelete = request.command.type === 'task.delete';
  const conversations = task.sessionIds.length;
  const closed = task.closedSessionIds.length;
  const unclaimed = task.unclaimedWorktrees ?? [];
  const plainCheckout = project !== undefined && !isGitProject(project) && Boolean(request.path);
  const detached = request.branch === 'HEAD';
  return <ul className="kb-consequence-list">
    {isDelete ? <>
      <li>Card and notes are deleted. This cannot be undone.</li>
      <li>{conversations} conversation{conversations === 1 ? '' : 's'}{closed > 0 ? ' (' + closed + ' closed)' : ''} will be archived; their histories remain in DSH.</li>
    </> : <>
      <li>The task, its notes, conversations, histories, and Git branch are kept.</li>
      <li>All conversations return to the project before worktree cleanup.</li>
    </>}
    {request.path
      ? plainCheckout
        ? <li>The checkout at <code>{request.path}</code> is no longer Git-managed and will remain on disk.</li>
        : <li>The checkout at <code>{request.path}</code>{request.branch ? <> on branch <code>{request.branch}</code></> : null} will be removed{request.owned === false ? ' (it was attached externally)' : request.owned === true ? ' (created by Kanban)' : ''}. {isDelete ? (detached ? 'The checkout is detached; Git has no branch to preserve.' : 'The branch is kept.') : ''}</li>
      : isDelete && <li>No worktree is associated, so the project folder is not removed.</li>}
    {unclaimed.length > 0 && <li><span className="kb-warning" role="note" aria-label="Unclaimed checkout deletion warning">Unclaimed checkouts remain on disk. They are not included in this deletion and require manual inspection.</span><ul className="kb-unclaimed-list">{unclaimed.map(entry => <li key={entry.path}><code>{entry.path}</code>{entry.branch ? <> on <code>{entry.branch}</code></> : null}</li>)}</ul></li>}
    {busy && <li>A conversation is running or has unsettled background work. Deletion waits until the task is idle.</li>}
    {request.path && !plainCheckout && <li>If the worktree has local changes, a separate discard confirmation appears before removal.</li>}
  </ul>;
}
