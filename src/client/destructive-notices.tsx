import React from 'react';
import type { Task } from '../shared/types.js';
import { describeOperation } from './operation-description.js';
import { OperationRecoveryActions } from './operation-actions.js';

function destructiveOperation(task: Task) {
  const operation = task.operation;
  return operation && (operation.request.kind === 'delete' || operation.request.kind === 'remove') ? operation : null;
}

function stateLabel(task: Task): string {
  const operation = destructiveOperation(task)!;
  if (operation.phase === 'queued') return 'Queued';
  if (operation.phase === 'waiting') return 'Waiting for idle';
  if (operation.request.kind === 'delete') return 'Deleting…';
  return 'Removing worktree…';
}

/**
 * One board-level strip for destructive operations: queued/running work,
 * failures with their recovery actions, and retained plain checkouts. Per-task
 * detail stays in the card and the drawer.
 */
export function DestructiveOperationsNotice({ tasks, retained, onDismissRetained, onOpen, onRetry, onForce, onReturn }: {
  tasks: readonly Task[];
  retained: string | null;
  onDismissRetained: () => void;
  onOpen: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onForce: (taskId: string) => void;
  onReturn: (taskId: string) => void;
}) {
  const entries = tasks.filter(task => destructiveOperation(task) !== null);
  const active = entries.filter(task => task.operation!.phase !== 'failed');
  const failed = entries.filter(task => task.operation!.phase === 'failed');
  if (active.length === 0 && failed.length === 0 && retained === null) return null;
  return <section className="kb-destructive-notice" aria-label="Destructive operations" role="region">
    {active.length > 0 && <div className="kb-destructive-row">
      <strong>{active.length === 1 ? '1 destructive operation' : active.length + ' destructive operations'}</strong>
      <ul className="kb-batch-list">{active.map(task => <li key={task.id}><button type="button" className="kb-link-button" onClick={() => onOpen(task.id)}>{task.title}</button> — {stateLabel(task)}</li>)}</ul>
    </div>}
    {failed.map(task => {
      const operation = task.operation!;
      const description = describeOperation(task, operation);
      return <div className="kb-destructive-row kb-destructive-row-failed" key={task.id}>
        <div><strong>{description.title}: {task.title}</strong><p className="kb-hint">{operation.error?.message ?? description.detail}</p></div>
        <OperationRecoveryActions description={description} context={task.title} onRetry={() => onRetry(task.id)} onForce={() => onForce(task.id)} onReturn={() => onReturn(task.id)} />
        <button type="button" className="kb-button" onClick={() => onOpen(task.id)}>Open task</button>
      </div>;
    })}
    {retained !== null && <div className="kb-destructive-row">
      <p className="kb-hint">Task deleted. The checkout at <code>{retained}</code> was left on disk.</p>
      <button type="button" className="kb-button" onClick={onDismissRetained}>Dismiss</button>
    </div>}
  </section>;
}
