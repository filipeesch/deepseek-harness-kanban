import { invariant } from './errors.js';
import type { ContextOperation, Task } from './types.js';

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

/**
 * A failed destructive journal, which may carry force or discard consent the
 * person gave in the interface. Re-opening it from another surface would repeat
 * a stronger removal than that surface states, so recovery stays an interface
 * decision and every other admission refuses it.
 */
export function failedDestructiveJournal(operation: ContextOperation | null | undefined): ContextOperation | undefined {
  if (operation === undefined || operation === null || operation.phase !== 'failed') return undefined;
  return operation.request.kind === 'delete' || operation.request.kind === 'remove' ? operation : undefined;
}

/**
 * Refuse any admission that would re-open a failed destructive journal. It is
 * called before a command reaches its side effects and again inside the per-task
 * lane that would otherwise retry or replace the journal, so a failure landing
 * while a caller waits cannot be re-admitted with consent it never stated.
 */
export function assertFreshDestructiveJournal(task: Task): void {
  const failed = failedDestructiveJournal(task.operation);
  invariant(failed === undefined, 'DELETION_RECOVERY_REQUIRED', 'This card has a recorded deletion that failed. Resolve it in the interface, where retry, force, and discard are decided with the person.');
}