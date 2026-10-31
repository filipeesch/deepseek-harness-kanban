import type { KanbanSnapshot, Task } from '../shared/types.js';

/**
 * Aggregated running work and attention for one Hub or board scope.
 * A task counts once no matter how many agents, subagents, jobs, or schedules it owns.
 */
export interface ScopeActivity {
  readonly runningTasks: number;
  /** The running tasks' titles, in task order, for the indicator's hover detail. */
  readonly runningTaskTitles: readonly string[];
  readonly unread: boolean;
  readonly awaitingReply: boolean;
  readonly failed: boolean;
}

export const EMPTY_SCOPE_ACTIVITY: ScopeActivity = { runningTasks: 0, runningTaskTitles: [], unread: false, awaitingReply: false, failed: false };

/**
 * A task runs while it has a running turn, an owned subagent still running, or
 * unsettled background work. Unread, awaiting-reply, and failure attention fold across the scope.
 */
export function projectScopeActivity(tasks: readonly Task[], attention: KanbanSnapshot['attention']): ScopeActivity {
  let runningTasks = 0;
  let unread = false;
  let awaitingReply = false;
  let failed = false;
  const runningTaskTitles: string[] = [];
  for (const task of tasks) {
    const value = attention[task.id];
    if (value === undefined) continue;
    if (value.running || value.background.length > 0) {
      runningTasks += 1;
      runningTaskTitles.push(task.title);
    }
    unread ||= value.unread;
    awaitingReply ||= value.awaitingReply;
    failed ||= value.failed;
  }
  return { runningTasks, runningTaskTitles, unread, awaitingReply, failed };
}
