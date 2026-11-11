import { invariant } from '../shared/errors.js';

/** The longest transition reason an agent may record, in characters. */
export const TRANSITION_REASON_LIMIT = 1000;

/**
 * Trim one declared reason and reject an empty or oversized value. Nothing is
 * truncated: a shortened reason would deliver a justification the agent never
 * wrote, and the destination stage would act on words it did not receive.
 */
export function normalizeTransitionReason(value: unknown): string {
  invariant(typeof value === 'string', 'INVALID_INPUT', 'Declaring a transition requires a reason.');
  const reason = value.trim();
  invariant(reason.length > 0, 'TRANSITION_REASON_REQUIRED', 'Declaring a transition requires a nonempty reason.');
  invariant(reason.length <= TRANSITION_REASON_LIMIT, 'TRANSITION_REASON_TOO_LONG', 'A transition reason must be ' + TRANSITION_REASON_LIMIT + ' characters or fewer.');
  return reason;
}
