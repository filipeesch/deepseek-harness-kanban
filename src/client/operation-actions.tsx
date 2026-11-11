import React from 'react';
import type { OperationDescription } from './operation-description.js';
import { recoveryActionDescriptors, type RecoveryActionId } from './operation-recovery-actions.js';

/**
 * Shared recovery controls for a described context operation. The confirmation,
 * the drawer status, and the board notice render the same actions.
 */
export function OperationRecoveryActions({ description, pending = false, context, onRetry, onReturn, onForce }: {
  description: OperationDescription;
  pending?: boolean;
  /** Distinguishes the same action when it is repeated in the board notice. */
  context?: string;
  onRetry?: () => void;
  onReturn?: () => void;
  onForce?: () => void;
}) {
  const suffix = context ? ' — ' + context : '';
  const handlers: Record<RecoveryActionId, (() => void) | undefined> = { force: onForce, retry: onRetry, return: onReturn };
  const actions = recoveryActionDescriptors(description, suffix).filter(action => handlers[action.id] !== undefined);
  if (actions.length === 0) return null;
  return <div className="kb-actions">{actions.map(action => <button
    key={action.id}
    type="button"
    className={'kb-button' + (action.tone === 'danger' ? ' kb-danger' : '')}
    disabled={pending}
    onClick={handlers[action.id]}
  >{action.id !== 'force' && pending ? 'Working…' : action.label}</button>)}</div>;
}
