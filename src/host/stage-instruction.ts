import { randomUUID } from 'node:crypto';
import type { Board, HubState, HubTask } from '../shared/types.js';
import type { StageInstructionDelivery } from '../shared/ports.js';
import { invariant } from '../shared/errors.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { addressedConversationId } from '../domain/conversation-role.js';
import { heldMessagesFor } from '../domain/held-message.js';
import { buildTransitionBriefing } from './stage-briefing.js';
import { buildStageInstructionDelivery, modelFallbackNotice } from './stage-message.js';
import { recordScriptedHandoff } from '../domain/task-history/record.js';

/** The task scope an admission needs; the host resolves it from its task locator. */
export interface StageInstructionTarget { hubId: string; task: HubTask; board: Board }

export interface StageInstructionDeps {
  locate(taskId: string): StageInstructionTarget;
  transact(hubId: string, change: (draft: HubState) => void): Promise<unknown>;
  /** The conversation the destination stage owns, creating it when the task has none. */
  resolveSession(task: HubTask, columnId: string): Promise<string>;
  /**
   * Release the messages this stage entry held after its own instruction is delivered. A
   * message addressed to the conversation that instruction reached is excluded, because its
   * first step carries it, unless no exclusion is given: a recovery retry has no new first
   * step, so everything still held is delivered separately. Every other destination is
   * always delivered separately.
   */
  releaseHeld?(taskId: string, columnId: string, deliveredSessionId?: string): Promise<void>;
  /**
   * Prepare the conversation for the instruction that is about to wake it. A throw fails
   * this admission before the wake, so a failed preparation consumes no input and never
   * runs the stage without its handoffs. `accepted` means the durable log already records
   * this entry's instruction, so it must not be sent again.
   */
  prepareHeld?(taskId: string, columnId: string, sessionId: string, instructionId: string): Promise<'deliver' | 'accepted'>;
  /** Forget a preparation whose native delivery failed, so the same entry can be retried. */
  abandonHeld?(taskId: string, columnId: string, sessionId: string): void;
  /**
   * Whether this entry still holds messages for the conversation its instruction reached.
   * Those travel with the instruction's first step, so the entry stays unresolved until
   * that step durably records the instruction; a rejected or canceled step leaves the
   * retry action available instead of stranding the queue.
   */
  retainsEntry?(task: HubTask, columnId: string, sessionId: string): boolean;
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
  /** Native prompt identity; omitted derives one from the entry, so a retry deduplicates. */
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
  const incoming = task.scriptedHandoff;
  const handoff = incoming && incoming.entryId === entryId && !incoming.acceptedAt ? incoming : undefined;
  const assertCurrent = () => {
    invariant(request.isCurrent?.() !== false, 'STALE_HANDOFF', 'The host no longer owns this context admission.');
    const current = deps.locate(request.taskId).task;
    invariant(current.columnId === request.columnId && (entryId === undefined || current.stageEntry?.id === entryId),
      'TASK_MOVED', 'The task stage entry changed before native instruction admission.');
    if (handoff) invariant(current.scriptedHandoff?.id === handoff.id && current.scriptedHandoff.entryId === entryId,
      'STALE_HANDOFF', 'The scripted handoff belongs to an older stage entry.');
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
  const sessionId = request.sessionId ?? await deps.resolveSession(task, request.columnId);
  await deps.assertExecutionContext(sessionId);
  // Both awaits above can let the task, the workflow, or the recording change, so
  // the send re-reads them. The message still belongs to the requested stage, and
  // a task that left it must not receive that stage's instruction.
  const live = deps.locate(request.taskId);
  assertCurrent();
  // A manual retry of the same entry reuses this identity, so an instruction already queued
  // or recorded is never admitted twice; a task without an entry keeps a fresh one.
  const requestIdentity = entryId === undefined ? randomUUID() : 'stage-instruction:' + request.taskId + ':' + entryId;
  // The message is composed from the workflow and the task as they are at the moment it is
  // composed. The delivery composes it again after its own final authority check, so an edit
  // that kept this entry but changed the stage's responsibility or routes still reaches it.
  const compose = (target: StageInstructionTarget): StageInstructionDelivery => {
    const briefing = buildTransitionBriefing(target.board.workflow, { columnId: request.columnId, recordedTransition: target.task.recordedTransition });
    const stage = target.board.workflow.columns.find(value => value.id === request.columnId);
    // The source stage is resolved at send time, so a stage renamed between the tool
    // call and the delivery is described with the name the workflow carries now.
    const transition = request.transition === undefined ? undefined : {
      fromStageName: target.board.workflow.columns.find(value => value.id === request.transition!.fromColumnId)?.name ?? request.transition.fromColumnId,
      reason: request.transition.reason,
    };
    // The route a conversation fell back from is a durable fact of that conversation's
    // binding, reported while the conversation runs instead of only until delivery.
    const fallback = target.task.sessionRoles?.[sessionId]?.modelFallback;
    return buildStageInstructionDelivery({
      instruction,
      ...(fallback === undefined ? {} : { notice: modelFallbackNotice({ agent: target.task.sessionRoles?.[sessionId]?.agent ?? request.columnId, model: fallback }) }),
      ...(transition === undefined ? {} : { transition }),
      ...(handoff === undefined ? {} : { handoff }),
      ...(briefing === undefined ? {} : { briefing }),
      stageName: stage?.name ?? request.columnId,
      ...(target.task.stageEntry === undefined ? {} : { entryId: target.task.stageEntry.id }),
      task: target.task,
      workflow: target.board.workflow,
      requestId: request.requestId ?? handoff?.id ?? requestIdentity,
    });
  };
  // Fallible batch preparation runs before the wake, not after it: an unreadable log, a
  // failed durability checkpoint, or an uncomposable handoff fails this admission while
  // nothing has been claimed, instead of blocking a step that already took user input.
  const prepared = deps.prepareHeld === undefined ? 'deliver' : await deps.prepareHeld(request.taskId, request.columnId, sessionId, requestIdentity);
  assertCurrent();
  if (prepared === 'accepted') {
    // The conversation already records this entry's instruction: never send it twice. The
    // remaining handoffs have no new first step to ride, so they use the separate path, and
    // the entry retires only when nothing is left to deliver.
    try { await deps.releaseHeld?.(request.taskId, request.columnId); } catch { /* reported by the port */ }
    await settleEntry(false);
    return sessionId;
  }
  const delivery = compose(deps.locate(request.taskId));
  try {
    await deps.deliver(sessionId, { ...delivery, assertCurrent, refresh: () => compose(deps.locate(request.taskId)) });
  } catch (error) {
    // A failed native delivery never enqueued the instruction, so its armed preparation must
    // not block the same entry's retry.
    deps.abandonHeld?.(request.taskId, request.columnId, sessionId);
    throw error;
  }
  // Reading the entry again after the send decides acceptance ownership from live state.
  const retains = deps.retainsEntry?.(deps.locate(request.taskId).task, request.columnId, sessionId) === true;
  await settleEntry(retains);
  // The stage's messages wait for its instruction, so they are released only after it
  // was delivered; the ones that conversation itself receives travel with its first step.
  // A release failure is reported by the host and never undoes the entry.
  try { await deps.releaseHeld?.(request.taskId, request.columnId, sessionId); } catch { /* reported by the port */ }
  return sessionId;

  /**
   * Record the entry consequence of this admission. A batch entry keeps its marker until the
   * conversation durably records the instruction and every handoff the first step carried;
   * a recovery retry retires it only once nothing is left to deliver.
   */
  async function settleEntry(retains: boolean): Promise<void> {
    await deps.transact(target.hubId, draft => {
      const current = draft.tasks.find(value => value.id === task.id);
      if (!current || (entryId !== undefined && current.stageEntry?.id !== entryId)) return;
      if (handoff && current.scriptedHandoff?.id === handoff.id) {
        const accepted = current.scriptedHandoff; accepted.acceptedAt = new Date().toISOString(); delete accepted.error;
        recordScriptedHandoff(current,{at:accepted.acceptedAt,deliveryId:accepted.id,executionId:accepted.executionId,fromColumnId:accepted.fromColumnId,columnId:current.columnId,outcome:'accepted',exit:accepted.exit,message:accepted.message,...(accepted.params===undefined?{}:{parameters:accepted.params})});
      }
      const marker = current.instructionPending;
      if (!marker || marker.columnId !== request.columnId) return;
      if (request.expectedEnteredAt !== undefined && marker.enteredAt !== request.expectedEnteredAt) return;
      if (retains) return;
      // A recovery retry has no new first step, so it retires the entry only when nothing is
      // left to deliver; otherwise the failed release keeps the retry action available.
      const remaining = prepared === 'accepted' && heldMessagesFor(current, request.columnId)
        .some(message => addressedConversationId(current, message.agent) === sessionId);
      if (!remaining) delete current.instructionPending;
      // A successful manual instruction for this stage also resolves a failed host
      // advance — automatic or declared — so the task is not left blocked by it.
      const failed = current.pendingTransition;
      if (failed !== undefined && failed.origin !== undefined && failed.status === 'failed' && failed.columnId === request.columnId) delete current.pendingTransition;
    });
  }
}
