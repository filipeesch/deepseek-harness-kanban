import type { TransitionRule, Workflow } from '../../shared/types.js';

/** The transitions the diagram presents per stage before the workflow acknowledges them. */
export type TransitionOverrides = Readonly<Record<string, readonly TransitionRule[] | null | undefined>>;

/**
 * The workflow the diagram presents: the acknowledged one with the stages a
 * gesture has already changed. Null authors no transition list, which permits any
 * other stage; an empty list permits none. Every surface reads this value, so the
 * connections, the cards, and the history cannot disagree about a transition.
 */
export function presentWorkflow(workflow: Workflow, overrides: TransitionOverrides): Workflow {
  const ids = Object.keys(overrides).filter(stageId => overrides[stageId] !== undefined);
  if (ids.length === 0) return workflow;
  const columns = workflow.columns.map(column => {
    if (!(column.id in overrides)) return column;
    const value = overrides[column.id];
    if (value === undefined) return column;
    const next = { ...column };
    if (value === null) delete next.allowedTransitions;
    else next.allowedTransitions = value.map(rule => ({ ...rule }));
    return next;
  });
  return { ...workflow, columns };
}

/** The transitions one stage authors, or null when it permits any other stage. */
export function presentedRules(workflow: Workflow, stageId: string): TransitionRule[] | null {
  const column = workflow.columns.find(value => value.id === stageId);
  return column?.allowedTransitions === undefined ? null : column.allowedTransitions;
}
