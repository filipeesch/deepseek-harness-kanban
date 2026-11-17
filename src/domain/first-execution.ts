import type { Project, Task, Workflow } from '../shared/types.js';
import { createsDefaultWorktree, unresolvedWorktreeBinding } from '../shared/worktree-decision.js';
import { worktreePolicy } from '../shared/worktree-policy.js';
import { entryInstruction } from './stage-entry.js';

/** How a first execution is being prepared: an interactive dialog or the automatic creation path. */
export type FirstExecutionMode = 'interactive' | 'automatic';

/** The worktree decision a first execution needs. */
export type FirstExecutionWorktree = 'ask' | 'create-default' | 'base' | 'blocked' | 'none';

/** The instructed entry a preparation targets. */
export interface FirstExecutionEntry { readonly columnId: string; readonly enteredAt: number; readonly instruction: string }

/** One first execution's decision: whether to start and what to do about a worktree. */
export interface FirstExecutionPlan {
  /** Automatic mode only: the creation should prepare this task now. */
  readonly start: boolean;
  readonly worktree: FirstExecutionWorktree;
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
 * The worktree decision for a task that is about to receive its first execution
 * context: a blocked binding, a default creation, a recorded base project, or no
 * choice at all. The message preparation and the automatic first execution share
 * this rule instead of duplicating it. The project's worktree policy decides whether
 * the task would have been asked: Ask and Always create both start on the default
 * worktree, and Never starts on the base project.
 */
export function worktreeDecision(
  task: Pick<Task, 'sessionIds' | 'worktree' | 'worktreeDismissed'>,
  project: Project | undefined,
): Exclude<FirstExecutionWorktree, 'ask'> {
  if (unresolvedWorktreeBinding(task, project)) return 'blocked';
  if (createsDefaultWorktree(task, project)) return 'create-default';
  if (task.worktreeDismissed === true) return 'base';
  return 'none';
}

/**
 * Decide one first execution. Interactive is the execution-preparation gate: ask
 * for the worktree while the project's policy leaves the choice to the task, mark
 * the derived default to create without asking under Always create, and block on a
 * binding that is not ready. It applies only when a worktree decision applies,
 * because the preparation no longer presents a model step. Automatic uses the
 * default worktree and never asks; it starts only when the creation requested it,
 * the instructed entry is unresolved, and no conversation exists.
 */
export function planFirstExecution(input: FirstExecutionInput): FirstExecutionPlan | null {
  const { task, project } = input;
  if (input.mode === 'interactive') {
    if (task.sessionIds.length > 0) return null;
    if (unresolvedWorktreeBinding(task, project)) return { start: false, worktree: 'blocked', entry: null };
    const worktree: FirstExecutionWorktree = createsDefaultWorktree(task, project)
      ? worktreePolicy(project) === 'always' ? 'create-default' : 'ask'
      : 'none';
    if (worktree === 'none') return null;
    return { start: false, worktree, entry: null };
  }
  const entry = unresolvedEntry(input);
  const worktree: FirstExecutionWorktree = worktreeDecision(task, project);
  const start = input.startRequested === true && entry !== null && task.sessionIds.length === 0;
  return { start, worktree: start ? worktree : 'none', entry };
}
