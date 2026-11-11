import { randomUUID } from 'node:crypto';
import type { AutoAdvancePlan } from '../domain/auto-advance.js';
import { hasPendingUserWork } from '../domain/pending-user-work.js';
import { blocksAdvance } from '../domain/auto-mode-hold.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { resolveAdvanceRoute } from '../domain/transition-route.js';
import { firstOpenSessionId } from '../shared/conversations.js';
import { KanbanError, invariant } from '../shared/errors.js';
import type { Column, HubState, PendingTransition, PendingUserWork, Task, Workflow } from '../shared/types.js';
import type { LocatedTask } from './hub-repository.js';

/** The task scope and the ports one automatic advance admission needs. */
export interface AutoAdvanceAdmissionDeps {
  locate(taskId: string): LocatedTask;
  transact(hubId: string, change: (draft: HubState) => void): Promise<unknown>;
  /** The first open conversation, creating one when every tab is closed. */
  resolveSession(task: Task): Promise<string>;
  /** Pending user work across every conversation of the task, read fresh. */
  pending(task: Task): Promise<PendingUserWork>;
  dispatch(): Promise<void>;
  report(error: unknown): void;
}

/** A task that cannot advance right now: disabled, or blocked by the one shared rule. */
function blocked(task: Task): boolean {
  return task.autoMode?.enabled !== true || blocksAdvance(task);
}

/**
 * Re-resolution against the current workflow: the captured destination must
 * still be the one the current recording resolves to. A recording that stopped
 * resolving is a stale-transition failure of its own, so the coordinator can
 * record the matching pause instead of a generic one.
 */
function requireRoute(destination: Column, workflow: Workflow, task: Task): void {
  const route = resolveAdvanceRoute(workflow, task);
  if (route.kind === 'stale') throw new KanbanError('TRANSITION_STALE', route.message);
  invariant(route.kind === 'advance' && route.plan.destination?.id === destination.id,
    'INVALID_TARGET', 'The automatic advance destination changed. Review the workflow before retrying.');
}

function requireSameDestination(located: LocatedTask, plan: AutoAdvancePlan): void {
  invariant(plan.destination !== undefined, 'INVALID_TARGET', 'The automatic advance has no destination.');
  requireRoute(plan.destination, located.board.workflow, located.task);
}

/**
 * The one host admission path for an automatic advance: validate the task and
 * the captured destination, resolve the target conversation, re-read pending
 * user work immediately before the durable decision, persist exactly one
 * transition, and let the drain place and dispatch it.
 *
 * A task that is busy, moved, or still owed user input is skipped without a
 * pause. A destination that no longer resolves, or a task that changed before
 * the transaction committed, throws and the coordinator records the admission
 * failure instead of retrying silently.
 */
export async function admitAutoAdvance(deps: AutoAdvanceAdmissionDeps, taskId: string, plan: AutoAdvancePlan): Promise<void> {
  const located = deps.locate(taskId);
  if (blocked(located.task) || located.task.columnId !== plan.fromColumnId) return;
  requireSameDestination(located, plan);
  const destination = plan.destination!;
  const instruction = entryInstruction(destination);
  const sessionId = instruction === undefined ? undefined : firstOpenSessionId(located.task) ?? await deps.resolveSession(located.task);
  const latest = deps.locate(taskId);
  if (blocked(latest.task) || latest.task.columnId !== plan.fromColumnId) return;
  requireSameDestination(latest, plan);
  // The settle evaluation and the durable decision are different observations:
  // a question, approval, or queued prompt admitted in between stops the advance.
  // An unreadable wait state is not idle either, and is a hold rather than a failure.
  let waitState: PendingUserWork;
  try { waitState = await deps.pending(latest.task); }
  catch (error) { deps.report(error); return; }
  if (hasPendingUserWork(waitState)) return;
  const transition: PendingTransition = {
    id: randomUUID(), fromColumnId: plan.fromColumnId, columnId: destination.id, mode: instruction !== undefined ? 'run' : 'move', status: 'waiting', origin: 'auto',
    ...(instruction !== undefined ? { text: instruction, sessionId: sessionId! } : {}),
  };
  await deps.transact(latest.hubId, draft => {
    const value = draft.tasks.find(candidate => candidate.id === taskId)!;
    invariant(value.autoMode?.enabled === true, 'AUTO_MODE_DISABLED', 'Auto mode is no longer enabled.');
    invariant(!value.operation && !value.pendingTransition, 'REVISION_CONFLICT', 'Task changed before the automatic advance could be admitted.');
    invariant(value.columnId === plan.fromColumnId, 'REVISION_CONFLICT', 'Task moved before the automatic advance could be admitted.');
    invariant(value.autoMode?.hold === undefined, 'REVISION_CONFLICT', 'Task was paused before the automatic advance could be admitted.');
    const board = draft.boards.find(candidate => candidate.id === value.boardId);
    invariant(board !== undefined, 'INVALID_TARGET', 'The automatic advance destination changed.');
    requireRoute(destination, board.workflow, value);
    value.pendingTransition = transition;
    if (value.autoMode.pause !== undefined) delete value.autoMode.pause;
  });
  await deps.dispatch();
}
