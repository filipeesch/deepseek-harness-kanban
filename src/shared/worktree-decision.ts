import { isGitProject } from './project.js';
import { worktreePolicy } from './worktree-policy.js';
import type { Project, Task } from './types.js';

/**
 * Whether the task's first execution still faces an unanswered worktree outcome: the
 * project is Git-backed, no conversation exists, the task has not recorded its own
 * base-project choice, and no ready worktree satisfies the outcome.
 */
export function needsWorktreeOutcome(
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
 * Whether an explicit first conversation must wait for the task's own worktree choice.
 * Only the Ask policy leaves the choice to the task: Always create resolves it by
 * creating the default worktree, and Never resolves it in the base project.
 */
export function requiresWorktreeDecision(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
): boolean {
  return worktreePolicy(project) === 'ask' && needsWorktreeOutcome(task, project);
}

/**
 * Whether the task's first execution starts on the project's default worktree instead of
 * the base project. Ask and Always create both start there; Never does not.
 */
export function createsDefaultWorktree(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
): boolean {
  return worktreePolicy(project) !== 'never' && needsWorktreeOutcome(task, project);
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
