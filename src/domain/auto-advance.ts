import type { Column, ConversationFacts, PendingUserWork, Task, Workflow } from '../shared/types.js';
import { NO_PENDING_USER_WORK } from '../shared/types.js';
import { openSessionIds } from '../shared/conversations.js';
import { ownsDeterministicEntry } from './deterministic-state.js';
import { entryInstruction } from './stage-entry.js';
import { blocksAdvance } from './auto-mode-hold.js';
import { hasPendingUserWork, mergePendingUserWork } from './pending-user-work.js';
import { defaultDestination } from './transitions.js';

/** One automatic advance's resolved path: every stage crossed, ending at the destination. */
export interface AutoAdvancePlan {
  /** The stage the resolution started from; admission requires the task to still be there. */
  fromColumnId: string;
  path: Column[];
  destination?: Column;
  /** The destination's entry instruction, or undefined when the destination has none. */
  instruction?: string;
}

/** A recorded destination the resolution must stop at instead of resolving a path. */
export interface AdvanceResolutionOptions {
  readonly exact?: Column;
}

/** Why a completed turn does not advance the task, or that it does. */
export type AdvanceDecision =
  /** The task itself is busy with a context operation, a confirmed transition, or an unresolved entry, or the agent paused it. */
  | { readonly kind: 'busy' }
  /** An open conversation is still executing; the ending conversation is retried after the settle delay. */
  | { readonly kind: 'running'; readonly sessions: readonly string[] }
  /** The task still owes the user input; nothing is admitted and nothing is recorded. */
  | { readonly kind: 'pending'; readonly pending: PendingUserWork }
  | { readonly kind: 'advance' };

/**
 * Decide what a completed turn means for one task. The precedence is deliberate:
 * a task the host must not advance is skipped silently, an executing open
 * conversation waits for the settle delay, and pending user work is a hold that
 * never records a pause.
 */
export function resolveAdvanceDecision(task: Task, facts: ReadonlyMap<string, ConversationFacts>): AdvanceDecision {
  if (ownsDeterministicEntry(task) || blocksAdvance(task)) return { kind: 'busy' };
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
 * Resolve the automatic advance path. Stages without an entry instruction are
 * crossed toward the first reachable instructed stage; when no reachable stage
 * has one, the path ends at the last reachable stage. A stage already visited in
 * the same resolution is never revisited, so a configured cycle cannot loop.
 *
 * A recorded destination is followed exactly: it becomes the whole path, so the
 * crossing rule stays with the default path only.
 */
export function resolveAutoAdvance(workflow: Workflow, fromColumnId: string, options: AdvanceResolutionOptions = {}): AutoAdvancePlan {
  if (options.exact !== undefined) {
    const exact = options.exact;
    if (exact.id === fromColumnId) return { fromColumnId, path: [] };
    const instruction = entryInstruction(exact);
    return instruction === undefined
      ? { fromColumnId, path: [exact], destination: exact }
      : { fromColumnId, path: [exact], destination: exact, instruction };
  }
  const path: Column[] = [];
  const visited = new Set<string>([fromColumnId]);
  let cursor = fromColumnId;
  for (;;) {
    const next = defaultDestination(workflow, cursor);
    if (!next || visited.has(next.id)) break;
    path.push(next);
    visited.add(next.id);
    cursor = next.id;
    const instruction = entryInstruction(next);
    if (instruction !== undefined) return { fromColumnId, path, destination: next, instruction };
    if (next.deterministic !== undefined) return { fromColumnId, path, destination: next };
  }
  const destination = path[path.length - 1];
  return destination === undefined ? { fromColumnId, path } : { fromColumnId, path, destination };
}
