import { hasPendingUserWork } from '../domain/pending-user-work.js';
import { resolveDeterministicTarget } from '../domain/deterministic-state.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { placeTask } from '../domain/hub-operations.js';
import type { PendingUserWork, Task } from '../shared/types.js';
import type { SessionPort } from '../shared/ports.js';
import type { HubRepository, LocatedTask } from './hub-repository.js';
import type { SupervisorRoute, SupervisorRouteOutcome } from './deterministic-supervisor.js';

export interface DeterministicRoutingPorts {
  hubs: HubRepository;
  sessions: Pick<SessionPort, 'isIdle'>;
  pending(task: Task): Promise<PendingUserWork>;
  reserved?(taskId: string): boolean;
  notify?(): void;
  now?(): string;
}
function authorized(located: LocatedTask | undefined, request: SupervisorRoute): boolean {
  const task = located?.task; const control = task?.deterministic;
  return !request.signal.aborted && task?.stageEntry?.id === request.control.entryId
    && task.stageEntry.stageIdentity === request.control.stageIdentity
    && control?.entryId === request.control.entryId && control.executionId === request.control.executionId
    && control.attemptId === request.control.attemptId && control.phase === 'delivering'
    && control.result?.id === request.result.id && control.result.deliveryId === request.result.deliveryId
    && control.result.deliveryStatus !== 'failed' && control.result.deliveryStatus !== 'accepted';
}
function blocked(located: LocatedTask, ports: DeterministicRoutingPorts): boolean {
  const capture = located.task.deterministic?.capture;
  const directory = capture?.directory === 'project' ? located.project.projectPath : located.task.effectiveCwd;
  return located.task.operation !== null || located.project.operation !== undefined || located.task.pendingTransition !== undefined
    || (located.task.worktree !== null && located.task.worktree.status !== 'ready')
    || !located.project.projectPath || (capture !== undefined && capture.executionDirectory !== directory)
    || located.task.autoMode?.hold !== undefined || ports.reserved?.(located.task.id) === true;
}
function sameContext(left: LocatedTask, right: LocatedTask): boolean {
  return left.project.projectPath === right.project.projectPath && left.task.effectiveCwd === right.task.effectiveCwd
    && JSON.stringify(left.task.sessionIds) === JSON.stringify(right.task.sessionIds)
    && JSON.stringify(left.task.closedSessionIds) === JSON.stringify(right.task.closedSessionIds);
}

/** Settle one saved result into an exact destination entry. Native delivery is a later entry-bound effect. */
export function createDeterministicRouter(ports: DeterministicRoutingPorts): (request: SupervisorRoute) => Promise<SupervisorRouteOutcome> {
  return async request => {
    const taskId = request.located.task.id;
    const initial = ports.hubs.findTask(taskId);
    if (!initial || !authorized(initial, request) || blocked(initial, ports)) return { status: 'held' };
    try {
      for (const sessionId of initial.task.sessionIds) {
        if (initial.task.closedSessionIds.includes(sessionId)) continue;
        if (!await ports.sessions.isIdle(sessionId)) return { status: 'held' };
        const latest = ports.hubs.findTask(taskId);
        if (!latest || !authorized(latest, request) || blocked(latest, ports) || !sameContext(initial, latest)) return { status: 'held' };
      }
      if (hasPendingUserWork(await ports.pending(initial.task))) return { status: 'held' };
    } catch { return { status: 'held' }; }
    const afterReads = ports.hubs.findTask(taskId);
    if (!afterReads || !authorized(afterReads, request) || blocked(afterReads, ports) || !sameContext(initial, afterReads)) return { status: 'held' };
    const outcome = await ports.hubs.transact(initial.hubId, hub => {
      const task = hub.tasks.find(value => value.id === taskId);
      const board = task && hub.boards.find(value => value.id === task.boardId);
      const project = task && hub.projects.find(value => value.id === task.projectId);
      if (!task || !board || !project) return { status: 'held' } as const;
      const latest: LocatedTask = { hubId: hub.id, hub, task, board, project };
      if (!authorized(latest, request) || blocked(latest, ports) || !sameContext(initial, latest)) return { status: 'held' } as const;
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
      placeTask(hub, taskId, destination.id, 'start', Date.parse(at), { at });
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
