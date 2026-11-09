import type { Project, Task, Workflow } from '../shared/types.js';
import { requiresWorktreeDecision, unresolvedWorktreeBinding } from '../shared/worktree-decision.js';
import { entryInstruction } from './stage-entry.js';

/** How a first execution is being prepared: an interactive dialog or the automatic creation path. */
export type FirstExecutionMode = 'interactive' | 'automatic';

/** The worktree decision a first execution needs. */
export type FirstExecutionWorktree = 'ask' | 'create-default' | 'base' | 'blocked' | 'none';

/** The instructed entry a preparation targets. */
export interface FirstExecutionEntry { readonly columnId: string; readonly enteredAt: number; readonly instruction: string }

/** One first execution's decision: whether to start, what to do about a worktree, and whether to ask for a model. */
export interface FirstExecutionPlan {
  /** Automatic mode only: the creation should prepare this task now. */
  readonly start: boolean;
  readonly worktree: FirstExecutionWorktree;
  /** Interactive mode only: DSH's native model selector is composed for the host. */
  readonly model: boolean;
  /** The unresolved instructed entry, or null when there is none. */
  readonly entry: FirstExecutionEntry | null;
}

export interface FirstExecutionInput {
  readonly task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'> & Partial<Pick<Task, 'columnId' | 'instructionPending'>>;
  readonly project?: Project;
  /** Required for an entry: the board workflow that owns the instructed column. */
  readonly workflow?: Workflow;
  /** The instructed column being entered; defaults to the task's current column. */
  readonly columnId?: string;
  readonly modelSeatAvailable: boolean;
  readonly mode: FirstExecutionMode;
  /** Automatic mode only: whether the creation asked to start now. */
  readonly startRequested?: boolean;
}

function unresolvedEntry(input: FirstExecutionInput): FirstExecutionEntry | null {
  if (input.workflow === undefined) return null;
  const columnId = input.columnId ?? input.task.columnId;
  if (columnId === undefined) return null;
  const instruction = entryInstruction(input.workflow.columns.find(column => column.id === columnId));
  const marker = input.task.instructionPending;
  if (instruction === undefined || marker?.columnId !== columnId) return null;
  return { columnId, enteredAt: marker.enteredAt, instruction };
}

/**
 * Decide one first execution. Interactive reproduces the execution-preparation
 * gate: ask for the worktree only while the choice is genuinely unresolved, block
 * on a binding that is not ready, and otherwise present whatever remains. Automatic
 * uses the default worktree and never asks; it starts only when the creation
 * requested it, the instructed entry is unresolved, and no conversation exists.
 */
export function planFirstExecution(input: FirstExecutionInput): FirstExecutionPlan | null {
  const { task, project } = input;
  if (input.mode === 'interactive') {
    if (task.sessionIds.length > 0) return null;
    if (unresolvedWorktreeBinding(task, project)) return { start: false, worktree: 'blocked', model: false, entry: null };
    const worktree: FirstExecutionWorktree = requiresWorktreeDecision(task, project) ? 'ask' : 'none';
    if (worktree === 'none' && !input.modelSeatAvailable) return null;
    return { start: false, worktree, model: input.modelSeatAvailable, entry: null };
  }
  const entry = unresolvedEntry(input);
  const worktree: FirstExecutionWorktree = unresolvedWorktreeBinding(task, project)
    ? 'blocked'
    : requiresWorktreeDecision(task, project)
      ? 'create-default'
      : task.worktreeDismissed === true
        ? 'base'
        : 'none';
  const start = input.startRequested === true && entry !== null && task.sessionIds.length === 0;
  return { start, worktree: start ? worktree : 'none', model: false, entry };
}
