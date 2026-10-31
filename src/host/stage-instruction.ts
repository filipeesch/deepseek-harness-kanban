import type { Board, HubState, HubTask } from '../shared/types.js';
import { invariant } from '../shared/errors.js';
import { entryInstruction } from '../domain/stage-entry.js';

/** The task scope an admission needs; the host resolves it from its task locator. */
export interface StageInstructionTarget { hubId: string; task: HubTask; board: Board }

export interface StageInstructionDeps {
  locate(taskId: string): StageInstructionTarget;
  transact(hubId: string, change: (draft: HubState) => void): Promise<unknown>;
  /** The first open conversation, creating one when every tab is closed. */
  resolveSession(task: HubTask): Promise<string>;
  assertExecutionContext(sessionId: string): Promise<void>;
  send(sessionId: string, text: string, requestId?: string): Promise<void>;
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
  /** Native prompt identity; omitted keeps a fresh identity per send. */
  requestId?: string;
  /** An already resolved target; omitted resolves the first open conversation. */
  sessionId?: string;
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
  await deps.send(sessionId, instruction, request.requestId);
  await deps.transact(target.hubId, draft => {
    const current = draft.tasks.find(value => value.id === task.id);
    const marker = current?.instructionPending;
    if (!current || !marker || marker.columnId !== request.columnId) return;
    if (request.expectedEnteredAt !== undefined && marker.enteredAt !== request.expectedEnteredAt) return;
    delete current.instructionPending;
    // A successful manual instruction for this stage also resolves a failed
    // automatic advance, so the task is not left blocked by its failed record.
    if (current.pendingTransition?.origin === 'auto' && current.pendingTransition.status === 'failed' && current.pendingTransition.columnId === request.columnId) delete current.pendingTransition;
  });
  return sessionId;
}
