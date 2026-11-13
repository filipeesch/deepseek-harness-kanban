import type { OperationDescription } from './operation-description.js';

export type RecoveryActionId = 'force' | 'discard' | 'retry' | 'cancel' | 'return';

/** One recovery control a described operation permits. */
export interface RecoveryActionDescriptor {
  id: RecoveryActionId;
  label: string;
  tone?: 'danger';
}

/**
 * The recovery controls an operation permits, as data. The drawer status and the
 * board notice render the same descriptors, so their labels and order cannot drift.
 */
export function recoveryActionDescriptors(description: OperationDescription, suffix = ''): RecoveryActionDescriptor[] {
  const actions: RecoveryActionDescriptor[] = [];
  if (description.force) actions.push({ id: 'force', label: 'Force remove checkout…' + suffix, tone: 'danger' });
  if (description.discard) actions.push({ id: 'discard', label: 'Discard incomplete checkout and retry…' + suffix, tone: 'danger' });
  if (description.retry) actions.push({ id: 'retry', label: description.retryLabel + suffix });
  if (description.cancel) actions.push({ id: 'cancel', label: 'Cancel checkout' + suffix });
  if (description.return) actions.push({ id: 'return', label: description.returnLabel + suffix });
  return actions;
}
