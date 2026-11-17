import { NO_PREPARATION, type PreparationDecision, type PreparationRequest } from './contract.js';
import { executionPreparationPlan } from './gate.js';

export type PreparationPhase = 'closed' | 'worktree' | 'blocked';

/** The one question a first-execution preparation can ask. */
export interface PreparationState {
  readonly phase: PreparationPhase;
  readonly kind: 'move' | 'run';
  readonly taskId: string;
  readonly taskTitle: string;
  readonly stageName: string;
}

const CLOSED: PreparationState = Object.freeze({
  phase: 'closed' as const,
  kind: 'move' as const,
  taskId: '',
  taskTitle: '',
  stageName: '',
});

/**
 * Owns one first-execution preparation decision: the worktree question, or the
 * explanation of a worktree binding that is not ready. It never provisions and
 * never starts an agent; the move or run continues with the answer, and the
 * background work belongs to the preparation run.
 */
export class ExecutionPreparationController {
  private state: PreparationState = CLOSED;
  private readonly listeners = new Set<() => void>();
  private resolve: ((decision: PreparationDecision) => void) | null = null;

  getSnapshot = (): PreparationState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private set(state: PreparationState): void {
    this.state = state;
    this.publish();
  }

  /**
   * Present the preparation when the task's first execution needs it.
   * @returns the decision; a refused decision cancels the move or run.
   */
  async open(request: PreparationRequest): Promise<PreparationDecision> {
    const plan = executionPreparationPlan(request.task, request.project);
    if (plan === null) return NO_PREPARATION;
    // The project already settled its own choice, so there is nothing to ask.
    if (plan.worktree === 'create-default') return { proceed: true, worktree: 'create' };
    // Only a second preparation is refused; requests that need none never reach this point.
    if (this.resolve !== null) return { proceed: false, worktree: 'none' };
    const promise = new Promise<PreparationDecision>(resolve => { this.resolve = resolve; });
    this.set({
      phase: plan.worktree === 'blocked' ? 'blocked' : 'worktree',
      kind: request.kind,
      taskId: request.task.id,
      taskTitle: request.task.title,
      stageName: request.column.name,
    });
    return promise;
  }

  /** Answer the worktree question; the answer closes the preparation either way. */
  answerWorktree(create: boolean): void {
    if (this.state.phase !== 'worktree') return;
    this.settle({ proceed: true, worktree: create ? 'create' : 'base' });
  }

  /** Abandon the preparation without an answer. */
  cancel(): void {
    if (this.state.phase === 'closed') return;
    this.settle({ proceed: false, worktree: 'none' });
  }

  private settle(decision: PreparationDecision): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.state = CLOSED;
    this.publish();
    resolve?.(decision);
  }
}
