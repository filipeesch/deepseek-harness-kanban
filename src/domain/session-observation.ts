import type { SessionObservation, SessionObservationState } from '../shared/types.js';

/** The host's code for a durable log that cannot be validated. */
export const UNREADABLE_SESSION_CODE = 'SESSION_QUERY_CORRUPT_SESSION';
/** The host's code for a conversation with no durable log. */
export const MISSING_SESSION_CODE = 'SESSION_QUERY_SESSION_NOT_FOUND';

/**
 * The failure shape both halves see: a host error thrown by the observation
 * read, and a client \`RemoteFailure\` carried by a Session that failed to open.
 * Only \`code\` decides the state; a message is never parsed for intent.
 */
export interface SessionFailureLike { readonly code?: unknown; readonly message?: unknown }

/** A state's short label, used by the card status line and the diagnosis title. */
export function sessionObservationLabel(state: SessionObservationState): string {
  return state === 'unreadable' ? 'Session log unreadable' : 'Session log missing';
}

/** One sentence naming what the state means for the conversation, without prescribing a retry. */
export function sessionObservationAdvice(state: SessionObservationState): string {
  return state === 'unreadable'
    ? 'The stored log cannot be validated, so this conversation cannot open.'
    : 'The stored log is missing, so this conversation cannot open.';
}

/** The fallback cause when the host reports none; an empty diagnosis would hide the state. */
function defaultCause(state: SessionObservationState): string {
  return state === 'unreadable' ? 'The stored Session log failed validation.' : 'No stored Session log was found.';
}

/**
 * Classify one failed Session observation.
 * @param failure - the error the host threw, or the client's open failure.
 * @returns the classified observation, or null when the failure is not a Session observation failure.
 */
export function classifySessionFailure(failure: SessionFailureLike | null | undefined): SessionObservation | null {
  const code = typeof failure?.code === 'string' ? failure.code : '';
  const state: SessionObservationState | undefined = code === UNREADABLE_SESSION_CODE
    ? 'unreadable'
    : code === MISSING_SESSION_CODE ? 'missing' : undefined;
  if (state === undefined) return null;
  const message = typeof failure?.message === 'string' ? failure.message : '';
  // Only blankness decides the fallback: a nonblank cause is preserved exactly as the host wrote it.
  return { state, cause: message.trim().length > 0 ? message : defaultCause(state) };
}

/** Whether two observations describe the same state and cause. */
export function sameSessionObservation(left: SessionObservation | undefined, right: SessionObservation | undefined): boolean {
  return left?.state === right?.state && left?.cause === right?.cause;
}

/** Whether a state is the worse one for a single card line; an unreadable log always outranks a missing one. */
function dominant(state: SessionObservationState, current: SessionObservationState | undefined): boolean {
  return state === 'unreadable' || current === undefined;
}

/**
 * Aggregate several conversations of one task into the single observation a card presents.
 * @param values - every observation resolved for the task's conversations.
 * @returns the dominant observation, or undefined when none of them failed.
 */
export function mergeSessionObservations(values: readonly SessionObservation[]): SessionObservation | undefined {
  let selected: SessionObservation | undefined;
  for (const value of values) {
    if (selected !== undefined && !dominant(value.state, selected.state)) continue;
    selected = value;
  }
  return selected;
}
