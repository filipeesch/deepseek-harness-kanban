import React, { useCallback, useRef, type ReactNode } from 'react';
import type { BoardState, Column, Command, KanbanSnapshot, Task } from '../shared/types.js';
import { entryInstruction, hasUnresolvedEntry } from '../domain/stage-entry.js';
import { normalizeSnapshot } from './hub-view.js';
import { useCardDrag, type CardDragState } from './useCardDrag.js';
import { useMoveRequest, type MoveIntent, type OptimisticMove } from './useMoveRequest.js';
import { TransitionOverrideDialog } from './transition-override-dialog.js';
import type { AutoRunController, AutoRunInput } from './auto-run.js';
import type { PrepareExecution } from './execution-preparation/contract.js';

export interface BoardMovesOptions {
  state: BoardState | null;
  run: (command: Command) => Promise<KanbanSnapshot>;
  autoRun: AutoRunController;
  selectionMode: boolean;
  prepare: PrepareExecution;
  onError: (error: unknown) => void;
  /** Clears a previous board notice when a new move starts. */
  onMoveStart?: () => void;
}

export interface BoardMoves {
  optimistic: OptimisticMove | null;
  drag: CardDragState | null;
  begin: (event: React.PointerEvent<HTMLElement>, taskId: string, sourceColumnId: string) => void;
  shouldSuppressClick: () => boolean;
  moveTo: (task: Task, column: Column, beforeTaskId?: string | null) => Promise<boolean>;
  /** The card's run action: prepare the first execution when needed, then send. */
  requestRun: (input: AutoRunInput) => void;
  /** The restricted-transition confirmation owned by the move request. */
  overrideDialog: ReactNode;
}

/**
 * The board's move pipeline: drag, validated move request, optimistic placement,
 * countdown arming, and the first-execution preparation. It owns every dialog
 * the pipeline opens so `BoardView` only renders the returned nodes.
 */
export function useBoardMoves({ state, run, autoRun, selectionMode, prepare, onError, onMoveStart }: BoardMovesOptions): BoardMoves {
  const stateRef = useRef(state); stateRef.current = state;
  const autoRunRef = useRef(autoRun); autoRunRef.current = autoRun;
  const prepareRef = useRef(prepare); prepareRef.current = prepare;
  const onMoveStartRef = useRef(onMoveStart); onMoveStartRef.current = onMoveStart;

  function armAfterMove(result: KanbanSnapshot, task: Task, column: Column): void {
    if (task.columnId === column.id) return;
    const normalized = normalizeSnapshot(result);
    const moved = normalized.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === task.id);
    const movedBoard = moved ? normalized.state.hubs.flatMap(hub => hub.boards).find(value => value.id === moved.boardId) : undefined;
    const destination = movedBoard?.workflow.columns.find(value => value.id === column.id);
    const instruction = entryInstruction(destination);
    if (moved && destination && instruction !== undefined && hasUnresolvedEntry(moved, destination.id)) {
      autoRunRef.current.arm({ taskId: moved.id, columnId: destination.id, enteredAt: moved.instructionPending!.enteredAt, instruction });
    }
  }

  const beforeApply = useCallback(async (intent: MoveIntent): Promise<boolean> => {
    if (intent.task.columnId === intent.column.id) return true;
    if (entryInstruction(intent.column) === undefined) return true;
    const project = stateRef.current?.projects.find(value => value.id === intent.task.projectId);
    try {
      return await prepareRef.current({ kind: 'move', task: intent.task, column: intent.column, ...(project === undefined ? {} : { project }) });
    } catch {
      return false;
    }
  }, []);

  const moveRequest = useMoveRequest({ state, run, onImmediateError: onError, onMoved: armAfterMove, beforeApply });
  const { optimistic, confirmation, pending: movePending, error: moveError, canRetry, confirm: confirmMove, cancel: cancelMove, move } = moveRequest;

  function canDrop(columnId: string, taskId: string): boolean {
    const current = stateRef.current;
    if (!current || selectionMode) return false;
    const task = current.tasks.find(value => value.id === taskId);
    const column = current.workflow.columns.find(value => value.id === columnId);
    return Boolean(task && column && !task.operation && !task.pendingTransition);
  }

  const { drag, begin, shouldSuppressClick } = useCardDrag({
    enabled: Boolean(state) && !selectionMode,
    canDrop,
    onDrop: (taskId, columnId, beforeTaskId) => {
      const task = stateRef.current?.tasks.find(value => value.id === taskId);
      const column = stateRef.current?.workflow.columns.find(value => value.id === columnId);
      if (!task || !column) return;
      onMoveStartRef.current?.();
      void moveRequest.move(task, column, beforeTaskId);
    },
  });

  const moveTo = useCallback((task: Task, column: Column, beforeTaskId?: string | null): Promise<boolean> => move(task, column, beforeTaskId), [move]);

  const requestRun = useCallback((input: AutoRunInput): void => {
    const current = stateRef.current;
    const task = current?.tasks.find(value => value.id === input.taskId);
    const column = current?.workflow.columns.find(value => value.id === input.columnId);
    if (!current || !task || !column) return;
    const project = current.projects.find(value => value.id === task.projectId);
    void (async () => {
      let proceed = true;
      try { proceed = await prepareRef.current({ kind: 'run', task, column, ...(project === undefined ? {} : { project }) }); }
      catch { proceed = false; }
      if (proceed) void autoRunRef.current.runNow(input);
    })();
  }, []);

  const overrideDialog = confirmation ? <TransitionOverrideDialog
    taskTitle={confirmation.taskTitle}
    workflowName={confirmation.workflowName}
    sourceName={confirmation.fromName}
    destinationName={confirmation.toName}
    pending={movePending}
    problem={moveError}
    canRetry={canRetry}
    onCancel={cancelMove}
    onConfirm={() => void confirmMove()}
  /> : null;

  return { optimistic, drag, begin, shouldSuppressClick, moveTo, requestRun, overrideDialog };
}
