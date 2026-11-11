import type { OperationDescription } from './operation-description.js';

export type RecoveryActionId = 'force' | 'retry' | 'return';

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
  if (description.retry) actions.push({ id: 'retry', label: description.retryLabel + suffix });
  if (description.return) actions.push({ id: 'return', label: description.returnLabel + suffix });
  return actions;
}
