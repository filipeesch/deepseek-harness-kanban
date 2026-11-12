import { captureDeterministicTargets, establishStageEntry, ensureLocalStageIdentity } from './deterministic-state.js';
import { declaredParameterValues } from './deterministic-parameters.js';
import type { HubTask, Task, Workflow } from '../shared/types.js';
import { compareTaskOrder } from './task-order.js';
import { entryInstruction } from './stage-entry.js';
import { placementIndex, type Placement } from './placement.js';
import { recordAutoModeChange, recordStageEntry, recordDeterministicExecution } from './task-history/record.js';

/**
 * The one stage placement, expressed over a board's own workflow and tasks.
 *
 * It takes the board instead of the Hub so a caller that orders one board — the
 * repository, a fake board in a test, or a future surface — runs the same rules
 * without cloning an aggregate. The caller owns the task lookup and the write
 * transaction.
 */

/** The board a placement orders. */
export interface TaskPlacementBoard {
  readonly workflow: Workflow;
  localStageIdentities?: Record<string, string>;
  /** The board's tasks; a placement only reorders these. */
  readonly tasks: HubTask[];
}

export interface TaskPlacementOptions {
  /** Keeps the agent-requested pause, as an automatic advance that was already admitted does. */
  readonly retainAgentPause?: boolean;
  /** The moment the move settled, recorded with the stage entry. */
  readonly at: string;
  readonly allocateId?: () => string;
  /** Values a declared transition supplies for the destination's declared parameters. */
  readonly parameters?: Readonly<Record<string, string>>;
}

/** Place one task in a stage of its board, recording the stage entry the move settles. */
export function placeTaskIn(board: TaskPlacementBoard, task: HubTask, columnId: string, placement: Placement, enteredAt: number, options: TaskPlacementOptions): void {
  const sourceColumnId = task.columnId;
  const destination = board.tasks.filter(value => value.columnId === columnId && value.id !== task.id)
    .sort(compareTaskOrder);
  const index = placementIndex(placement, destination);
  task.columnId = columnId;
  // A placement resolves the diagnostic pause. The agent pause is a user-facing
  // stop, so a user movement resumes the task while an automatic advance that
  // was already admitted keeps it.
  const clearedPause = task.autoMode?.pause !== undefined;
  const clearedHold = options.retainAgentPause !== true && task.autoMode?.hold !== undefined;
  if (clearedPause) delete task.autoMode!.pause;
  if (clearedHold) delete task.autoMode!.hold;
  // A recorded transition is an edge of one stage, so it stops applying the
  // moment the task leaves that stage. A same-stage reorder keeps it.
  if (sourceColumnId !== columnId && task.recordedTransition !== undefined) delete task.recordedTransition;
  if (sourceColumnId !== columnId) {
    const superseded = task.deterministic;
    if (superseded && !superseded.result && !['stopped', 'failed'].includes(superseded.phase)) {
      const used = superseded.parameters === undefined || superseded.attempt === 0 ? {} : declaredParameterValues(superseded.capture?.params ?? Object.keys(superseded.parameters), superseded.parameters);
      recordDeterministicExecution(task, { at: options.at, executionId: superseded.executionId, columnId: sourceColumnId, outcome: 'stopped', ...(Object.keys(used).length === 0 ? {} : { parameters: used }) });
    }
    recordStageEntry(task as Task, sourceColumnId, columnId, options.at);
    const destinationColumn = board.workflow.columns.find(value => value.id === columnId);
    if (entryInstruction(destinationColumn) !== undefined) task.instructionPending = { columnId, enteredAt };
    else delete task.instructionPending;
    if (destinationColumn !== undefined) {
      const allocate = options.allocateId ?? (() => globalThis.crypto.randomUUID());
      establishStageEntry(task, destinationColumn, ensureLocalStageIdentity(board, columnId, allocate), options.at, allocate, captureDeterministicTargets(board, destinationColumn, allocate), options.parameters);
    }
  }
  // A cleared pause is an auto mode change wherever it happens, so a placement
  // records the resume it caused, including a same-stage reorder that clears a hold.
  if (clearedPause || clearedHold) recordAutoModeChange(task as Task, { action: 'resumed' }, options.at);
  destination.splice(index, 0, task);
  destination.forEach((value, position) => { value.position = position; });
  if (sourceColumnId !== columnId) {
    board.tasks.filter(value => value.columnId === sourceColumnId)
      .sort(compareTaskOrder)
      .forEach((value, position) => { value.position = position; });
  }
}
