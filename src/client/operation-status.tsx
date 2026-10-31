import React from 'react';
import type { Task } from '../shared/types.js';
import { describeOperation } from './operation-description.js';
import { OperationRecoveryActions } from './operation-actions.js';
import { ProblemNotice, useAction, type RunCommand } from './ui.js';

export function OperationStatus({ task, run, sessionTitles, onForce }: {
  task: Task;
  run: RunCommand;
  sessionTitles?: { title(sessionId: string): string | undefined };
  onForce?: (taskId: string) => void;
}) {
  const action = useAction(run);
  const operation = task.operation;
  if (!operation) return null;
  const description = describeOperation(task, operation);
  const stateLabel = operation.phase === 'queued' ? 'Queued' : operation.phase === 'waiting' ? 'Waiting' : operation.phase === 'failed' ? 'Failed' : 'In progress';
  const duplicateActionError = action.error !== null && operation.error !== undefined && action.error.code === operation.error.code && action.error.message === operation.error.message;
  return <div className={'kb-operation' + (operation.phase === 'failed' ? ' kb-operation-failed' : '')} aria-live="polite">
    <div className="kb-operation-heading"><p role="status"><strong>{description.title}</strong></p><span className="kb-status">{stateLabel}</span></div>
    <p className="kb-hint">{description.detail}</p>
    {description.facts.length > 0 && <dl className="kb-operation-facts">{description.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
    <ProblemNotice problem={operation.error ?? null} title={description.title} sessionTitles={sessionTitles} />
    {!duplicateActionError && <ProblemNotice problem={action.error} title={description.title} sessionTitles={sessionTitles} />}
    <OperationRecoveryActions
      description={description}
      pending={action.pending}
      onRetry={() => void action.execute({ type: 'operation.retry', taskId: task.id })}
      onReturn={() => void action.execute({ type: 'operation.return', taskId: task.id })}
      {...(onForce ? { onForce: () => onForce(task.id) } : {})}
    />
  </div>;
}
