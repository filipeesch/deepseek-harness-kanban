import { randomUUID } from 'node:crypto';
import { hasPendingUserWork } from '../domain/pending-user-work.js';
import { blocksAdvance } from '../domain/auto-mode-hold.js';
import { entryInstruction } from '../domain/stage-entry.js';
import { resolveExceptionalTransition, type ExceptionalTransitionIdentity } from '../domain/transition-route.js';
import { declaredParameterNames, validateParameterValues } from '../domain/scripted-parameters.js';
import { ownsStage } from '../domain/conversation-role.js';
import type { PendingTransition, Task } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import type { AdvanceAdmissionDeps } from './advance-admission.js';

export interface ExceptionalAdmissionDeps extends AdvanceAdmissionDeps {
  /** Fresh task-wide running and pending facts, ignoring only this prepared transition. */
  ready(task: Task): Promise<boolean>;
  /** Verify whether a failed finalization write was durably applied. */
  reconcileFinalization(hubId: string, taskId: string, pendingId: string, exceptionId: string): Promise<'prepared' | 'finalized'>;
}

/**
 * Prepare a non-dispatchable durable record, then finalize it in a second
 * serialized transaction. The finalization callback is the logical admission
 * point: activity observed after that callback is subsequent to admission.
 * An interrupted preparation is discarded on startup, never replayed.
 */
export async function admitExceptionalTurnAdvance(
  deps: ExceptionalAdmissionDeps, taskId: string, expected: ExceptionalTransitionIdentity, isObserved: () => boolean,
): Promise<boolean> {
  let finalized = false;
  let hubId: string | undefined;
  let transitionId: string | undefined;
  try {
    const located = deps.locate(taskId);
    hubId = located.hubId;
    const destination = resolveExceptionalTransition(located.board.workflow, located.task, expected);
    if (!isObserved() || blocksAdvance(located.task) || !destination) return false;
    const instruction = entryInstruction(destination);
    const latest = deps.locate(taskId);
    if (!isObserved() || blocksAdvance(latest.task) || !resolveExceptionalTransition(latest.board.workflow, latest.task, expected)) return false;
    let pending;
    try { pending = await deps.pending(latest.task); }
    catch (error) { deps.report(error); return false; }
    if (hasPendingUserWork(pending) || !isObserved()) return false;
    const recorded = latest.task.recordedTransition!;
    const values = recorded.parameters === undefined ? undefined : { ...recorded.parameters };
    const reason = recorded.reason!;
    const transition: PendingTransition = {
      id: randomUUID(), fromColumnId: expected.fromColumnId, columnId: expected.columnId,
      mode: instruction === undefined ? 'move' : 'run', status: 'waiting', origin: 'agent',
      transitionOverride: true, exceptionUnfinalized: expected.id, reason,
      ...(values === undefined ? {} : { parameters: values }),
      ...(instruction === undefined ? {} : { text: instruction }),
    };
    transitionId = transition.id;
    const matches = (task: Task, workflow: typeof latest.board.workflow): boolean => {
      const current = resolveExceptionalTransition(workflow, task, expected);
      if (!current || entryInstruction(current) !== instruction || task.recordedTransition?.reason !== reason
          || JSON.stringify(task.recordedTransition.parameters) !== JSON.stringify(values)) return false;
      const names = declaredParameterNames(current.scripted?.params);
      return names.length === 0 ? values === undefined : validateParameterValues(names, values).ok;
    };
    let prepared = false;
    await deps.transact(latest.hubId, draft => {
      const task = draft.tasks.find(value => value.id === taskId);
      const board = task && draft.boards.find(value => value.id === task.boardId);
      if (!task || !board || !isObserved() || blocksAdvance(task)) return;
      if (!ownsStage(task, board.workflow, task.columnId, expected.sessionId)) return;
      if (!matches(task, board.workflow)) return;
      task.pendingTransition = transition;
      prepared = true;
    });
    if (!prepared || !isObserved()) return false;
    const current = deps.locate(taskId);
    let ready: boolean;
    try { ready = await deps.ready(current.task); }
    catch (error) { deps.report(error); return false; }
    if (!ready || !isObserved()) return false;
    try { await deps.transact(current.hubId, draft => {
      const task = draft.tasks.find(value => value.id === taskId);
      const board = task && draft.boards.find(value => value.id === task.boardId);
      if (!task || !board || !isObserved() || task.pendingTransition?.id !== transition.id || task.pendingTransition.exceptionUnfinalized !== expected.id) return;
      if (!ownsStage(task, board.workflow, task.columnId, expected.sessionId)) return;
      const withoutPrepared = { ...task }; delete withoutPrepared.pendingTransition;
      if (blocksAdvance(withoutPrepared) || !matches(task, board.workflow)) return;
      // Linearization point: once this callback finalizes, subsequent native
      // activity is after admission, even if storage takes time to persist it.
      delete task.pendingTransition.exceptionUnfinalized;
      delete task.recordedTransition;
      if (task.autoMode?.pause !== undefined) delete task.autoMode.pause;
      finalized = true;
    }); } catch (error) {
      if (!finalized) throw error;
      let state: 'prepared' | 'finalized';
      try { state = await deps.reconcileFinalization(current.hubId, taskId, transition.id, expected.id); }
      catch (failure) {
        throw new KanbanError('EXCEPTION_CLEANUP_FAILED', 'The exceptional finalization could not be verified; dispatch is held.', { cause: failure instanceof Error ? failure.message : String(failure) });
      }
      if (state === 'prepared') { finalized = false; throw error; }
      // The exact finalized record is durable despite the reported save failure.
      deps.report(error);
    }
    if (finalized) await deps.dispatch();
    return finalized;
  } finally {
    if (!finalized && hubId !== undefined) {
      try {
        await deps.transact(hubId, draft => {
          const task = draft.tasks.find(value => value.id === taskId);
          if (!task) return;
          if (transitionId !== undefined && task.pendingTransition?.id === transitionId && task.pendingTransition.exceptionUnfinalized === expected.id) delete task.pendingTransition;
          if (task.recordedTransition?.exception?.id === expected.id) delete task.recordedTransition;
        });
      } catch (error) {
        throw new KanbanError('EXCEPTION_CLEANUP_FAILED', 'The expired exceptional admission could not be safely removed.', { cause: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}
