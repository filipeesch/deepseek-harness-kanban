import { evaluateDeterministicHold, type DeterministicHoldInput, type HoldConversation } from '../domain/deterministic-hold.js';
import { resolveDeterministicTarget } from '../domain/deterministic-state.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { placeTask } from '../domain/hub-operations.js';
import type { DeterministicHold } from '../shared/deterministic.js';
import type { PendingUserWork, PendingUserWorkKind, Task } from '../shared/types.js';
import type { StageEntryOrigin } from '../shared/task-history.js';
import type { SessionPort } from '../shared/ports.js';
import type { HubRepository, LocatedTask } from './hub-repository.js';
import type { SupervisorRoute, SupervisorRouteOutcome } from './deterministic-supervisor.js';

export interface DeterministicRoutingPorts {
  hubs: HubRepository;
  sessions: Pick<SessionPort, 'isIdle'> & Partial<Pick<SessionPort, 'idleReport'>>;
  pending(task: Task): Promise<PendingUserWork>;
  reserved?(taskId: string): boolean;
  notify?(): void;
  now?(): string;
}
function sameContext(left: LocatedTask, right: LocatedTask): boolean {
  return left.project.projectPath === right.project.projectPath && left.task.effectiveCwd === right.task.effectiveCwd
    && JSON.stringify(left.task.sessionIds) === JSON.stringify(right.task.sessionIds)
    && JSON.stringify(left.task.closedSessionIds) === JSON.stringify(right.task.closedSessionIds);
}
/**
 * The facts one refusal reads. Conversation reports are the caller's observation, so the
 * final transactional check passes none and re-decides only what it can re-read itself.
 */
function holdInput(located: LocatedTask, request: SupervisorRoute, pending: readonly PendingUserWorkKind[], conversations: readonly HoldConversation[], at: string, reserved: boolean): DeterministicHoldInput {
  const task = located.task;
  return {
    task: {
      operation: task.operation, worktree: task.worktree, sessionIds: task.sessionIds, closedSessionIds: task.closedSessionIds, effectiveCwd: task.effectiveCwd,
      ...(task.pendingTransition === undefined ? {} : { pendingTransition: task.pendingTransition }),
      ...(task.autoMode === undefined ? {} : { autoMode: task.autoMode }),
      ...(task.stageEntry === undefined ? {} : { stageEntry: task.stageEntry }),
      ...(task.deterministic === undefined ? {} : { deterministic: task.deterministic }),
    },
    project: { ...(located.project.operation === undefined ? {} : { operation: located.project.operation }), ...(located.project.projectPath === undefined ? {} : { projectPath: located.project.projectPath }) },
    request: { control: request.control, result: request.result },
    reserved,
    pending,
    conversations,
    at,
  };
}

/** Settle one saved result into an exact destination entry. Native delivery is a later entry-bound effect. */
export function createDeterministicRouter(ports: DeterministicRoutingPorts): (request: SupervisorRoute) => Promise<SupervisorRouteOutcome> {
  return async request => {
    const taskId = request.located.task.id;
    const now = () => ports.now?.() ?? new Date().toISOString();
    // A request that lost its authority or its context is retried on the next event; it is
    // never presented as a durable hold, because the replacement entry owns the outcome.
    const held = (value?: DeterministicHold): SupervisorRouteOutcome => value === undefined || value.code === 'stale-authority' ? { status: 'held' } : { status: 'held', hold: value };
    const unreadable = (): SupervisorRouteOutcome => ({ status: 'held', hold: { code: 'conversation-unreadable', at: now() } });
    const initial = ports.hubs.findTask(taskId);
    if (!initial || request.signal.aborted) return { status: 'held' };
    const reserved = () => ports.reserved?.(taskId) === true;
    const conversations: HoldConversation[] = [];
    let refused = false;
    for (const sessionId of initial.task.sessionIds) {
      if (initial.task.closedSessionIds.includes(sessionId)) continue;
      const latest = ports.hubs.findTask(taskId);
      if (!latest || request.signal.aborted) return { status: 'held' };
      if (!sameContext(initial, latest)) return { status: 'held' };
      // Authority, context and task-level guards are re-decided before every awaited conversation read.
      const before = evaluateDeterministicHold(holdInput(latest, request, [], conversations, now(), reserved()));
      if (before) return held(before);
      let report: { idle: boolean; blockers: HoldConversation['blockers'] };
      try {
        report = ports.sessions.idleReport !== undefined
          ? await ports.sessions.idleReport(sessionId)
          : { idle: await ports.sessions.isIdle(sessionId), blockers: [] };
      } catch { return unreadable(); }
      if (request.signal.aborted) return { status: 'held' };
      conversations.push({ sessionId, ...report });
      // Delivery is already refused; the remaining conversations cannot change that verdict.
      if (!report.idle) { refused = true; break; }
    }
    const afterReads = ports.hubs.findTask(taskId);
    if (!afterReads || request.signal.aborted || !sameContext(initial, afterReads)) return { status: 'held' };
    const structural = evaluateDeterministicHold(holdInput(afterReads, request, [], conversations, now(), reserved()));
    if (structural) return held(structural);
    if (refused) return { status: 'held' };
    // Pending user work is the authoritative task-wide value, and it is read after the
    // awaited conversation reads so work admitted during them is seen by this admission.
    let pending: PendingUserWork;
    try { pending = await ports.pending(afterReads.task); } catch { return unreadable(); }
    // Re-read the task once more: the pending source awaited above can itself be slow.
    const afterPending = ports.hubs.findTask(taskId);
    if (!afterPending || request.signal.aborted || !sameContext(initial, afterPending)) return { status: 'held' };
    const heldAfterReads = evaluateDeterministicHold(holdInput(afterPending, request, pending.kinds, conversations, now(), reserved()));
    if (heldAfterReads) return held(heldAfterReads);
    const outcome = await ports.hubs.transact(initial.hubId, hub => {
      const task = hub.tasks.find(value => value.id === taskId);
      const board = task && hub.boards.find(value => value.id === task.boardId);
      const project = task && hub.projects.find(value => value.id === task.projectId);
      if (!task || !board || !project) return { status: 'held' } as const;
      const latest: LocatedTask = { hubId: hub.id, hub, task, board, project };
      if (request.signal.aborted || !sameContext(initial, latest)) return { status: 'held' } as const;
      // Re-read only what this transaction can observe; the conversation reports belong to
      // the awaited admission above and native delivery enforces its own idleness.
      const inside = evaluateDeterministicHold(holdInput(latest, request, [], [], now(), reserved()));
      if (inside) return { status: 'held' } as const;
      const control = task.deterministic!; const result = control.result!; const capture = control.capture;
      // Read the durable trusted mapping, never the saved stage's current definition or a human override.
      const target = capture?.exits[result.exit];
      if (!target || capture?.fingerprint !== request.capture.fingerprint || result.target?.stageIdentity !== target.stageIdentity) {
        return { status: 'failed', error: { code: 'INVALID_CAPTURED_ROUTE', message: 'The saved result does not identify an approved captured destination.' } } as const;
      }
      const destination = resolveDeterministicTarget(board, target);
      if (!destination || destination.id === task.columnId) return { status: 'failed', error: { code: 'DETERMINISTIC_TARGET_REMOVED', message: 'The captured destination no longer exists as the same stage. Repair the workflow and retry delivery explicitly.' } } as const;
      const fromColumnId = task.columnId;
      const instruction = entryInstruction(destination);
      const at = ports.now?.() ?? new Date().toISOString();
      // The saved result names the exit that routed the card; the reserved error
      // route records itself as such.
      const origin: StageEntryOrigin = result.synthetic === true ? `error:${result.exit}` : `script:${result.exit}`;
      placeTask(hub, taskId, destination.id, 'start', Date.parse(at), { at, origin });
      // The result receipt and destination entry/handoff share this one task transaction.
      task.deterministicHandoff = { id: result.deliveryId ?? result.id, entryId: task.stageEntry!.id,
        executionId: control.executionId, fromColumnId, columnId: destination.id, exit: result.exit, message: result.message, at,
        ...(instruction === undefined ? {} : { instruction }) };
      return { status: 'accepted' } as const;
    });
    if (outcome.status === 'accepted') ports.notify?.();
    return outcome;
  };
}
