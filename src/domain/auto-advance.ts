import type { Column, ConversationFacts, PendingUserWork, Task, Workflow } from '../shared/types.js';
import { NO_PENDING_USER_WORK } from '../shared/types.js';
import { openSessionIds } from '../shared/conversations.js';
import { entryInstruction, hasUnresolvedEntry } from './stage-entry.js';
import { hasPendingUserWork, mergePendingUserWork } from './pending-user-work.js';

/** One automatic advance's resolved path: every stage crossed, ending at the destination. */
export interface AutoAdvancePlan {
  /** The stage the resolution started from; admission requires the task to still be there. */
  fromColumnId: string;
  path: Column[];
  destination?: Column;
  /** The destination's entry instruction, or undefined when the destination has none. */
  instruction?: string;
}

/** Why a completed turn does not advance the task, or that it does. */
export type AdvanceDecision =
  /** The task itself is busy with a context operation, a confirmed transition, or an unresolved entry. */
  | { readonly kind: 'busy' }
  /** An open conversation is still executing; the ending conversation is retried after the settle delay. */
  | { readonly kind: 'running'; readonly sessions: readonly string[] }
  /** The task still owes the user input; nothing is admitted and nothing is recorded. */
  | { readonly kind: 'pending'; readonly pending: PendingUserWork }
  | { readonly kind: 'advance' };

/**
 * Decide what a completed turn means for one task. The precedence is deliberate:
 * a busy task is skipped silently, an executing open conversation waits for the
 * settle delay, and pending user work is a hold that never records a pause.
 */
export function resolveAdvanceDecision(task: Task, facts: ReadonlyMap<string, ConversationFacts>): AdvanceDecision {
  if (task.operation || task.pendingTransition || hasUnresolvedEntry(task)) return { kind: 'busy' };
  const open = new Set(openSessionIds(task));
  const running: string[] = [];
  for (const sessionId of task.sessionIds) {
    if (open.has(sessionId) && facts.get(sessionId)?.running === true) running.push(sessionId);
  }
  if (running.length > 0) return { kind: 'running', sessions: running };
  const pending = mergePendingUserWork(task.sessionIds.map(sessionId => facts.get(sessionId)?.pending ?? NO_PENDING_USER_WORK));
  return hasPendingUserWork(pending) ? { kind: 'pending', pending } : { kind: 'advance' };
}

/**
 * The configured destination for one stage: the first configured allowed
 * transition when the stage configures transitions, otherwise the following
 * column in workflow order. A self or unknown target has no destination.
 */
export function nextConfiguredColumn(workflow: Workflow, fromColumnId: string): Column | undefined {
  const index = workflow.columns.findIndex(column => column.id === fromColumnId);
  if (index < 0) return undefined;
  const source = workflow.columns[index]!;
  if (source.allowedTransitions !== undefined) {
    const first = source.allowedTransitions[0];
    if (first === undefined) return undefined;
    const target = workflow.columns.find(column => column.id === first);
    return target && target.id !== fromColumnId ? target : undefined;
  }
  const next = workflow.columns[index + 1];
  return next && next.id !== fromColumnId ? next : undefined;
}

/**
 * Resolve the automatic advance path. Stages without an entry instruction are
 * crossed toward the first reachable instructed stage; when no reachable stage
 * has one, the path ends at the last reachable stage. A stage already visited in
 * the same resolution is never revisited, so a configured cycle cannot loop.
 */
export function resolveAutoAdvance(workflow: Workflow, fromColumnId: string): AutoAdvancePlan {
  const path: Column[] = [];
  const visited = new Set<string>([fromColumnId]);
  let cursor = fromColumnId;
  for (;;) {
    const next = nextConfiguredColumn(workflow, cursor);
    if (!next || visited.has(next.id)) break;
    path.push(next);
    visited.add(next.id);
    cursor = next.id;
    const instruction = entryInstruction(next);
    if (instruction !== undefined) return { fromColumnId, path, destination: next, instruction };
  }
  const destination = path[path.length - 1];
  return destination === undefined ? { fromColumnId, path } : { fromColumnId, path, destination };
}
