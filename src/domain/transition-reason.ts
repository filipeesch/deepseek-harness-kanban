import { invariant } from '../shared/errors.js';

/**
 * The longest transition reason the host stores or composes itself, in
 * characters. A decision gate composes its destination reason from an option
 * title, two prefixes, and the person's observation, and sizes the observation so
 * the whole reason fits this ceiling.
 */
export const TRANSITION_REASON_LIMIT = 1000;

/** The longest reason an agent may declare through the transition tool, in characters. */
export const AGENT_TRANSITION_REASON_LIMIT = 200;

/**
 * Trim one declared reason and reject an empty or oversized value. Nothing is
 * truncated: a shortened reason would deliver a justification the agent never
 * wrote, and the destination stage would act on words it did not receive. The
 * limit defaults to the stored ceiling; the agent's declaration passes its own.
 */
export function normalizeTransitionReason(value: unknown, limit: number = TRANSITION_REASON_LIMIT): string {
  invariant(typeof value === 'string', 'INVALID_INPUT', 'Declaring a transition requires a reason.');
  const reason = value.trim();
  invariant(reason.length > 0, 'TRANSITION_REASON_REQUIRED', 'Declaring a transition requires a nonempty reason.');
  invariant(reason.length <= limit, 'TRANSITION_REASON_TOO_LONG', 'A transition reason must be ' + limit + ' characters or fewer.');
  return reason;
}
