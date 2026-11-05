import { KanbanError, invariant } from '../shared/errors.js';
import type { Project, Task } from '../shared/types.js';
import type { OperationJournal } from './operation-journal.js';
import { repositoryLane } from './repository-lane.js';

export interface AdmissionStore {
  locate(taskId: string): { task: Task; project: Project };
}

export interface DestructiveAdmissionJob {
  lane: string;
  taskId: string;
  operationId: string;
}

/** The one persisted-binding comparison shared by admission and the command path. */
export function bindingMatches(task: Task, expectedWorktreePath: string | null): boolean {
  return (task.worktree?.path ?? null) === expectedWorktreePath;
}

/**
 * Decides whether an already recorded destructive operation may be queued,
 * using persisted state only. The authoritative preflight — conversation
 * idleness, canonical target stability, checkout sharing, and local changes —
 * belongs to execution inside the queue lane, so admission never inspects Git,
 * native conversations, or the filesystem.
 */
export class DestructiveAdmission {
  constructor(
    private readonly store: AdmissionStore,
    private readonly journal: OperationJournal,
  ) {}

  async prepare(taskId: string): Promise<DestructiveAdmissionJob> {
    const { task, project } = this.store.locate(taskId);
    const operation = task.operation;
    if (!operation) throw new KanbanError('NO_OPERATION', 'There is no operation to admit.');
    if (operation.request.kind !== 'delete' && operation.request.kind !== 'remove') throw new KanbanError('INVALID_OPERATION', 'Only a destructive operation can be admitted for background execution.');
    invariant(task.pendingTransition?.status !== 'sending', 'EXECUTION_ADMISSION_PENDING', 'Wait until native prompt admission completes.');
    const expected = operation.request.expectedWorktreePath;
    if (expected !== undefined && !bindingMatches(task, expected)) {
      throw new KanbanError('WORKTREE_CHANGED', 'The worktree changed since this confirmation was displayed.', { expectedWorktreePath: expected, actualWorktreePath: task.worktree?.path ?? null });
    }
    await this.journal.update(taskId, operation.id, (_task, current) => { current.phase = 'queued'; });
    return { lane: repositoryLane(project), taskId, operationId: operation.id };
  }
}
