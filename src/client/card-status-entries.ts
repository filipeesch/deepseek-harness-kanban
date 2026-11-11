import type { Task } from '../shared/types.js';
import type { AutoModeStatus } from './auto-mode.js';

export interface CardStatusEntry { key: string; tone: 'danger' | 'pending'; label: string; alert?: boolean }

/**
 * The card's status lines, in a stable order: operation, transition,
 * stage-instruction failure, then auto mode. The diagnostic pause is a separate
 * line so a turn that failed while the task was paused is never hidden by the
 * pause the agent requested.
 */
export function cardStatusEntries(task: Task, runFailure?: string, autoStatus?: AutoModeStatus, pauseStatuses: readonly AutoModeStatus[] = []): CardStatusEntry[] {
  const entries: CardStatusEntry[] = [];
  if (task.operation) {
    const operation = task.operation;
    const failed = operation.phase === 'failed';
    const destructive = operation.request.kind === 'delete' || operation.request.kind === 'remove';
    const deleteKind = operation.request.kind === 'delete';
    const label = destructive
      ? failed
        ? (deleteKind ? 'Deletion needs attention' : 'Worktree removal needs attention')
        : operation.phase === 'queued'
          ? (deleteKind ? 'Queued to delete' : 'Queued to remove worktree')
          : operation.phase === 'waiting'
            ? (deleteKind ? 'Deletion waiting for idle' : 'Removal waiting for idle')
            : operation.phase === 'preflight'
              ? (deleteKind ? 'Checking before deleting…' : 'Checking before removing…')
              : (deleteKind ? 'Deleting…' : 'Removing worktree…')
      : failed ? 'Operation failed' : 'Operation: ' + operation.phase;
    entries.push({ key: 'operation', tone: failed ? 'danger' : 'pending', label });
  }
  if (task.pendingTransition && task.pendingTransition.origin !== 'auto') {
    const failed = task.pendingTransition.status === 'failed';
    entries.push({ key: 'transition', tone: failed ? 'danger' : 'pending', label: failed ? 'Confirmed action failed' : 'Confirmed action: ' + task.pendingTransition.status });
  }
  if (runFailure !== undefined) entries.push({ key: 'instruction', tone: 'danger', label: runFailure, alert: true });
  if (autoStatus !== undefined) entries.push({ key: 'auto', tone: autoStatus.tone, label: autoStatus.label, ...(autoStatus.alert === true ? { alert: true } : {}) });
  for (const [index, value] of pauseStatuses.entries()) entries.push({ key: 'auto-pause-' + index, tone: value.tone, label: value.label, ...(value.alert === true ? { alert: true } : {}) });
  return entries;
}
