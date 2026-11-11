import type { ContextOperation, Problem, Task } from '../shared/types.js';
import { recordWorktreeOutcome } from '../domain/task-history/record.js';

/**
 * What one worktree or context operation leaves in a task's flow record once it
 * settles.
 *
 * Only the outcome is recorded. The phases an operation passes through are
 * already the operation's own status, shown by the card and the drawer, so
 * recording them here would duplicate a surface that exists. A successful
 * deletion records nothing because the record is removed with the task; a return
 * to the base project is not one of the outcomes the record carries.
 */
export function recordSettledOperation(task: Task, operation: ContextOperation, at: string, failure?: Problem): void {
  if (failure !== undefined) {
    const path = operation.targetPath ?? task.worktree?.path;
    recordWorktreeOutcome(task, { action: 'failed', error: failure, ...(path === undefined ? {} : { path }) }, at);
    return;
  }
  const request = operation.request;
  if (request.kind === 'create') {
    const tree = task.worktree;
    if (tree !== null) recordWorktreeOutcome(task, { action: 'created', path: tree.path, branch: tree.branch }, at);
    return;
  }
  if (request.kind === 'attach') {
    const path = task.worktree?.path ?? operation.targetPath;
    if (path !== undefined) recordWorktreeOutcome(task, { action: 'attached', path }, at);
    return;
  }
  if (request.kind === 'remove') {
    const path = operation.targetPath;
    if (path !== undefined) recordWorktreeOutcome(task, { action: 'removed', path }, at);
  }
}
