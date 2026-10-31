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
