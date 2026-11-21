import type { Board, HubState, HubTask, KanbanSnapshot } from '../shared/types.js';

/** The task one Session belongs to, with the Hub and board that own it. */
export interface TaskScope {
  readonly task: HubTask;
  readonly hub: HubState;
  readonly board: Board;
}

/**
 * Resolve the task whose conversations include one Session, with the board that
 * owns it.
 *
 * A surface scoped to a Session (the composer dock) reads its task from here
 * instead of holding a board of its own. A Session that belongs to no task — an
 * ordinary chat, a subagent, a branch presented as a peek — resolves to nothing,
 * so the surface has nothing to present. A closed conversation keeps its
 * membership, so reopening it resolves the same task.
 * @param snapshot - any snapshot carrying Hub state; legacy fields must already be normalized.
 * @param sessionId - the Session whose task is wanted.
 * @returns the task with its Hub and board, or undefined when no task owns the Session.
 */
export function taskForSession(snapshot: Pick<KanbanSnapshot, 'state'>, sessionId: string): TaskScope | undefined {
  for (const hub of snapshot.state.hubs) {
    const task = hub.tasks.find(candidate => candidate.sessionIds.includes(sessionId));
    if (task === undefined) continue;
    const board = hub.boards.find(candidate => candidate.id === task.boardId);
    if (board !== undefined) return { task, hub, board };
  }
  return undefined;
}
