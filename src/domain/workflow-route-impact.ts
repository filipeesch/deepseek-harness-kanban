import type { Task, Workflow } from '../shared/types.js';
import type { WorkflowCardReference } from './workflow-report.js';
import { canTransition } from './transitions.js';
import { recordedTransition, type RoutedTask, type TransitionStaleReason } from './transition-route.js';

/**
 * One routing fact the engine itself would act on for a card, caused by a candidate.
 *
 * This is the single route-impact basis the batch report and the card reference use,
 * so two fields of one report cannot describe the same card differently. A focused
 * board write produces the same facts from the same functions.
 */
export type RouteImpactKind = 'route-stale' | 'placement-blocked';

export interface RouteImpact {
  readonly kind: RouteImpactKind;
  /** The destination the affected route names. */
  readonly destination: string;
  /** The advance the card holds: a declaration, or an admitted pending turn. */
  readonly advance: 'declared' | 'pending';
  /** The engine's own reason when a declaration stops resolving. */
  readonly reason?: TransitionStaleReason;
}

/**
 * The task shape the routing resolver reads, rebuilt from a report reference.
 *
 * The resolver is asked about the document rather than reimplemented here, so the
 * report uses the engine's declaration rule: a removed configured list makes a
 * declaration stale even when manual moves become unrestricted. An exceptional
 * recording and a scripted entry are facts the reference carries as booleans; only
 * the identities the resolver compares are synthesized, and they are never persisted.
 */
export function routedTask(card: WorkflowCardReference): RoutedTask {
  const task = { columnId: card.columnId } as RoutedTask;
  const recorded = card.recordedTransition;
  if (recorded !== undefined) {
    task.recordedTransition = {
      fromColumnId: recorded.fromColumnId,
      columnId: recorded.columnId,
      at: '',
      ...(recorded.exception === true ? { exception: { id: 'report', sessionId: 'report', turn: 0, entryId: 'report' } } : {}),
    };
  }
  if (card.scriptedEntry === true) {
    task.stageEntry = { id: 'report', columnId: card.columnId, stageIdentity: 'report' } as Task['stageEntry'];
    task.scripted = { entryId: 'report', stageIdentity: 'report' } as Task['scripted'];
  }
  return task;
}

/** Whether the engine's placement check would permit an admitted advance in one document. */
export function pendingPermitted(workflow: Workflow, card: WorkflowCardReference): boolean {
  const pending = card.pendingTransition;
  if (pending === undefined) return false;
  // The engine skips the route check for the stored override and for a card that
  // already stands at the destination; every other placement re-tests the route.
  return pending.transitionOverride === true || card.columnId === pending.columnId || canTransition(workflow, card.columnId, pending.columnId);
}

/**
 * The candidate-caused routing effect on one card, by the engine's own rules.
 *
 * Only a newly affected route is reported: intent that was already stale, an
 * exceptional recording, a scripted entry, an override, and a card already placed at
 * its destination resolve the same way before and after the edit.
 */
export function routeImpact(before: Workflow, after: Workflow, card: WorkflowCardReference): RouteImpact | undefined {
  const declared = card.recordedTransition;
  if (declared !== undefined) {
    const task = routedTask(card);
    const resolution = recordedTransition(after, task);
    const previous = recordedTransition(before, task);
    if (resolution.kind === 'stale' && previous.kind !== 'stale') {
      return { kind: 'route-stale', destination: declared.columnId, advance: 'declared', reason: resolution.reason };
    }
  }
  if (card.pendingTransition !== undefined && pendingPermitted(before, card) && !pendingPermitted(after, card)) {
    return { kind: 'placement-blocked', destination: card.pendingTransition.columnId, advance: 'pending' };
  }
  return undefined;
}
