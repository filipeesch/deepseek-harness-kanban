import { ownsScriptedEntry } from './scripted-state.js';
import type { AdvanceOrigin, Column, Task, Workflow } from '../shared/types.js';
import { resolveAutoAdvance, type AutoAdvancePlan } from './auto-advance.js';
import { defaultDestination, nextStage, ownsStageRouting } from './transitions.js';

/** The task fields the routing rules read. */
export type RoutedTask = Pick<Task, 'columnId' | 'recordedTransition'> & Partial<Pick<Task, 'stageEntry' | 'scripted' | 'scriptedHandoff'>>;

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
  if (ownsScriptedEntry(task) || workflow.columns.find(column => column.id === task.columnId)?.scripted !== undefined) return { kind: 'none' };
  const recorded = task.recordedTransition;
  // Exceptional intent is never a normal durable route: only its originating
  // observed turn may resolve it through the separate admission path.
  if (recorded === undefined || recorded.exception !== undefined || recorded.fromColumnId !== task.columnId) return { kind: 'none' };
  const source = workflow.columns.find(column => column.id === recorded.fromColumnId);
  if (source === undefined) return { kind: 'none' };
  const column = workflow.columns.find(value => value.id === recorded.columnId);
  if (column === undefined) return { kind: 'stale', reason: 'missing-stage' };
  if (source.allowedTransitions === undefined) return { kind: 'stale', reason: 'not-configured' };
  if (!source.allowedTransitions.some(rule => rule.to === recorded.columnId)) return { kind: 'stale', reason: 'not-allowed' };
  return recorded.reason === undefined ? { kind: 'resolved', column } : { kind: 'resolved', column, reason: recorded.reason };
}

/** Identity captured by an exceptional declaration; it does not verify user intent. */
export interface ExceptionalTransitionIdentity {
  id: string; sessionId: string; turn: number; entryId: string; fromColumnId: string; columnId: string;
}

/** Resolve only the precise exceptional declaration and entry an observed turn owns. */
export function resolveExceptionalTransition(workflow: Workflow, task: RoutedTask, expected: ExceptionalTransitionIdentity): Column | undefined {
  const recorded = task.recordedTransition;
  const exception = recorded?.exception;
  const sameEntry = task.stageEntry === undefined
    ? expected.entryId === expected.id && task.scripted === undefined && task.scriptedHandoff === undefined
    : task.stageEntry.id === expected.entryId && task.stageEntry.columnId === expected.fromColumnId;
  if (!recorded || !exception || exception.id !== expected.id || exception.sessionId !== expected.sessionId
      || exception.turn !== expected.turn || exception.entryId !== expected.entryId
      || !sameEntry
      || task.columnId !== expected.fromColumnId || recorded.fromColumnId !== expected.fromColumnId
      || recorded.columnId !== expected.columnId || !recorded.reason || routesThroughDeterministicStage(workflow, task)) return undefined;
  const source = workflow.columns.find(column => column.id === expected.fromColumnId);
  if (!source || expected.columnId === expected.fromColumnId) return undefined;
  return workflow.columns.find(column => column.id === expected.columnId);
}

/** The task fields the advance-arming rule reads. */
export type ArmedTask = RoutedTask & Pick<Task, 'autoMode'>;

/**
 * Whether one advance origin is still armed for the task's current stage. The
 * auto origin requires auto mode; the agent origin requires the reason-carrying
 * recording the current stage resolves. Neither is armed inside a scripted
 * entry, which routes through its captured exit instead.
 */
export function advanceArmedFor(origin: AdvanceOrigin, workflow: Workflow, task: ArmedTask): boolean {
  if (routesThroughDeterministicStage(workflow, task)) return false;
  if (origin === 'auto') return task.autoMode?.enabled === true;
  return declaredTransitionReason(workflow, task) !== undefined;
}

/**
 * Whether the task's routing belongs to a deterministic stage rather than to a
 * turn-end advance: an entry a script owns, or a stage that authors a script or a
 * decision gate. Neither is crossed by an automatic advance or a declaration.
 */
export function routesThroughDeterministicStage(workflow: Workflow, task: Pick<Task, 'columnId' | 'stageEntry' | 'scripted'>): boolean {
  return ownsScriptedEntry(task) || ownsStageRouting(workflow.columns.find(column => column.id === task.columnId));
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
  if (routesThroughDeterministicStage(workflow, task)) return { kind: 'none' };
  const recorded = recordedTransition(workflow, task);
  if (recorded.kind === 'stale') return { kind: 'stale', message: staleTransitionMessage(workflow, task, recorded.reason) };
  if (recorded.kind === 'resolved') return { kind: 'advance', column: recorded.column, source: 'recorded' };
  const next = nextStage(workflow, task.columnId);
  return next === undefined ? { kind: 'none' } : { kind: 'advance', column: next.column, source: 'default' };
}

export function resolveAdvanceRoute(workflow: Workflow, task: RoutedTask): AdvanceRoute {
  if (ownsScriptedEntry(task) || workflow.columns.find(column => column.id === task.columnId)?.decision !== undefined) return { kind: 'none' };
  const destination = routeDestination(workflow, task);
  if (destination.kind === 'none') return { kind: 'none' };
  if (destination.kind === 'stale') return { kind: 'stale', message: destination.message };
  const plan = destination.source === 'recorded'
    ? resolveAutoAdvance(workflow, task.columnId, { exact: destination.column })
    : resolveAutoAdvance(workflow, task.columnId);
  return plan.destination === undefined ? { kind: 'none' } : { kind: 'advance', plan, source: destination.source };
}