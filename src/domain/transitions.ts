import type { Column, Workflow } from '../shared/types.js';

/** How a move from one existing stage to another relates to the workflow rule. */
export type TransitionAccess = 'reorder' | 'allowed' | 'restricted';

export interface TransitionDestination {
  column: Column;
  access: TransitionAccess | null;
}

/** Classifies a move between existing stages without applying any policy beyond the workflow. */
export function transitionAccess(workflow: Workflow, from: string, to: string): TransitionAccess | null {
  const source = workflow.columns.find(column => column.id === from);
  if (!source || !workflow.columns.some(column => column.id === to)) return null;
  if (from === to) return 'reorder';
  return source.allowedTransitions === undefined || source.allowedTransitions.includes(to) ? 'allowed' : 'restricted';
}

/** Every workflow stage in workflow order, paired with its access from `from`. */
export function transitionDestinations(workflow: Workflow, from: string): TransitionDestination[] {
  return workflow.columns.map(column => ({ column, access: transitionAccess(workflow, from, column.id) }));
}

/** The stage after `from` in workflow order, or undefined when `from` is the last stage or unknown. */
export function nextStage(workflow: Workflow, from: string): TransitionDestination | undefined {
  const index = workflow.columns.findIndex(column => column.id === from);
  if (index < 0) return undefined;
  const column = workflow.columns[index + 1];
  if (column === undefined) return undefined;
  return { column, access: transitionAccess(workflow, from, column.id) };
}

/** A transition enters a different existing stage; same-stage ordering is separate. */
export function canTransition(workflow: Workflow, from: string, to: string): boolean {
  return transitionAccess(workflow, from, to) === 'allowed';
}
