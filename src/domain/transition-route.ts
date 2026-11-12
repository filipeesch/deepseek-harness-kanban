import { ownsDeterministicEntry } from './deterministic-state.js';
import type { AdvanceOrigin, Column, Task, Workflow } from '../shared/types.js';
import { resolveAutoAdvance, type AutoAdvancePlan } from './auto-advance.js';
import { defaultDestination, nextStage } from './transitions.js';

/** The task fields the routing rules read. */
export type RoutedTask = Pick<Task, 'columnId' | 'recordedTransition'> & Partial<Pick<Task, 'stageEntry' | 'deterministic'>>;

/** Why a recorded transition no longer applies to the task's current stage. */
export type TransitionStaleReason = 'missing-stage' | 'not-configured' | 'not-allowed';

export type RecordedTransitionResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'resolved'; readonly column: Column; readonly reason?: string }
  | { readonly kind: 'stale'; readonly reason: TransitionStaleReason };

/**
 * Resolve the transition the task recorded for its current stage. A recording
 * made for another stage does not apply, so it resolves to nothing instead of
 * an error; it stops resolving only when its target stage disappeared, when the
 * current stage stopped configuring transitions, or when that stage no longer
 * lists the target.
 */
export function recordedTransition(workflow: Workflow, task: RoutedTask): RecordedTransitionResolution {
  if (ownsDeterministicEntry(task) || workflow.columns.find(column => column.id === task.columnId)?.deterministic !== undefined) return { kind: 'none' };
  const recorded = task.recordedTransition;
  if (recorded === undefined || recorded.fromColumnId !== task.columnId) return { kind: 'none' };
  const source = workflow.columns.find(column => column.id === recorded.fromColumnId);
  if (source === undefined) return { kind: 'none' };
  const column = workflow.columns.find(value => value.id === recorded.columnId);
  if (column === undefined) return { kind: 'stale', reason: 'missing-stage' };
  if (source.allowedTransitions === undefined) return { kind: 'stale', reason: 'not-configured' };
  if (!source.allowedTransitions.some(rule => rule.to === recorded.columnId)) return { kind: 'stale', reason: 'not-allowed' };
  return recorded.reason === undefined ? { kind: 'resolved', column } : { kind: 'resolved', column, reason: recorded.reason };
}

/** The task fields the advance-arming rule reads. */
export type ArmedTask = RoutedTask & Pick<Task, 'autoMode'>;

/**
 * Whether one advance origin is still armed for the task's current stage. The
 * auto origin requires auto mode; the agent origin requires the reason-carrying
 * recording the current stage resolves. Neither is armed inside a deterministic
 * entry, which routes through its captured exit instead.
 */
export function advanceArmedFor(origin: AdvanceOrigin, workflow: Workflow, task: ArmedTask): boolean {
  if (routesThroughDeterministicEntry(workflow, task)) return false;
  if (origin === 'auto') return task.autoMode?.enabled === true;
  return declaredTransitionReason(workflow, task) !== undefined;
}

/** Whether a deterministic entry, rather than a turn-end advance, owns the task's routing. */
export function routesThroughDeterministicEntry(workflow: Workflow, task: Pick<Task, 'columnId' | 'stageEntry' | 'deterministic'>): boolean {
  return ownsDeterministicEntry(task) || workflow.columns.find(column => column.id === task.columnId)?.deterministic !== undefined;
}

/**
 * Whether a completed turn produces an advance for this task, whichever origin
 * the coordinator later attributes it to. Auto mode arms every completed turn.
 * A declared transition arms the completed turn that follows it, whether or not
 * auto mode is enabled, which is what lets a workflow route without asking the
 * user to turn auto mode on. A recording stored without a reason predates this
 * rule: it keeps its routing meaning for the destination and for the drawer, and
 * arms nothing by itself.
 */
export function advanceArmed(workflow: Workflow, task: ArmedTask): boolean {
  return advanceArmedFor('auto', workflow, task) || advanceArmedFor('agent', workflow, task);
}

/** The reason a resolving declared transition carries, or undefined when none applies. */
export function declaredTransitionReason(workflow: Workflow, task: RoutedTask): string | undefined {
  const recorded = recordedTransition(workflow, task);
  return recorded.kind === 'resolved' ? recorded.reason : undefined;
}

/** The user-facing explanation for a recording that no longer resolves. */
export function staleTransitionMessage(workflow: Workflow, task: RoutedTask, reason: TransitionStaleReason): string {
  const stageName = workflow.columns.find(column => column.id === task.columnId)?.name ?? task.columnId;
  switch (reason) {
    case 'missing-stage': return 'The recorded transition points to a stage that no longer exists.';
    case 'not-configured': return 'The ' + stageName + ' stage no longer configures transitions.';
    case 'not-allowed': return 'The recorded transition is no longer a configured transition of the ' + stageName + ' stage.';
  }
}

/** The destination a task moves to next: its recorded transition, or the workflow default. */
export type RouteDestination =
  | { readonly kind: 'none' }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'resolved'; readonly column: Column; readonly source: 'recorded' | 'default' };

export function routeDestination(workflow: Workflow, task: RoutedTask): RouteDestination {
  const recorded = recordedTransition(workflow, task);
  if (recorded.kind === 'stale') return { kind: 'stale', message: staleTransitionMessage(workflow, task, recorded.reason) };
  if (recorded.kind === 'resolved') return { kind: 'resolved', column: recorded.column, source: 'recorded' };
  const column = defaultDestination(workflow, task.columnId);
  return column === undefined ? { kind: 'none' } : { kind: 'resolved', column, source: 'default' };
}

/** The resolution one automatic advance or one next-stage action acts on. */
export type AdvanceRoute =
  | { readonly kind: 'none' }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'advance'; readonly plan: AutoAdvancePlan; readonly source: 'recorded' | 'default' };

/**
 * The drawer's next-stage destination: the recorded transition while it
 * resolves, otherwise the stage that follows the current one in workflow order.
 * It differs from the automatic advance on purpose — a manual action steps to
 * the adjacent stage, while the automatic advance resolves the configured path.
 */
export type NextStageRoute =
  | { readonly kind: 'none' }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'advance'; readonly column: Column; readonly source: 'recorded' | 'default' };

export function resolveNextStageRoute(workflow: Workflow, task: RoutedTask): NextStageRoute {
  const recorded = recordedTransition(workflow, task);
  if (recorded.kind === 'stale') return { kind: 'stale', message: staleTransitionMessage(workflow, task, recorded.reason) };
  if (recorded.kind === 'resolved') return { kind: 'advance', column: recorded.column, source: 'recorded' };
  const next = nextStage(workflow, task.columnId);
  return next === undefined ? { kind: 'none' } : { kind: 'advance', column: next.column, source: 'default' };
}

export function resolveAdvanceRoute(workflow: Workflow, task: RoutedTask): AdvanceRoute {
  if (ownsDeterministicEntry(task)) return { kind: 'none' };
  const destination = routeDestination(workflow, task);
  if (destination.kind === 'none') return { kind: 'none' };
  if (destination.kind === 'stale') return { kind: 'stale', message: destination.message };
  const plan = destination.source === 'recorded'
    ? resolveAutoAdvance(workflow, task.columnId, { exact: destination.column })
    : resolveAutoAdvance(workflow, task.columnId);
  return plan.destination === undefined ? { kind: 'none' } : { kind: 'advance', plan, source: destination.source };
}
