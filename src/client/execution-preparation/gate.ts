import type { Project, Task } from '../../shared/types.js';
import { planFirstExecution, worktreeDecision } from '../../domain/first-execution.js';
import type { PreparationOutcome } from './contract.js';

/** The worktree part of a preparation: ask, create the derived default, or report a blocked binding. */
export type PreparationWorktree = 'ask' | 'create-default' | 'blocked';

/** The preparation a task's first execution needs, or null when the move or run already applies. */
export interface ExecutionPreparationPlan {
  readonly worktree: PreparationWorktree;
}

/**
 * Decide whether a move or run needs the first-execution preparation. With the
 * model step gone, the preparation applies only when a worktree decision applies:
 * a task that already has a ready worktree, recorded a base-project choice, belongs
 * to a folder project, or whose project never creates worktrees needs no dialog.
 */
export function executionPreparationPlan(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
): ExecutionPreparationPlan | null {
  const plan = planFirstExecution({ task, project, mode: 'interactive' });
  if (plan === null || plan.worktree === 'none' || plan.worktree === 'base') return null;
  return { worktree: plan.worktree };
}

/**
 * The worktree outcome a task creation takes without asking. It uses the same rule
 * as the automatic first execution: the project's default worktree when the policy
 * does not forbid it, and no worktree otherwise.
 */
export function automaticPreparationOutcome(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
): Exclude<PreparationOutcome, 'base'> {
  return worktreeDecision(task, project) === 'create-default' ? 'create' : 'none';
}
