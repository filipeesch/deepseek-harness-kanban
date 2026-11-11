import type { ContextOperation, HubState, Project, Task } from '../shared/types.js';

/** One task's recorded operation read and written through the shared journal. */
export interface DestructiveJournal {
  /** The latest persisted task, project, and Hub for this operation. */
  read(): { task: Task; project: Project; hub: HubState };
  /** Write one journal change, guarded by the operation identity. */
  update(operationId: string, change: (task: Task, operation: ContextOperation) => void): Promise<void>;
  /** Refuse to continue when the coordinator was disposed or interrupted. */
  assertOpen(): void;
}
