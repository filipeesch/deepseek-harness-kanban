import type { CreateWorktree, Problem, Project } from '../../shared/types.js';
import { asProblem } from '../problem.js';
import { cleanWorktree, validWorktree } from '../worktree-draft.js';
import type { PreparationRequest } from './contract.js';
import { executionPreparationPlan, type PreparationWorktree } from './gate.js';

/** Everything the controller needs from the host, the board, and the native seat. */
export interface PreparationPorts {
  defaults(taskId: string): Promise<{ branchName: string; path: string }>;
  createWorktree(taskId: string, draft: CreateWorktree): Promise<void>;
  dismissWorktree(taskId: string): Promise<void>;
  /** Creates the task's first conversation and returns its native session identity. */
  createConversation(taskId: string): Promise<string>;
  /** Resolves when the session is retained and its native scope exists. */
  retainSession(sessionId: string): Promise<void>;
  releaseSession(sessionId: string): void;
  seatAvailable(): boolean;
}

export type PreparationPhase = 'closed' | 'worktree' | 'blocked' | 'provisioning' | 'model' | 'error';

/** The step a retry resumes from; `defaults` keeps the worktree question open. */
export type PreparationFailedStep = 'defaults' | 'worktree' | 'conversation';

export interface PreparationState {
  readonly phase: PreparationPhase;
  readonly kind: 'move' | 'run';
  readonly taskId: string;
  readonly taskTitle: string;
  readonly stageName: string;
  readonly worktree: PreparationWorktree;
  readonly model: boolean;
  readonly draft: CreateWorktree | null;
  readonly destinationMissing: boolean;
  readonly sessionId: string | null;
  readonly pending: boolean;
  readonly error: Problem | null;
  readonly failedStep: PreparationFailedStep | null;
}

const CLOSED: PreparationState = Object.freeze({
  phase: 'closed' as const,
  kind: 'move' as const,
  taskId: '',
  taskTitle: '',
  stageName: '',
  worktree: 'none' as const,
  model: false,
  draft: null,
  destinationMissing: true,
  sessionId: null,
  pending: false,
  error: null,
  failedStep: null,
});

type WorktreeAnswer = 'create' | 'base' | 'none';

/**
 * Owns one first-execution preparation: the worktree question, provisioning,
 * the native model stage, and the single proceed/cancel promise the move
 * pipeline awaits. It never retries on its own and never starts an agent.
 */
export class ExecutionPreparationController {
  private state: PreparationState = CLOSED;
  private readonly listeners = new Set<() => void>();
  private ports: PreparationPorts | null = null;
  private request: PreparationRequest | null = null;
  private project: Project | undefined;
  private plan: { worktree: PreparationWorktree; model: boolean } | null = null;
  private answer: WorktreeAnswer = 'none';
  private worktreeResolved = false;
  private sessionId: string | null = null;
  private resolve: ((proceed: boolean) => void) | null = null;
  /** Invalidates async continuations after the user closed the dialog. */
  private generation = 0;

  configure(ports: PreparationPorts): void {
    this.ports = ports;
  }

  getSnapshot = (): PreparationState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private set(patch: Partial<PreparationState>): void {
    this.state = { ...this.state, ...patch };
    this.publish();
  }

  /**
   * Present the preparation when the task's first execution needs it.
   * @returns true when the caller may proceed, false when the user cancelled.
   */
  async open(request: PreparationRequest): Promise<boolean> {
    const plan = executionPreparationPlan(request.task, request.project, this.ports?.seatAvailable() === true);
    if (plan === null) return true;
    // Only a second preparation is refused; requests that need none never reach this point.
    if (this.resolve !== null) return false;
    const ports = this.ports;
    if (ports === null) return true;
    this.request = request;
    this.project = request.project;
    this.plan = plan;
    this.answer = 'none';
    this.worktreeResolved = false;
    this.sessionId = null;
    this.generation += 1;
    const promise = new Promise<boolean>(resolve => { this.resolve = resolve; });
    this.state = {
      ...CLOSED,
      kind: request.kind,
      taskId: request.task.id,
      taskTitle: request.task.title,
      stageName: request.column.name,
      worktree: plan.worktree,
      model: plan.model,
      phase: plan.worktree === 'blocked' ? 'blocked' : plan.worktree === 'ask' ? 'worktree' : 'provisioning',
    };
    this.publish();
    if (plan.worktree === 'ask') {
      this.set({ pending: true });
      void this.loadDefaults();
    } else if (plan.worktree === 'blocked') {
      // The dialog only explains the unresolved binding; nothing is provisioned.
    } else {
      void this.provision('none');
    }
    return promise;
  }

  /**
   * Answer the worktree question and start provisioning. Continuing in the base
   * project does not need the derived defaults, so it is accepted while they load.
   */
  answerWorktree(create: boolean): void {
    if (this.state.phase !== 'worktree') return;
    if (create && (this.state.pending || !this.draftIsValid())) return;
    this.answer = create ? 'create' : 'base';
    void this.provision(this.answer);
  }

  /** Confirm the model stage and let the move or run action proceed. */
  confirmModel(): void {
    if (this.state.phase !== 'model' || this.state.pending) return;
    this.settle(true);
  }

  /** Abandon the preparation; provisioning commands are never interrupted. */
  cancel(): void {
    if (this.state.phase === 'provisioning') return;
    this.settle(false);
  }

  /** Resume the failed step without retrying the steps that already completed. */
  retry(): void {
    if (this.state.pending) return;
    if (this.state.failedStep === 'defaults') {
      this.set({ error: null, failedStep: null, pending: true });
      void this.loadDefaults();
      return;
    }
    if (this.state.phase !== 'error') return;
    void this.provision(this.answer);
  }

  private draftIsValid(): boolean {
    return this.state.draft !== null && validWorktree(this.state.draft);
  }

  private async loadDefaults(): Promise<void> {
    const request = this.request;
    if (request === null || this.ports === null) return;
    const generation = this.generation;
    try {
      const defaults = await this.ports.defaults(request.task.id);
      if (generation !== this.generation) return;
      const draft: CreateWorktree = { mode: 'new', branchName: defaults.branchName, path: defaults.path, sourceBranch: this.project?.defaultBranch ?? '' };
      this.set({ pending: false, draft, destinationMissing: !validWorktree(draft), error: null, failedStep: null });
    } catch (failure) {
      if (generation !== this.generation) return;
      this.set({ pending: false, draft: null, destinationMissing: true, error: asProblem(failure), failedStep: 'defaults' });
    }
  }

  private async provision(answer: WorktreeAnswer): Promise<void> {
    const request = this.request;
    const ports = this.ports;
    if (request === null || ports === null) { this.settle(false); return; }
    // Invalidate an in-flight defaults read that the answer just made unnecessary.
    this.generation += 1;
    const generation = this.generation;
    this.set({ phase: 'provisioning', pending: true, error: null, failedStep: null });
    if (!this.worktreeResolved) {
      try {
        if (answer === 'create') {
          const draft = this.state.draft;
          if (draft === null || !validWorktree(draft)) { this.fail({ code: 'WORKTREE_DESTINATION_REQUIRED', message: 'Configure a worktree destination before creating a worktree.' }, 'worktree'); return; }
          await ports.createWorktree(request.task.id, cleanWorktree(draft));
          if (generation !== this.generation) return;
          this.worktreeResolved = true;
        } else if (answer === 'base') {
          await ports.dismissWorktree(request.task.id);
          if (generation !== this.generation) return;
          this.worktreeResolved = true;
        }
      } catch (failure) {
        if (generation !== this.generation) return;
        this.fail(failure, 'worktree');
        return;
      }
    }
    if (this.sessionId === null) {
      try {
        const created = await ports.createConversation(request.task.id);
        if (generation !== this.generation) return;
        this.sessionId = created;
        this.set({ sessionId: created });
      } catch (failure) {
        if (generation !== this.generation) return;
        this.fail(failure, 'conversation');
        return;
      }
    }
    this.set({ pending: false });
    if (this.plan?.model === true && ports.seatAvailable()) {
      try {
        await ports.retainSession(this.sessionId);
        if (generation !== this.generation) return;
        this.set({ phase: 'model', pending: false, error: null });
        return;
      } catch {
        // A native seat that cannot be retained must not block the execution.
      }
    }
    this.settle(true);
  }

  private fail(failure: unknown, step: PreparationFailedStep): void {
    this.set({ phase: 'error', pending: false, error: asProblem(failure), failedStep: step });
  }

  private settle(proceed: boolean): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.generation += 1;
    if (this.sessionId !== null) {
      try { this.ports?.releaseSession(this.sessionId); } catch { /* the lease may already be gone */ }
    }
    this.sessionId = null;
    this.request = null;
    this.plan = null;
    this.answer = 'none';
    this.worktreeResolved = false;
    this.state = CLOSED;
    this.publish();
    resolve?.(proceed);
  }
}
