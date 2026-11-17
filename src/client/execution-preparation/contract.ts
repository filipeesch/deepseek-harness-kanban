import type { Column, Project, Task } from '../../shared/types.js';

/** What is about to start: a stage move or a card run action. */
export interface PreparationRequest {
  readonly kind: 'move' | 'run';
  readonly task: Task;
  readonly column: Column;
  readonly project?: Project;
}

/** How the first execution gets its directory. */
export type PreparationOutcome = 'create' | 'base' | 'none';

/** The answer one preparation produced: whether the move or run may proceed, and the worktree outcome. */
export interface PreparationDecision {
  readonly proceed: boolean;
  readonly worktree: PreparationOutcome;
}

/** The instructed entry a preparation completes for. */
export interface PreparationEntry {
  readonly taskId: string;
  readonly columnId: string;
  readonly enteredAt: number;
  readonly instruction: string;
}

/** No preparation applies: the move or run proceeds as it always did. */
export const NO_PREPARATION: PreparationDecision = Object.freeze({ proceed: true, worktree: 'none' as const });

/** Resolves the decision for the move or run; a refused decision cancels it. */
export type PrepareExecution = (request: PreparationRequest) => Promise<PreparationDecision>;

/** Completes the preparation after the move: record the worktree answer and create the first conversation. */
export type CompletePreparation = (entry: PreparationEntry, worktree: PreparationOutcome) => Promise<void>;
