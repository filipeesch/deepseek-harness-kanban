import type { Workflow } from '../shared/types.js';

/** The stage references one task carries: where it is now, and where an admitted advance will take it. */
export interface TaskStageReference {
  readonly columnId: string;
  readonly pendingTransition?: { readonly fromColumnId: string; readonly columnId: string };
}

/**
 * The stage identifiers a workflow no longer defines that a task still references.
 *
 * The board save refuses a document that would strand a task, and a preview must be
 * able to apply the same rule before offering an apply handle. One function serves
 * both, so a previewed candidate cannot be refused by a rule it never saw.
 */
export function orphanedStageReferences(workflow: Workflow, tasks: readonly TaskStageReference[]): string[] {
  const defined = new Set(workflow.columns.map(column => column.id));
  const referenced = tasks.flatMap(task => (task.pendingTransition === undefined
    ? [task.columnId]
    : [task.columnId, task.pendingTransition.fromColumnId, task.pendingTransition.columnId]));
  return [...new Set(referenced.filter(columnId => !defined.has(columnId)))];
}
