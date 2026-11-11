import type { BoardState, Command, HubTask, Task } from '../../src/shared/types.js';
import { entryInstruction } from '../../src/domain/stage-entry.js';
import { placeTaskIn } from '../../src/domain/task-placement.js';
import { placementFromAnchor } from '../../src/domain/placement.js';

export type EnteredAtSource = () => number;

/** Monotonic entry identity for deterministic fake boards; never wall-clock dependent. */
export function createEnteredAtSource(start = 1_000): EnteredAtSource {
  let next = start;
  return () => next++;
}

/**
 * Apply the board half of a move through the domain placement production uses,
 * so the fake board records the same entry and orders the card the same way
 * instead of keeping a second implementation of the move.
 */
export function applyMove(state: BoardState, taskId: string, columnId: string, beforeTaskId: string | null | undefined, nextEnteredAt: EnteredAtSource): Task | undefined {
  const task = state.tasks.find(value => value.id === taskId);
  if (!task) return undefined;
  const enteredAt = nextEnteredAt();
  placeTaskIn(
    { workflow: state.workflow, tasks: state.tasks as HubTask[] },
    task as HubTask, columnId, placementFromAnchor(beforeTaskId), enteredAt, { at: new Date(enteredAt).toISOString() },
  );
  return task;
}

/** Mark a newly created task whose initial stage has an entry instruction. */
export function applyInitialEntry(state: BoardState, task: Task, nextEnteredAt: EnteredAtSource): void {
  const column = state.workflow.columns.find(value => value.id === task.columnId);
  if (entryInstruction(column) !== undefined) task.instructionPending = { columnId: task.columnId, enteredAt: nextEnteredAt() };
  else delete task.instructionPending;
}

export type RunInstructionResult = { ok: true } | { ok: false; code: string; message: string };

/** The fake-side mirror of the host's entry-identity and exact-instruction admission. */
export function applyRunInstruction(state: BoardState, command: Extract<Command, { type: 'task.runInstruction' }>): RunInstructionResult {
  const task = state.tasks.find(value => value.id === command.taskId);
  if (!task) return { ok: false, code: 'TASK_NOT_FOUND', message: 'Task does not exist.' };
  if (task.operation) return { ok: false, code: 'CONTEXT_OPERATION_PENDING', message: 'Resolve the task context operation before admitting another conversation or execution.' };
  if (task.columnId !== command.columnId) return { ok: false, code: 'TASK_MOVED', message: 'The task moved to another stage.' };
  if (task.pendingTransition) return { ok: false, code: 'TASK_BUSY', message: 'Resolve the confirmed transition first.' };
  const marker = task.instructionPending;
  if (marker?.columnId !== command.columnId || marker.enteredAt !== command.expectedEnteredAt) return { ok: false, code: 'INSTRUCTION_ALREADY_RESOLVED', message: 'This stage entry was already resolved or replaced.' };
  const column = state.workflow.columns.find(value => value.id === command.columnId);
  const instruction = entryInstruction(column);
  if (instruction === undefined || instruction !== command.expectedInstruction) return { ok: false, code: 'INSTRUCTION_CHANGED', message: 'The workflow instruction changed. Review the current instruction before running.' };
  delete task.instructionPending;
  return { ok: true };
}
