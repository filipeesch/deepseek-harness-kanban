import { randomUUID } from 'node:crypto';
import type { Board, HubState, HubTask } from '../shared/types.js';
import type { StageInstructionDelivery } from '../shared/ports.js';
import { invariant } from '../shared/errors.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { buildTransitionBriefing } from './stage-briefing.js';
import { buildStageInstructionDelivery } from './stage-message.js';
import { recordDeterministicHandoff } from '../domain/task-history/record.js';

/** The task scope an admission needs; the host resolves it from its task locator. */
export interface StageInstructionTarget { hubId: string; task: HubTask; board: Board }

export interface StageInstructionDeps {
  locate(taskId: string): StageInstructionTarget;
  transact(hubId: string, change: (draft: HubState) => void): Promise<unknown>;
  /** The first open conversation, creating one when every tab is closed. */
  resolveSession(task: HubTask): Promise<string>;
  assertExecutionContext(sessionId: string): Promise<void>;
  /** Deliver the composed instruction as the plugin-sourced message that starts the turn. */
  deliver(sessionId: string, delivery: StageInstructionDelivery): Promise<void>;
}

export interface StageInstructionRequest {
  taskId: string;
  /** The stage whose entry instruction is being admitted. */
  columnId: string;
  /** The exact instruction text to send. */
  instruction: string;
  /** When set, the current workflow instruction must still equal this reviewed value. */
  reviewedInstruction?: string;
  /** When set, the persisted entry must still carry this identity. */
  expectedEnteredAt?: number;
  /** Exact durable destination entry, including a new visit to the same column. */
  expectedEntryId?: string;
  /** Host lifecycle/entry reservation still permits this particular admission. */
  isCurrent?: () => boolean;
  /** Native prompt identity; omitted keeps a fresh identity per send. */
  requestId?: string;
  /** An already resolved target; omitted resolves the first open conversation. */
  sessionId?: string;
  /** The declared transition this delivery follows, when the advance consumed one. */
  transition?: { fromColumnId: string; reason: string };
}

/**
 * The one host admission path for a stage instruction. The card action, the
 * confirmed-transition drain, and the automatic advance all validate the stage,
 * the reviewed text, and the entry identity here, and clear the entry marker
 * only after a successful send.
 */
export async function admitStageInstruction(deps: StageInstructionDeps, request: StageInstructionRequest): Promise<string> {
  const target = deps.locate(request.taskId);
  const task = target.task;
  const entryId = request.expectedEntryId ?? task.stageEntry?.id;
  const incoming = task.deterministicHandoff;
  const handoff = incoming && incoming.entryId === entryId && !incoming.acceptedAt ? incoming : undefined;
  const assertCurrent = () => {
    invariant(request.isCurrent?.() !== false, 'STALE_HANDOFF', 'The host no longer owns this context admission.');
    const current = deps.locate(request.taskId).task;
    invariant(current.columnId === request.columnId && (entryId === undefined || current.stageEntry?.id === entryId),
      'TASK_MOVED', 'The task stage entry changed before native instruction admission.');
    if (handoff) invariant(current.deterministicHandoff?.id === handoff.id && current.deterministicHandoff.entryId === entryId,
      'STALE_HANDOFF', 'The deterministic handoff belongs to an older stage entry.');
    if (request.expectedEnteredAt !== undefined) invariant(current.instructionPending?.enteredAt === request.expectedEnteredAt,
      'INSTRUCTION_ALREADY_RESOLVED', 'This instruction entry was replaced before admission.');
  };
  assertCurrent();
  invariant(task.columnId === request.columnId, 'TASK_MOVED', 'The task moved to another stage. Review the current stage before running its instruction.');
  const column = target.board.workflow.columns.find(value => value.id === request.columnId);
  invariant(column, 'INVALID_TARGET', 'The destination stage does not exist.');
  if (request.expectedEnteredAt !== undefined) {
    invariant(task.instructionPending?.columnId === request.columnId && task.instructionPending.enteredAt === request.expectedEnteredAt,
      'INSTRUCTION_ALREADY_RESOLVED', 'This stage entry was already resolved or replaced. Review the current entry before running.');
  }
  let instruction = request.instruction;
  if (request.reviewedInstruction !== undefined) {
    const current = entryInstruction(column);
    invariant(typeof current === 'string' && current.trim().length > 0 && current === request.reviewedInstruction,
      'INSTRUCTION_CHANGED', 'The workflow instruction changed or was not reviewed. Review the current instruction before running.');
    instruction = current;
  } else {
    invariant(instruction.trim().length > 0, 'EMPTY_PROMPT', 'A task execution requires a non-empty instruction.');
  }
  const sessionId = request.sessionId ?? await deps.resolveSession(task);
  await deps.assertExecutionContext(sessionId);
  // Both awaits above can let the task, the workflow, or the recording change, so
  // the send re-reads them. The message still belongs to the requested stage, and
  // a task that left it must not receive that stage's instruction.
  const live = deps.locate(request.taskId);
  assertCurrent();
  const briefing = buildTransitionBriefing(live.board.workflow, { columnId: request.columnId, recordedTransition: live.task.recordedTransition });
  const stage = live.board.workflow.columns.find(value => value.id === request.columnId);
  // The source stage is resolved at send time, so a stage renamed between the tool
  // call and the delivery is described with the name the workflow carries now.
  const transition = request.transition === undefined ? undefined : {
    fromStageName: live.board.workflow.columns.find(value => value.id === request.transition!.fromColumnId)?.name ?? request.transition.fromColumnId,
    reason: request.transition.reason,
  };
  const delivery = buildStageInstructionDelivery({
    instruction,
    ...(transition === undefined ? {} : { transition }),
    ...(handoff === undefined ? {} : { handoff }),
    ...(briefing === undefined ? {} : { briefing }),
    stageName: stage?.name ?? request.columnId,
    task: live.task,
    workflow: live.board.workflow,
    requestId: request.requestId ?? handoff?.id ?? randomUUID(),
  });
  await deps.deliver(sessionId, { ...delivery, assertCurrent });
  await deps.transact(target.hubId, draft => {
    const current = draft.tasks.find(value => value.id === task.id);
    const marker = current?.instructionPending;
    if (!current || (entryId !== undefined && current.stageEntry?.id !== entryId)) return;
    if (handoff && current.deterministicHandoff?.id === handoff.id) {
      const accepted = current.deterministicHandoff; accepted.acceptedAt = new Date().toISOString(); delete accepted.error;
      recordDeterministicHandoff(current,{at:accepted.acceptedAt,deliveryId:accepted.id,executionId:accepted.executionId,fromColumnId:accepted.fromColumnId,columnId:current.columnId,outcome:'accepted',exit:accepted.exit,message:accepted.message,...(accepted.params===undefined?{}:{parameters:accepted.params})});
    }
    if (!marker || marker.columnId !== request.columnId) return;
    if (request.expectedEnteredAt !== undefined && marker.enteredAt !== request.expectedEnteredAt) return;
    delete current.instructionPending;
    // A successful manual instruction for this stage also resolves a failed host
    // advance — automatic or declared — so the task is not left blocked by it.
    const failed = current.pendingTransition;
    if (failed !== undefined && failed.origin !== undefined && failed.status === 'failed' && failed.columnId === request.columnId) delete current.pendingTransition;
  });
  return sessionId;
}
