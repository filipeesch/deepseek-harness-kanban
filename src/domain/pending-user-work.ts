import type { PendingUserWork, PendingUserWorkKind } from '../shared/types.js';
import { NO_PENDING_USER_WORK } from '../shared/types.js';

/** Stable presentation order, so a merged value never reshuffles between reads. */
export const PENDING_USER_WORK_KINDS: readonly PendingUserWorkKind[] = ['decision-question', 'native-question', 'approval', 'queued-prompt'];

/** One pending value with a normalized kind order; a queued count always carries its kind. */
export function pendingUserWork(kinds: readonly PendingUserWorkKind[], queuedPrompts = 0): PendingUserWork {
  const queued = Number.isSafeInteger(queuedPrompts) && queuedPrompts > 0 ? queuedPrompts : 0;
  const present = new Set(PENDING_USER_WORK_KINDS.filter(kind => kinds.includes(kind) || (kind === 'queued-prompt' && queued > 0)));
  return present.size === 0 ? NO_PENDING_USER_WORK : { kinds: PENDING_USER_WORK_KINDS.filter(kind => present.has(kind)), queuedPrompts: queued };
}

/** Union of several conversations' pending work, with queued prompts summed. */
export function mergePendingUserWork(values: readonly PendingUserWork[]): PendingUserWork {
  if (values.length === 0) return NO_PENDING_USER_WORK;
  const kinds = new Set<PendingUserWorkKind>();
  let queuedPrompts = 0;
  for (const value of values) {
    for (const kind of value.kinds) kinds.add(kind);
    queuedPrompts += value.queuedPrompts;
  }
  return pendingUserWork([...kinds], queuedPrompts);
}

/** Whether the value holds any user-facing input at all. */
export function hasPendingUserWork(value: PendingUserWork | undefined): boolean {
  return value !== undefined && value.kinds.length > 0;
}

/** Whether the value awaits a reply, which excludes a queued prompt the user merely typed ahead. */
export function awaitingReply(value: PendingUserWork | undefined): boolean {
  return value !== undefined && value.kinds.some(kind => kind !== 'queued-prompt');
}

/** Value comparison used by the attention change detection. */
export function samePendingUserWork(left: PendingUserWork, right: PendingUserWork): boolean {
  return left.queuedPrompts === right.queuedPrompts
    && left.kinds.length === right.kinds.length
    && left.kinds.every((kind, index) => kind === right.kinds[index]);
}
