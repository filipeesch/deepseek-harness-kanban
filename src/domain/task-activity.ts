import type { ConversationFacts, SettledTurnActivity, TaskActivity } from '../shared/types.js';
import { mergePendingUserWork } from './pending-user-work.js';

export type { SettledTurnActivity, TaskActivity } from '../shared/types.js';

export const UNAVAILABLE_TASK_ACTIVITY: TaskActivity = {
  available: false, running: false, pending: [], queuedPrompts: 0, backgroundCount: 0, settledTurns: [],
};

/** The conversations one activity value is aggregated over. Closed ones never count. */
export interface TaskActivityScope {
  readonly sessionIds: readonly string[];
  readonly closedSessionIds?: readonly string[];
}

/** One conversation that took part in the aggregation. */
export interface TaskActivityEntry {
  sessionId: string;
  facts: ConversationFacts;
}

/**
 * The one aggregation rule: running when any conversation runs, the union of the
 * pending user work, the sum of queued prompts, the number of background
 * activities, and each settled conversation's last outcome.
 */
export function aggregateTaskActivity(entries: readonly TaskActivityEntry[] | undefined): TaskActivity {
  if (entries === undefined) return UNAVAILABLE_TASK_ACTIVITY;
  const pending = mergePendingUserWork(entries.map(entry => entry.facts.pending));
  const settledTurns: SettledTurnActivity[] = [];
  let backgroundCount = 0;
  for (const entry of entries) {
    backgroundCount += entry.facts.background.length;
    if (entry.facts.settledTurn !== null) settledTurns.push({ sessionId: entry.sessionId, outcome: entry.facts.settledTurn.outcome });
  }
  return {
    available: true,
    running: entries.some(entry => entry.facts.running),
    pending: [...pending.kinds],
    queuedPrompts: pending.queuedPrompts,
    backgroundCount,
    settledTurns,
  };
}

/** How a card read may obtain the facts: a durable read, or whatever is already resolved. */
export interface TaskActivityOptions {
  /**
   * When true, read the facts now and report the activity as unavailable if any
   * conversation cannot be read. When false, use only the facts the host already
   * resolved, so a listing never waits on a cold native read.
   */
  wait?: boolean;
}

/** The narrow port a card read needs to report activity without owning native facts. */
export interface TaskActivitySource {
  activity(task: TaskActivityScope, options?: TaskActivityOptions): Promise<TaskActivity>;
}

/** The source a host without native facts answers with: an explicit unavailable value. */
export const NO_TASK_ACTIVITY_SOURCE: TaskActivitySource = {
  activity: async () => UNAVAILABLE_TASK_ACTIVITY,
};
