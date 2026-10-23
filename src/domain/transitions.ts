import type { Column, Workflow } from '../shared/types.js';

/** Columns that are valid destinations from `from`, including the current column for reordering. */
export function permittedDestinations(workflow: Workflow, from: string): Column[] {
  const source = workflow.columns.find(column => column.id === from);
  if (!source) return [...workflow.columns];
  return workflow.columns.filter(column => column.id === from || source.allowedTransitions === undefined || source.allowedTransitions.includes(column.id));
}

/** A transition enters a different existing stage; same-stage ordering is separate. */
export function canTransition(workflow: Workflow, from: string, to: string): boolean {
  const source = workflow.columns.find(column => column.id === from);
  if (!source || from === to || !workflow.columns.some(column => column.id === to)) return false;
  return source.allowedTransitions === undefined || source.allowedTransitions.includes(to);
}
