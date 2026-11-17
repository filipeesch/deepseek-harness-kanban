import { KanbanError, invariant } from '../shared/errors.js';
import type { OperationRequest, Project, Task } from '../shared/types.js';
import type { OperationJournal } from './operation-journal.js';
import { repositoryLane } from './repository-lane.js';

export interface AdmissionStore {
  locate(taskId: string): { task: Task; project: Project };
}

/** One admitted context operation, ready for its repository lane. */
export interface BackgroundOperationJob {
  lane: string;
  /** The task that owns the operation journal. */
  ownerId: string;
  operationId: string;
}

/** The one persisted-binding comparison shared by admission and the command path. */
export function bindingMatches(task: Task, expectedWorktreePath: string | null): boolean {
  return (task.worktree?.path ?? null) === expectedWorktreePath;
}

/**
 * The operation kinds whose work belongs on a repository lane: creating, removing,
 * and deleting a checkout are slow enough that the command must return first. An
 * attachment keeps its synchronous path, so a retried attachment stays awaited.
 */
export function isBackgroundOperationKind(kind: OperationRequest['kind']): boolean {
  return kind === 'create' || kind === 'remove' || kind === 'delete';
}

/**
 * Decides whether an already recorded context operation may be queued, using
 * persisted state only. The kind-specific preconditions live here: a destructive
 * operation re-checks the binding the person confirmed, while a creation only
 * needs its own journal and an idle native admission. The authoritative
 * preflight — conversation idleness, canonical target stability, checkout
 * sharing, and local changes — belongs to execution inside the queue lane, so
 * admission never inspects Git, native conversations, or the filesystem.
 */
export class ContextOperationAdmission {
  constructor(
    private readonly store: AdmissionStore,
    private readonly journal: OperationJournal,
  ) {}

  async prepare(taskId: string): Promise<BackgroundOperationJob> {
    const { task, project } = this.store.locate(taskId);
    const operation = task.operation;
    if (!operation) throw new KanbanError('NO_OPERATION', 'There is no operation to admit.');
    if (!isBackgroundOperationKind(operation.request.kind)) throw new KanbanError('INVALID_OPERATION', 'Only a context operation can be admitted for background execution.');
    invariant(task.pendingTransition?.status !== 'sending', 'EXECUTION_ADMISSION_PENDING', 'Wait until native prompt admission completes.');
    if (operation.request.kind === 'remove' || operation.request.kind === 'delete') {
      const expected = operation.request.expectedWorktreePath;
      if (expected !== undefined && !bindingMatches(task, expected)) {
        throw new KanbanError('WORKTREE_CHANGED', 'The worktree changed since this confirmation was displayed.', { expectedWorktreePath: expected, actualWorktreePath: task.worktree?.path ?? null });
      }
    }
    await this.journal.update(taskId, operation.id, (_task, current) => { current.phase = 'queued'; });
    return { lane: repositoryLane(project), ownerId: taskId, operationId: operation.id };
  }
}
