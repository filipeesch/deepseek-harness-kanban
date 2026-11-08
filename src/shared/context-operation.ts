import type { ContextOperation } from './types.js';

/** Whether a failed deletion already archived a conversation and must be resumed, never replaced. */
export function deletionStarted(operation: ContextOperation): boolean {
  if (operation.request.kind !== 'delete') return false;
  return operation.phase === 'archiving'
    || operation.archivedSessionIds.length > 0
    || operation.error?.details?.failedPhase === 'archiving';
}

/**
 * A deletion may discard a failed operation that left no unclaimed create attempt and
 * did not start archiving. The deletion owns the checkout binding and retains anything
 * it cannot verify, so replacing the journal cannot lose work silently.
 */
export function replaceableByDeletion(operation: ContextOperation): boolean {
  return operation.phase === 'failed' && operation.createAttempt === undefined && !deletionStarted(operation);
}
