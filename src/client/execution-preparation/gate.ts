import type { ModelCatalog, ModelSelection, Project, Task } from '../../shared/types.js';
import { modelIsAvailable } from '../../domain/model-preference.js';
import { planFirstExecution } from '../../domain/first-execution.js';

/** The worktree part of a preparation: ask, blocked by a binding, or nothing. */
export type PreparationWorktree = 'ask' | 'blocked' | 'none';

/** What the board has already settled about the model its conversations start on. */
export interface PreparationModel {
  /** The model the board names, when it names one. */
  readonly boardModel: ModelSelection | undefined;
  /** The host catalog the route was checked against; null when it could not be read. */
  readonly catalog: ModelCatalog | null;
}

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
 * @param model - the model the board names for its conversations and the catalog it was
 *   checked against. A board that names a route the host offers has already settled that
 *   step, so the seat is not composed; a catalog that could not be read counts as
 *   unavailable, which keeps the step open rather than guessing.
 * @returns the preparation plan, or null when the current flow already applies.
 */
export function executionPreparationPlan(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
  modelSeatAvailable: boolean,
  model: PreparationModel,
): ExecutionPreparationPlan | null {
  const needsSeat = modelSeatAvailable && !modelIsAvailable(model.catalog ?? undefined, model.boardModel);
  const plan = planFirstExecution({ task, project, modelSeatAvailable: needsSeat, mode: 'interactive' });
  if (plan === null) return null;
  const worktree: PreparationWorktree = plan.worktree === 'ask' ? 'ask' : plan.worktree === 'blocked' ? 'blocked' : 'none';
  return { worktree, model: plan.model };
}
