import type { ContextOperation, Task } from '../shared/types.js';

export interface OperationFact { label: string; value: string }
export interface OperationDescription {
  title: string;
  detail: string;
  facts: OperationFact[];
  retry: boolean;
  return: boolean;
  retryLabel: string;
  returnLabel: string;
}

const LABELS: Record<ContextOperation['request']['kind'], string> = {
  create: 'Worktree creation',
  attach: 'Worktree attachment',
  return: 'Return to project',
  remove: 'Worktree removal',
  delete: 'Task deletion',
};

function archivingStarted(operation: ContextOperation): boolean {
  if (operation.request.kind !== 'delete') return false;
  return operation.phase === 'archiving'
    || operation.archivedSessionIds.length > 0
    || operation.error?.details?.failedPhase === 'archiving';
}

function returned(task: Task, operation: ContextOperation): string {
  return operation.switchedSessionIds.length + '/' + task.sessionIds.length;
}

function archived(task: Task, operation: ContextOperation): string {
  return operation.archivedSessionIds.length + '/' + task.sessionIds.length;
}

export function describeOperation(task: Task, operation: ContextOperation): OperationDescription {
  const label = LABELS[operation.request.kind];
  const total = task.sessionIds.length;
  const failedPhase = typeof operation.error?.details?.failedPhase === 'string'
    ? operation.error.details.failedPhase
    : operation.phase;
  const failed = operation.phase === 'failed';
  const title = failed ? label + ' needs attention' : label;
  let detail: string;
  if (failed) detail = failedPhase === 'failed'
    ? 'The operation stopped before completion. Review what completed before retrying.'
    : 'The operation stopped during ' + failedPhase + '. Review what completed before retrying.';
  else if (operation.phase === 'waiting') detail = 'Waiting for every conversation to become idle.';
  else if (operation.phase === 'preflight') detail = 'Checking the task context and permissions.';
  else if (operation.phase === 'git') detail = operation.request.kind === 'create' || operation.request.kind === 'attach'
    ? 'Creating the checkout.'
    : 'Removing the worktree.';
  else if (operation.phase === 'switching') detail = 'Returning conversations to the project: ' + returned(task, operation) + '.';
  else if (operation.phase === 'removing') detail = 'Removing the worktree.';
  else if (operation.phase === 'archiving') detail = 'Archiving conversations: ' + archived(task, operation) + '.';
  else detail = 'The operation is complete.';

  const facts: OperationFact[] = [];
  if (operation.request.kind === 'delete' || operation.request.kind === 'remove' || operation.request.kind === 'return') {
    facts.push({ label: 'Chats returned', value: returned(task, operation) });
  }
  if (operation.request.kind === 'delete') facts.push({ label: 'Conversations archived', value: archived(task, operation) });
  const worktree = operation.targetPath ?? task.worktree?.path;
  if (worktree && (operation.request.kind === 'delete' || operation.request.kind === 'remove')) {
    facts.push({ label: 'Worktree', value: worktree });
    if (task.worktree?.branch) facts.push({ label: 'Branch', value: task.worktree.branch === 'HEAD' ? 'HEAD (detached)' : task.worktree.branch });
  }
  const target = operation.targetDirectory ?? operation.targetPath ?? ((operation.request.kind === 'create' || operation.request.kind === 'attach') ? operation.request.path : undefined);
  if (target && (operation.request.kind === 'create' || operation.request.kind === 'attach')) {
    facts.push({ label: 'Target', value: target });
  }
  if (operation.request.kind === 'remove' || operation.request.kind === 'delete') {
    facts.push({ label: 'Checkout', value: operation.gitCompleted ? 'Removed' : 'Not completed' });
  }
  if (operation.request.kind === 'create' || operation.request.kind === 'attach') {
    facts.push({ label: 'Checkout', value: operation.gitCompleted ? 'Prepared' : 'Not completed' });
  }
  if (operation.request.kind === 'delete') facts.push({ label: 'Conversations', value: String(total) });
  return {
    title,
    detail,
    facts,
    retry: operation.phase === 'waiting' || failed,
    return: failed && operation.request.kind !== 'return' && !archivingStarted(operation),
    retryLabel: operation.request.kind === 'delete' ? 'Retry deletion' : 'Retry ' + label.toLowerCase(),
    returnLabel: 'Return chats to project',
  };
}
