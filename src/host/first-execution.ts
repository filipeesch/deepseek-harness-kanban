import { entryInstruction } from '../domain/stage-entry.js';
import { planFirstExecution } from '../domain/first-execution.js';
import { firstOpenSessionId } from '../shared/conversations.js';
import { KanbanError, invariant } from '../shared/errors.js';
import type { CreateWorktreeInput } from '../shared/types.js';
import type { LocatedTask } from './hub-repository.js';

/** The task scope and ports one automatic first-execution preparation needs. */
export interface FirstExecutionPorts {
  locate(taskId: string): LocatedTask;
  createWorktree(taskId: string, draft: CreateWorktreeInput): Promise<void>;
  createConversation(taskId: string): Promise<string>;
}

export interface FirstExecutionRequest {
  taskId: string;
  columnId: string;
  expectedEnteredAt: number;
  /** When set, the current workflow instruction must still equal this reviewed value. */
  expectedInstruction?: string;
}

export interface FirstExecutionPreparation { sessionId: string }

/** The common entry guard: the stage, the persisted entry identity, and the task's busy state. */
function validateEntry(located: LocatedTask, request: FirstExecutionRequest): void {
  const task = located.task;
  invariant(task.columnId === request.columnId, 'TASK_MOVED', 'The task moved to another stage. Review the current stage before starting its first execution.');
  invariant(task.instructionPending?.columnId === request.columnId && task.instructionPending.enteredAt === request.expectedEnteredAt,
    'INSTRUCTION_ALREADY_RESOLVED', 'This stage entry was already resolved or replaced. Review the current entry before starting.');
  const instruction = entryInstruction(located.board.workflow.columns.find(column => column.id === request.columnId));
  invariant(instruction !== undefined, 'EMPTY_PROMPT', 'The stage has no entry instruction.');
  if (request.expectedInstruction !== undefined) {
    invariant(instruction === request.expectedInstruction, 'INSTRUCTION_CHANGED', 'The workflow instruction changed. Review the current instruction before starting.');
  }
  invariant(!task.operation, 'CONTEXT_OPERATION_PENDING', 'Resolve the task context operation before starting the first execution.');
  invariant(!task.pendingTransition, 'TASK_BUSY', 'Resolve the confirmed transition first.');
  invariant(!located.project.operation, 'PROJECT_RELOCATING', 'Resolve the project relocation before starting the first execution.');
}

/**
 * The one host preparation for a creation-triggered first execution. It validates
 * the instructed entry, resolves the default worktree, creates it when the task
 * has none, and creates the first conversation only after that worktree is ready.
 * It never sends: the caller arms the countdown or dispatches the instruction.
 */
export async function prepareFirstExecution(ports: FirstExecutionPorts, request: FirstExecutionRequest): Promise<FirstExecutionPreparation> {
  const located = ports.locate(request.taskId);
  validateEntry(located, request);
  const existing = firstOpenSessionId(located.task);
  if (existing !== undefined) return { sessionId: existing };
  const plan = planFirstExecution({
    task: located.task,
    project: located.project,
    workflow: located.board.workflow,
    columnId: request.columnId,
    modelSeatAvailable: false,
    mode: 'automatic',
    startRequested: true,
  });
  invariant(plan !== null && plan.start, 'INSTRUCTION_ALREADY_RESOLVED', 'The first execution is no longer pending.');
  if (plan.worktree === 'blocked') {
    throw new KanbanError('WORKTREE_BINDING_UNRESOLVED', 'Resolve the worktree binding in the Git section before starting the first execution.');
  }
  if (plan.worktree === 'create-default') {
    // Creation derives the collision-free title defaults itself, at the moment it
    // runs, so the preparation never holds a copy that could go stale.
    await ports.createWorktree(located.task.id, { mode: 'new' });
  }
  return { sessionId: await ports.createConversation(located.task.id) };
}
