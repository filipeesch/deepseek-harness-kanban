import React from 'react';
import type { OperationDescription } from './operation-description.js';

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
  if (!description.retry && !description.return && !description.force) return null;
  return <div className="kb-actions">
    {description.force && onForce && <button type="button" className="kb-button kb-danger" disabled={pending} onClick={onForce}>Force remove checkout…{suffix}</button>}
    {description.retry && onRetry && <button type="button" className="kb-button" disabled={pending} onClick={onRetry}>{pending ? 'Working…' : description.retryLabel + suffix}</button>}
    {description.return && onReturn && <button type="button" className="kb-button" disabled={pending} onClick={onReturn}>{pending ? 'Working…' : description.returnLabel + suffix}</button>}
  </div>;
}
