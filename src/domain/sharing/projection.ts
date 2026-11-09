import type { HubState } from '../../shared/types.js';
import type { BoardBindings } from './identity.js';

/** One local board as the sharing rules see it: sharing content plus local work. */
export interface LocalSharedBoard {
  boardId: string;
  name: string;
  workflow: string;
  /** Present only while the board is bound to a published key. */
  key?: string;
  /** Absent means the board allows every project; an empty list closes it to creation. */
  projectKeys?: string[];
  tasks: number;
  taskColumns: Array<{ columnId: string; tasks: number }>;
}

/**
 * Project the Hub onto the sharing model. Projects, notes, conversations, task
 * metadata, Hub names, and settings are deliberately absent.
 */
export function projectSharingBoards(hub: HubState, bindings: Readonly<BoardBindings>): LocalSharedBoard[] {
  return hub.boards.map(board => {
    const taskColumns = new Map<string, number>();
    let tasks = 0;
    for (const task of hub.tasks) {
      if (task.boardId !== board.id) continue;
      tasks++;
      taskColumns.set(task.columnId, (taskColumns.get(task.columnId) ?? 0) + 1);
    }
    const key = bindings[board.id];
    return {
      boardId: board.id,
      name: board.name,
      workflow: board.workflowYaml,
      ...(key === undefined ? {} : { key }),
      ...(board.allowedProjectKeys === undefined ? {} : { projectKeys: [...board.allowedProjectKeys] }),
      tasks,
      taskColumns: [...taskColumns].map(([columnId, count]) => ({ columnId, tasks: count })),
    };
  });
}
