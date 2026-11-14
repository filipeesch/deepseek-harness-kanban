import type { ContextOperation } from '../shared/types.js';

/** What one failed pass proves about the creation attempt. */
export interface CreateFailureClassification {
  /** Whether the attempt is retained for a recovery route to resolve. */
  keepAttempt: boolean;
  /** The phase the failure is attributed to. */
  failedPhase: ContextOperation['phase'];
  /** Whether this failure may have left something behind. */
  gitAttempted: boolean;
}

export interface CreateFailureInput {
  operation: ContextOperation;
  /** Whether the write command was invoked in this pass. */
  invoked: boolean;
  /** Whether an attempt was already recorded before this pass. */
  previousAttempt: boolean;
}

/**
 * Attributes a failed creation. Only a command that actually reached the write can
 * have changed the destination, so a refusal raised before it never keeps an
 * attempt; everything after it keeps its proof until the recovery proves what Git
 * left.
 */
export class CreateFailureClassifier {
  classify(input: CreateFailureInput): CreateFailureClassification {
    const { operation, invoked, previousAttempt } = input;
    if (operation.request.kind !== 'create') return { keepAttempt: false, failedPhase: operation.phase, gitAttempted: false };
    const attempted = invoked || previousAttempt;
    return { keepAttempt: attempted, failedPhase: attempted ? operation.phase : 'preflight', gitAttempted: attempted };
  }
}
