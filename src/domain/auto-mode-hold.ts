import type { AutoModeHold, AutoModeState, Task } from '../shared/types.js';
import { invariant } from '../shared/errors.js';
import { hasUnresolvedEntry } from './stage-entry.js';

/** The longest pause reason an agent may record, in characters. */
export const PAUSE_REASON_LIMIT = 280;

/** The task fields the pause rule reads. */
export type AdvanceBlockedTask = Pick<Task, 'columnId' | 'instructionPending' | 'operation' | 'pendingTransition' | 'autoMode'>;

/** The pause the agent requested, when one is recorded. */
export function activeHold(task: Pick<Task, 'autoMode'>): AutoModeHold | undefined {
  return task.autoMode?.hold;
}

/**
 * Whether the host must not admit an automatic advance for this task right now.
 * The decision and the admission both read this one rule, so a condition can
 * never block in one place and pass in the other.
 */
export function blocksAdvance(task: AdvanceBlockedTask): boolean {
  return task.operation !== null
    || task.pendingTransition !== undefined
    || hasUnresolvedEntry(task)
    || activeHold(task) !== undefined;
}

/**
 * Trim one requested reason and reject an empty or oversized value. Nothing is
 * truncated: a shortened reason would present a request the agent did not make.
 */
export function normalizePauseReason(value: unknown): string {
  invariant(typeof value === 'string', 'INVALID_INPUT', 'A pause reason is required.');
  const reason = value.trim();
  invariant(reason.length > 0, 'PAUSE_REASON_REQUIRED', 'A pause requires a nonempty reason.');
  invariant(reason.length <= PAUSE_REASON_LIMIT, 'PAUSE_REASON_TOO_LONG', 'A pause reason must be ' + PAUSE_REASON_LIMIT + ' characters or fewer.');
  return reason;
}

/** Record one hold on a task whose auto mode is enabled. */
export function applyHold(task: Pick<Task, 'autoMode'>, reason: string, at: string): void {
  const state = task.autoMode;
  invariant(state !== undefined, 'AUTO_MODE_DISABLED', 'The task does not advance because auto mode is disabled.');
  state.hold = { reason, at };
}

/**
 * Drop both the agent pause and the diagnostic pause from one task record.
 * Moving, enabling, and resuming all clear through here, so the two records can
 * never diverge. Returns whether anything changed.
 */
export function clearAutoModeState(task: Pick<Task, 'autoMode'>): boolean {
  const state: AutoModeState | undefined = task.autoMode;
  if (state === undefined) return false;
  let changed = false;
  if (state.hold !== undefined) { delete state.hold; changed = true; }
  if (state.pause !== undefined) { delete state.pause; changed = true; }
  return changed;
}
