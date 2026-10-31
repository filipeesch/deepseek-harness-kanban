import type { Command, ContextOperation, Problem, Task } from '../shared/types.js';
import type { DestructiveCommand, DestructiveRequest } from './destructive-dialogs.js';

export interface CommandFailureAdvice {
  notice?: Problem;
  discard?: DestructiveRequest;
}

export interface CommandFailureInput {
  command: Command;
  problem: Problem;
  task?: Task;
  priorOperation?: ContextOperation;
  allowDiscard: boolean;
}

interface RemovalOrigin {
  command?: DestructiveCommand;
  notice?: Problem;
}

/**
 * The removal a failed command asked for, so a discard consent can repeat the exact
 * target. A retry rebuilds it from the recorded operation; a missing target becomes a
 * notice instead of a consent for an unknown path.
 */
function removalOrigin(command: Command, task: Task | undefined, priorOperation: ContextOperation | undefined): RemovalOrigin {
  if ((command.type === 'task.delete' || command.type === 'worktree.remove') && !command.discardChanges) return { command };
  if (command.type !== 'operation.retry' || !task || !priorOperation) return {};
  const request = priorOperation.request;
  if ((request.kind !== 'remove' && request.kind !== 'delete') || request.discardChanges) return {};
  const capturedPath = request.expectedWorktreePath !== undefined ? request.expectedWorktreePath : priorOperation.targetPath;
  if (capturedPath === undefined) return { notice: { code: 'CONFIRMATION_REQUIRED', message: 'The original removal target is unavailable. Return to base and review a new removal confirmation.' } };
  return { command: { type: request.kind === 'delete' ? 'task.delete' : 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: capturedPath, ...(request.force === true ? { force: true } : {}) } };
}

/** Classifies a failed command into a board notice and an optional discard confirmation. */
export function adviseCommandFailure({ command, problem, task, priorOperation, allowDiscard }: CommandFailureInput): CommandFailureAdvice {
  const origin = removalOrigin(command, task, priorOperation);
  const advice: CommandFailureAdvice = {};
  if (origin.notice) advice.notice = origin.notice;
  if (allowDiscard && problem.code === 'DISCARD_REQUIRED' && origin.command && task) {
    const expectedWorktreePath = origin.command.expectedWorktreePath ?? task.worktree?.path ?? null;
    advice.discard = {
      command: origin.command, taskId: task.id, title: task.title,
      path: expectedWorktreePath, expectedWorktreePath,
      branch: task.worktree?.branch ?? null, owned: task.worktree?.owned, error: problem,
    };
  }
  return advice;
}
