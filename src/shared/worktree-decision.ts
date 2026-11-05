import { isGitProject } from './project.js';
import type { Project, Task } from './types.js';

/**
 * Whether an explicit first conversation must wait for the task's worktree choice.
 * A ready worktree, a recorded base-project choice, a folder project, or an
 * existing conversation all satisfy the choice.
 */
export function requiresWorktreeDecision(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
): boolean {
  return project !== undefined
    && isGitProject(project)
    && task.sessionIds.length === 0
    && task.worktreeDismissed !== true
    && task.worktree?.status !== 'ready';
}

/**
 * Whether the task carries a Git-backed worktree binding that is not ready.
 * Such a binding blocks the task's first execution until it is resolved in the
 * Git section; conversations that already exist keep running.
 */
export function unresolvedWorktreeBinding(
  task: Pick<Task, 'worktree'>,
  project: Project | undefined,
): boolean {
  return project !== undefined
    && isGitProject(project)
    && task.worktree != null
    && task.worktree.status !== 'ready';
}
