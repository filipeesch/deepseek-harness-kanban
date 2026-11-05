import { KanbanError } from '../shared/errors.js';
import type { ContextOperation, HubState, Task } from '../shared/types.js';

/** The narrow write surface a journal needs, satisfied by the coordinator's store. */
export interface JournalStore {
  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T>;
}

export function requireTask(state: HubState, taskId: string): Task {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new KanbanError('TASK_NOT_FOUND', 'The task does not exist.', { taskId });
  return task;
}

/**
 * Owns the persisted operation record: its phase, error, and progress. Every
 * write is guarded by the operation identity, so a replaced operation can never
 * receive progress from an older one.
 */
export class OperationJournal {
  constructor(
    private readonly store: JournalStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async update(taskId: string, operationId: string, change: (task: Task, operation: ContextOperation) => void): Promise<void> {
    await this.store.transactTask(taskId, state => {
      const task = requireTask(state, taskId);
      if (task.operation?.id !== operationId) throw new KanbanError('OPERATION_CHANGED', 'The operation changed while it was being coordinated.');
      change(task, task.operation);
      task.updatedAt = this.now();
    });
  }
}
