import type { Project, Task } from '../../shared/types.js';
import { requiresWorktreeDecision, unresolvedWorktreeBinding } from '../../shared/worktree-decision.js';

/** The worktree part of a preparation: ask, blocked by a binding, or nothing. */
export type PreparationWorktree = 'ask' | 'blocked' | 'none';

/**
 * The execution preparation a task's first execution needs. The dialog is only
 * presented when at least one part applies, so the caller keeps the current
 * move and run behavior for every other task.
 */
export interface ExecutionPreparationPlan {
  readonly worktree: PreparationWorktree;
  /** Whether DSH's native model selector is composed for this host generation. */
  readonly model: boolean;
}

/**
 * Decide whether the move or run action needs the first-execution preparation.
 * @param task - the task that is about to execute; it must have no conversation.
 * @param project - its project, which decides Git-backed worktree rules.
 * @param modelSeatAvailable - whether the native model selector slot is registered.
 * @returns the preparation plan, or null when the current flow already applies.
 */
export function executionPreparationPlan(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
  modelSeatAvailable: boolean,
): ExecutionPreparationPlan | null {
  if (task.sessionIds.length > 0) return null;
  if (unresolvedWorktreeBinding(task, project)) return { worktree: 'blocked', model: false };
  const worktree: PreparationWorktree = requiresWorktreeDecision(task, project) ? 'ask' : 'none';
  if (worktree === 'none' && !modelSeatAvailable) return null;
  return { worktree, model: modelSeatAvailable };
}
