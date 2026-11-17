import type { Problem, Task } from '../../shared/types.js';
import type { PreparationEntry, PreparationOutcome } from './contract.js';

/** Everything the run needs from the board and the host. */
export interface PreparationRunPorts {
  /** Admit the task's default worktree creation in the background. */
  createWorktree(taskId: string): Promise<void>;
  /** Record the base-project choice. */
  dismissWorktree(taskId: string): Promise<void>;
  /** Create the task's first conversation and report what it became. */
  createConversation(taskId: string): Promise<void>;
  /** The newest projection of the task, or undefined when it is gone. */
  task(taskId: string): Task | undefined;
}

/** The preparation no longer applies because the instructed entry moved on. */
export function preparationAbandoned(): Problem {
  return { code: 'PREPARATION_ABANDONED', message: 'The stage entry changed before the first execution could be prepared.' };
}

function creationFailed(message: string): Problem {
  return { code: 'WORKTREE_CREATION_FAILED', message };
}

interface PendingWait {
  readonly entry: PreparationEntry;
  readonly resolve: () => void;
  readonly reject: (problem: Problem) => void;
}

/** Whether the run still belongs to this task's current instructed entry. */
export function preparationStillApplies(task: Pick<Task, 'columnId' | 'instructionPending'> | undefined, entry: PreparationEntry): boolean {
  return task !== undefined
    && task.columnId === entry.columnId
    && task.instructionPending?.columnId === entry.columnId
    && task.instructionPending.enteredAt === entry.enteredAt;
}

/**
 * Completes one first-execution preparation after the move: it records the
 * worktree answer, waits for the background creation to settle, and creates the
 * first conversation. The run is in-memory state owned by the mounted board, so a
 * reload abandons it while the host finishes the worktree; the entry then stays
 * unresolved with the run action available.
 */
export class PreparationRunController {
  private readonly waiters = new Map<string, PendingWait>();
  private disposed = false;

  constructor(private readonly ports: PreparationRunPorts) {}

  /**
   * Record the worktree answer, wait for a created checkout to be ready, and create
   * the first conversation. A task that needs no worktree answer still gets its
   * conversation here, so the countdown never targets a conversation that does not
   * exist yet.
   */
  async start(entry: PreparationEntry, worktree: PreparationOutcome): Promise<void> {
    this.assertOpen();
    if (worktree === 'create') {
      // A second surface may have created the checkout already; the projection is
      // authoritative, so a ready binding is never created again.
      if (this.ports.task(entry.taskId)?.worktree?.status !== 'ready') {
        await this.ports.createWorktree(entry.taskId);
        this.assertOpen();
        await this.awaitReady(entry);
      }
    } else if (worktree === 'base') {
      await this.ports.dismissWorktree(entry.taskId);
      this.assertOpen();
    }
    this.assertOpen();
    this.assertStillApplies(entry);
    await this.ports.createConversation(entry.taskId);
  }

  /** Settle every pending wait from the newest projection. */
  observe(tasks: readonly Task[]): void {
    for (const [taskId, wait] of [...this.waiters]) {
      this.settleWaiting(tasks.find(value => value.id === taskId), wait);
    }
  }

  /** Abandon every wait and every later step; a board that unmounts never arms a countdown. */
  dispose(): void {
    this.disposed = true;
    for (const [taskId, wait] of [...this.waiters]) this.finish(taskId, wait, preparationAbandoned());
  }

  private assertOpen(): void {
    if (this.disposed) throw preparationAbandoned();
  }

  private awaitReady(entry: PreparationEntry): Promise<void> {
    if (this.disposed) return Promise.reject(preparationAbandoned());
    const task = this.ports.task(entry.taskId);
    const failure = this.settledFailure(task, entry);
    if (failure !== undefined) return Promise.reject(failure);
    if (this.ready(task, entry)) return Promise.resolve();
    const replaced = this.waiters.get(entry.taskId);
    if (replaced !== undefined) this.finish(entry.taskId, replaced, preparationAbandoned());
    return new Promise<void>((resolve, reject) => {
      const wait: PendingWait = { entry, resolve, reject };
      this.waiters.set(entry.taskId, wait);
      this.settleWaiting(this.ports.task(entry.taskId), wait);
    });
  }

  private settleWaiting(task: Task | undefined, wait: PendingWait): void {
    const failure = this.settledFailure(task, wait.entry);
    if (failure !== undefined) { this.finish(wait.entry.taskId, wait, failure); return; }
    if (this.ready(task, wait.entry)) this.finish(wait.entry.taskId, wait, undefined);
  }

  /** The failure the projection proves, or undefined while the run should keep waiting. */
  private settledFailure(task: Task | undefined, entry: PreparationEntry): Problem | undefined {
    if (!preparationStillApplies(task, entry)) return preparationAbandoned();
    const operation = task!.operation;
    if (operation?.phase === 'failed') return operation.error ?? creationFailed('The worktree creation failed.');
    if (operation !== null) return undefined;
    if (task!.worktree?.status === 'error') return task!.worktree.error ?? creationFailed('The worktree creation failed.');
    return undefined;
  }

  /** The worktree the run asked for is ready and no operation still holds the task. */
  private ready(task: Task | undefined, entry: PreparationEntry): boolean {
    return preparationStillApplies(task, entry) && task!.operation === null && task!.worktree?.status === 'ready';
  }

  private assertStillApplies(entry: PreparationEntry): void {
    if (!preparationStillApplies(this.ports.task(entry.taskId), entry)) throw preparationAbandoned();
  }

  private finish(taskId: string, wait: PendingWait, failure: Problem | undefined): void {
    if (this.waiters.get(taskId) !== wait) return;
    this.waiters.delete(taskId);
    if (failure === undefined) wait.resolve(); else wait.reject(failure);
  }
}
