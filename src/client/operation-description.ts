import type { ContextOperation, Task } from '../shared/types.js';

export interface OperationFact { label: string; value: string }
export interface OperationDescription {
  title: string;
  detail: string;
  facts: OperationFact[];
  retry: boolean;
  return: boolean;
  force: boolean;
  discard: boolean;
  cancel: boolean;
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

/**
 * The checkout state one creation attempt left, as the host last observed it. A
 * partial checkout is named for what it is rather than reported as "not completed"
 * beside megabytes that exist on disk.
 */
export function checkoutStateValue(operation: ContextOperation): string | undefined {
  if (operation.request.kind !== 'create' && operation.request.kind !== 'attach') return undefined;
  if (operation.request.kind === 'attach') return operation.gitCompleted ? 'Prepared' : 'Not completed';
  if (operation.gitCompleted) return 'Prepared';
  // An operation still running has no observed failure yet; name the step it is in.
  if (operation.phase === 'git') return 'Creating';
  if (operation.phase !== 'failed') return 'Not started';
  const observed = operation.createAttempt?.observed;
  if (observed === undefined) return operation.createAttempt === undefined ? 'No attempt recorded' : 'Awaiting recovery';
  if (observed.registration === 'registered') return 'Registered';
  if (observed.directory === 'absent') return 'Absent';
  if (observed.directory === 'empty') return 'Empty destination';
  return 'Incomplete (directory on disk, not registered)';
}

function checkoutFact(operation: ContextOperation): OperationFact | undefined {
  const value = checkoutStateValue(operation);
  return value === undefined ? undefined : { label: 'Checkout', value };
}

/** Whether the failed creation left a checkout the discard may remove. */
function incompleteCheckout(operation: ContextOperation): boolean {
  if (operation.request.kind !== 'create' || operation.phase !== 'failed') return false;
  const observed = operation.createAttempt?.observed;
  if (observed === undefined) return false;
  return observed.directory === 'present' && observed.registration !== 'registered';
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
  else if (operation.phase === 'queued') detail = 'Queued after the other destructive operations.';
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
  const checkout = checkoutFact(operation);
  if (checkout !== undefined) facts.push(checkout);
  if (operation.request.kind === 'create' && operation.createAttempt?.sourceCommit !== undefined) {
    facts.push({ label: 'Branch commit', value: operation.createAttempt.sourceCommit });
  }
  if (operation.request.kind === 'create' && operation.createAttempt !== undefined) {
    facts.push({ label: 'Branch', value: operation.createAttempt.branchName });
    if (operation.createAttempt.reusedBranch === true) facts.push({ label: 'Branch reuse', value: 'Reuses the branch left by the failed attempt' });
  }
  if (operation.request.kind === 'delete') facts.push({ label: 'Conversations', value: String(total) });
  return {
    title,
    detail,
    facts,
    retry: operation.phase === 'queued' || operation.phase === 'waiting' || failed,
    return: failed && operation.request.kind !== 'return' && !archivingStarted(operation),
    force: failed && (operation.request.kind === 'delete' || operation.request.kind === 'remove') && operation.error?.code === 'SHARED_WORKTREE',
    discard: incompleteCheckout(operation),
    cancel: operation.phase === 'git' || operation.phase === 'removing',
    retryLabel: operation.request.kind === 'delete' ? 'Retry deletion' : 'Retry ' + label.toLowerCase(),
    returnLabel: 'Return chats to project',
  };
}
