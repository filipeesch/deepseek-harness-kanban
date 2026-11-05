import { useCallback, useRef, useState } from 'react';
import type { Command, KanbanSnapshot, Problem, Task } from '../shared/types.js';
import { asProblem } from './ui.js';

export interface BatchAdmissionRejection {
  title: string;
  problem: Problem;
}

export interface BatchDeletionOptions {
  run: (command: Command, allowDiscard?: boolean) => Promise<KanbanSnapshot>;
  /** Admission rejections are board errors; accepted tasks stay queued on the board. */
  onRejected: (rejections: readonly BatchAdmissionRejection[]) => void;
}

export interface BatchDeletion {
  pending: boolean;
  /** Fan out one deletion per task without holding the board while admission settles. */
  confirm: (tasks: readonly Task[]) => void;
}

/** Summarize per-task admission rejections into the board's single error surface. */
export function batchRejectionProblem(rejections: readonly BatchAdmissionRejection[]): Problem {
  return {
    code: rejections[0]?.problem.code ?? 'BULK_ADMISSION_FAILED',
    message: 'Could not start deletion for ' + rejections.map(item => item.title + ': ' + item.problem.message).join(' · '),
  };
}

/**
 * Owns the bulk deletion fan-out. The confirmation closes before admission
 * settles: every selected task is dispatched at once, accepted tasks leave the
 * board through the published snapshot, and only admission rejections are
 * reported back.
 */
export function useBatchDeletion(options: BatchDeletionOptions): BatchDeletion {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const confirm = useCallback((tasks: readonly Task[]) => {
    if (inFlight.current || tasks.length === 0) return;
    inFlight.current = true;
    setPending(true);
    const rejections: BatchAdmissionRejection[] = [];
    // Fanning out concurrently keeps one slow admission from delaying the rest.
    const submissions = tasks.map(task => optionsRef.current
      .run({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: task.worktree?.path ?? null }, false)
      .catch(error => { rejections.push({ title: task.title, problem: asProblem(error) }); }));
    void Promise.all(submissions)
      .then(() => { if (rejections.length > 0) optionsRef.current.onRejected([...rejections]); })
      .finally(() => { inFlight.current = false; setPending(false); });
  }, []);

  return { pending, confirm };
}
