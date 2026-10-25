import { useCallback, useEffect, useRef, useState } from 'react';
import { transitionAccess } from '../domain/transitions.js';
import type { BoardState, Column, Command, KanbanSnapshot, Problem, Task } from '../shared/types.js';
import { asProblem } from './ui.js';

export interface OptimisticMove { taskId: string; columnId: string; beforeTaskId: string | null }

export interface MoveConfirmation {
  taskId: string;
  taskTitle: string;
  fromColumnId: string;
  toColumnId: string;
  fromName: string;
  toName: string;
  workflowName: string;
}

export interface MoveRequestOptions {
  state: BoardState | null;
  run: (command: Command) => Promise<KanbanSnapshot>;
  onImmediateError: (error: unknown) => void;
}

export interface MoveRequest {
  optimistic: OptimisticMove | null;
  move: (task: Task, column: Column, beforeTaskId?: string | null) => Promise<boolean>;
  confirmation: MoveConfirmation | null;
  pending: boolean;
  error: Problem | null;
  canRetry: boolean;
  confirm: () => Promise<void>;
  cancel: () => void;
}

interface PendingConfirmation extends MoveConfirmation {
  beforeTaskId: string | null;
  resolve: (moved: boolean) => void;
  settled: boolean;
}

const contextChanged = (message: string): Problem => ({ code: 'MOVE_CONTEXT_CHANGED', message });

function anchorAvailable(request: PendingConfirmation, state: BoardState): boolean {
  if (request.beforeTaskId === null) return true;
  const anchor = state.tasks.find(value => value.id === request.beforeTaskId);
  return Boolean(anchor && anchor.id !== request.taskId && anchor.columnId === request.toColumnId);
}

function staleConfirmation(request: PendingConfirmation, state: BoardState | null): boolean {
  if (!state) return true;
  const task = state.tasks.find(value => value.id === request.taskId);
  const destination = state.workflow.columns.find(value => value.id === request.toColumnId);
  return !task || !destination || task.columnId !== request.fromColumnId || !anchorAvailable(request, state);
}

/** Classifies moves, applies allowed and reorder requests, and owns the restricted-move confirmation lifecycle. */
export function useMoveRequest({ state, run, onImmediateError }: MoveRequestOptions): MoveRequest {
  const stateRef = useRef(state); stateRef.current = state;
  const runRef = useRef(run); runRef.current = run;
  const errorRef = useRef(onImmediateError); errorRef.current = onImmediateError;
  const alive = useRef(true);
  const submitting = useRef(false);
  const pendingRequest = useRef<PendingConfirmation | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticMove | null>(null);
  const [confirmation, setConfirmation] = useState<MoveConfirmation | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const [canRetry, setCanRetry] = useState(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const request = pendingRequest.current;
      pendingRequest.current = null;
      if (request && !request.settled) { request.settled = true; request.resolve(false); }
    };
  }, []);

  function settle(moved: boolean): void {
    const request = pendingRequest.current;
    pendingRequest.current = null;
    if (request && !request.settled) { request.settled = true; request.resolve(moved); }
    if (!alive.current) return;
    setConfirmation(null); setPending(false); setError(null); setCanRetry(true);
  }

  function fail(problem: unknown, retry: boolean): void {
    if (!alive.current) return;
    setError(asProblem(problem)); setCanRetry(retry); setPending(false);
  }

  const apply = useCallback(async (task: Task, column: Column, beforeTaskId: string | null, override: boolean): Promise<boolean> => {
    setOptimistic({ taskId: task.id, columnId: column.id, beforeTaskId });
    try {
      await runRef.current({
        type: 'task.move', taskId: task.id, columnId: column.id, mode: 'move',
        ...(beforeTaskId !== null ? { beforeTaskId } : {}),
        ...(override ? { overrideTransition: true } : {}),
      });
      return true;
    } finally {
      if (alive.current) setOptimistic(null);
    }
  }, []);

  const move = useCallback(async (task: Task, column: Column, beforeTaskId: string | null = null): Promise<boolean> => {
    const currentState = stateRef.current;
    if (!currentState) { errorRef.current({ code: 'BOARD_NOT_READY', message: 'The board is still loading.' }); return false; }
    const currentTask = currentState.tasks.find(value => value.id === task.id);
    const currentColumn = currentState.workflow.columns.find(value => value.id === column.id);
    if (!currentTask || !currentColumn) { errorRef.current({ code: 'INVALID_TARGET', message: 'The task or destination stage is no longer available.' }); return false; }
    if (currentTask.operation || currentTask.pendingTransition) { errorRef.current({ code: 'OPERATION_PENDING', message: 'Resolve the current task operation before moving.' }); return false; }
    const access = transitionAccess(currentState.workflow, currentTask.columnId, currentColumn.id);
    if (access === null) { errorRef.current({ code: 'INVALID_TARGET', message: 'The destination stage does not exist.' }); return false; }
    if (access === 'reorder' || access === 'allowed') {
      try { return await apply(currentTask, currentColumn, beforeTaskId, false); }
      catch (failure) { if (alive.current) errorRef.current(failure); return false; }
    }
    if (pendingRequest.current) return false; // A second restricted request is refused; the open confirmation remains authoritative.
    const source = currentState.workflow.columns.find(value => value.id === currentTask.columnId);
    return new Promise<boolean>(resolve => {
      const model: MoveConfirmation = {
        taskId: currentTask.id, taskTitle: currentTask.title,
        fromColumnId: currentTask.columnId, toColumnId: currentColumn.id,
        fromName: source?.name ?? currentTask.columnId, toName: currentColumn.name,
        workflowName: currentState.workflow.name,
      };
      const request: PendingConfirmation = { ...model, beforeTaskId, resolve, settled: false };
      pendingRequest.current = request;
      if (!alive.current) { request.settled = true; resolve(false); return; }
      setConfirmation(model); setError(null); setCanRetry(true); setPending(false);
    });
  }, [apply]);

  const confirm = useCallback(async (): Promise<void> => {
    const request = pendingRequest.current;
    if (!request || request.settled || submitting.current) return;
    const currentState = stateRef.current;
    if (!currentState) { fail({ code: 'BOARD_NOT_READY', message: 'The board is still loading.' }, false); return; }
    const task = currentState.tasks.find(value => value.id === request.taskId);
    const destination = currentState.workflow.columns.find(value => value.id === request.toColumnId);
    if (!task || !destination) { fail(contextChanged('The task or destination stage is no longer available.'), false); return; }
    if (task.columnId !== request.fromColumnId) { fail(contextChanged('The card moved to another stage while this confirmation was open.'), false); return; }
    if (!anchorAvailable(request, currentState)) { fail(contextChanged('The drop position is no longer available. Cancel and try again.'), false); return; }
    if (task.operation || task.pendingTransition) { fail({ code: 'OPERATION_PENDING', message: 'Resolve the current task operation before moving.' }, true); return; }
    const access = transitionAccess(currentState.workflow, task.columnId, destination.id);
    if (access === null) { fail(contextChanged('The destination stage is no longer available.'), false); return; }
    submitting.current = true;
    setPending(true); setError(null); setCanRetry(true);
    try {
      await apply(task, destination, request.beforeTaskId, access === 'restricted');
      settle(true);
    } catch (failure) {
      fail(failure, !staleConfirmation(request, stateRef.current));
    } finally {
      submitting.current = false;
    }
  }, [apply]);

  const cancel = useCallback((): void => {
    if (submitting.current) return;
    settle(false);
  }, []);

  return { optimistic, move, confirmation, pending, error, canRetry, confirm, cancel };
}
