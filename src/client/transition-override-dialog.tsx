import React, { useId } from 'react';
import type { Problem } from '../shared/types.js';
import { Modal, ProblemNotice } from './ui.js';

export interface TransitionOverrideDialogProps {
  taskTitle: string;
  workflowName: string;
  sourceName: string;
  destinationName: string;
  pending: boolean;
  problem: Problem | null;
  canRetry: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function TransitionOverrideDialog({ taskTitle, workflowName, sourceName, destinationName, pending, problem, canRetry, onCancel, onConfirm }: TransitionOverrideDialogProps) {
  const summary = useId();
  const stale = problem !== null && !canRetry;
  const primaryLabel = stale ? 'Close' : pending ? 'Moving…' : problem ? 'Try again' : 'Move anyway';
  const primaryAction = stale ? onCancel : onConfirm;
  return <Modal title={'Move to ' + destinationName + '?'} onClose={onCancel} busy={pending} initialFocus="cancel" describedBy={summary}>
    <div className="kb-transition-dialog">
      <div className="kb-transition-identity"><strong>{taskTitle}</strong><span className="kb-hint">{workflowName}</span></div>
      <p id={summary}>The {workflowName} workflow does not allow moving this card from {sourceName} to {destinationName}.</p>
      <p>Moving anyway affects only this card. The workflow configuration is unchanged.</p>
      <ProblemNotice problem={problem} title="The move needs attention" />
      <div className="kb-actions">
        <button type="button" className="kb-button" data-kb-initial-focus disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" className="kb-button kb-primary" disabled={pending} onClick={primaryAction}>{primaryLabel}</button>
      </div>
    </div>
  </Modal>;
}
