import type { Column, TransitionRule, Workflow } from '../shared/types.js';

/** How a move from one existing stage to another relates to the workflow rule. */
export type TransitionAccess = 'reorder' | 'allowed' | 'restricted';

export interface TransitionDestination {
  column: Column;
  access: TransitionAccess | null;
}

/** One configured transition resolved against the workflow. */
export interface ResolvedTransition {
  readonly column: Column;
  readonly rule: TransitionRule;
}

/**
 * The authored transition rule for one stage: the configured targets, or null
 * when the stage omits restrictions and therefore allows any other stage.
 * `next` is the stage after it in workflow order, which the diagram draws as
 * the default path when nothing is configured.
 */
export interface AuthoredTransitions {
  readonly targets: readonly TransitionRule[] | null;
  readonly next?: Column;
}

export function authoredTransitions(workflow: Workflow, columnId: string): AuthoredTransitions | null {
  const index = workflow.columns.findIndex(column => column.id === columnId);
  if (index < 0) return null;
  const column = workflow.columns[index]!;
  const next = workflow.columns[index + 1];
  return { targets: column.deterministic === undefined ? column.allowedTransitions ?? null : [...new Set(Object.values(column.deterministic.exits))].map(to => ({ to })),  ...(next === undefined ? {} : { next }) };
}

/** Classifies a move between existing stages without applying any policy beyond the workflow. */
export function transitionAccess(workflow: Workflow, from: string, to: string): TransitionAccess | null {
  if (!workflow.columns.some(column => column.id === to)) return null;
  if (from === to) return 'reorder';
  const authored = authoredTransitions(workflow, from);
  if (authored === null) return null;
  return authored.targets === null || authored.targets.some(rule => rule.to === to) ? 'allowed' : 'restricted';
}

/**
 * The configured transitions of one stage, resolved to existing stages in
 * authored order. A self reference is a reorder rather than a transition, so it
 * is not a target here.
 */
export function transitionTargets(workflow: Workflow, columnId: string): ResolvedTransition[] {
  const source = workflow.columns.find(column => column.id === columnId);
  const rules = source?.deterministic === undefined ? source?.allowedTransitions : [...new Set(Object.values(source.deterministic.exits))].map(to => ({ to }));
  if (rules === undefined) return [];
  const targets: ResolvedTransition[] = [];
  for (const rule of rules) {
    if (rule.to === columnId) continue;
    const column = workflow.columns.find(value => value.id === rule.to);
    if (column !== undefined) targets.push({ column, rule });
  }
  return targets;
}

/**
 * The destination the workflow takes without a recorded transition: the first
 * configured target, or the following stage in workflow order. A self or
 * unknown target has no destination.
 */
export function defaultDestination(workflow: Workflow, fromColumnId: string): Column | undefined {
  const index = workflow.columns.findIndex(column => column.id === fromColumnId);
  if (index < 0) return undefined;
  const source = workflow.columns[index]!;
  if (source.deterministic !== undefined) return undefined;
  if (source.allowedTransitions !== undefined) {
    const first = source.allowedTransitions[0];
    if (first === undefined) return undefined;
    const target = workflow.columns.find(column => column.id === first.to);
    return target && target.id !== fromColumnId ? target : undefined;
  }
  const next = workflow.columns[index + 1];
  return next && next.id !== fromColumnId ? next : undefined;
}

/** Every workflow stage in workflow order, paired with its access from `from`. */
export function transitionDestinations(workflow: Workflow, from: string): TransitionDestination[] {
  return workflow.columns.map(column => ({ column, access: transitionAccess(workflow, from, column.id) }));
}

/**
 * The stage a task card offers as its advance destination. A stage that authors no
 * destination permits none, so a card there offers no advance action even though a
 * later stage exists in workflow order.
 */
export function advanceDestination(workflow: Workflow, from: string): TransitionDestination | undefined {
  const index = workflow.columns.findIndex(column => column.id === from);
  if (index < 0) return undefined;
  if (workflow.columns[index]!.deterministic !== undefined) return undefined;
  if (workflow.columns[index]!.allowedTransitions?.length === 0) return undefined;
  return nextStage(workflow, from);
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
