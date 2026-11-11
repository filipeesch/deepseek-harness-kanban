import type { Column, ModelSelection, Project, Task } from '../../shared/types.js';

/** What is about to start: a stage move or a card run action. */
export interface PreparationRequest {
  readonly kind: 'move' | 'run';
  readonly task: Task;
  readonly column: Column;
  readonly project?: Project;
  /** The model the task's board names for its conversations, when it names one. */
  readonly boardModel?: ModelSelection;
}

/** Resolves true when the move or run may proceed, false when the user cancelled. */
export type PrepareExecution = (request: PreparationRequest) => Promise<boolean>;
