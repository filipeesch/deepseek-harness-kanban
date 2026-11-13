import { randomUUID } from 'node:crypto';
import { KanbanError, problem } from '../shared/errors.js';
import type { GitPort, GitRepository, GitTree, SessionPort } from '../shared/ports.js';
import type { CheckoutObservation, ContextOperation, CreateWorktreeInput, GitProject, HubState, OperationRequest, Project, RetainedCheckoutReason, Task, WorktreeDefaults } from '../shared/types.js';
import { canonicalPath } from './git.js';
import { isGitProject, requireGitProject } from '../shared/project.js';
import { WorktreeSharingGuard } from './worktree-sharing.js';
import { DestructiveExecution, type DestructiveOperationHost } from './destructive-operation.js';
import { DestructiveAdmission } from './destructive-admission.js';
import { OperationQueue } from './operation-queue.js';
import { OperationJournal, ProgressJournal, recoveryPendingError, requireTask } from './operation-journal.js';
import { blocksCreate } from './worktree-checkout-state.js';
import { ConversationProbe } from './conversation-probe.js';
import { TaskBindingIndex } from './task-binding-index.js';
import type { OperationPass } from './destructive-operation.js';
import type { WorktreeBinding } from './hub-repository.js';
import { replaceableByDeletion } from '../shared/context-operation.js';
import { recordSettledOperation } from './worktree-history.js';
import { CreateAttempt, unverifiedAttempt } from './worktree-create-attempt.js';
import { CheckoutStateProbe } from './worktree-checkout-state.js';
import { CreateRecovery, type CreateRoute } from './worktree-create-recovery.js';
import { CreateFailureClassifier } from './worktree-create-failure.js';

export interface WorktreeStore {
  locate(taskId: string): { hubId: string; hub: HubState; task: Task; project: Project };
  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T>;
  /** The lightweight binding projection every destructive decision reads. */
  worktreeBindings(): readonly WorktreeBinding[];
  /** Whether any task holds a context operation; the resume path avoids cloning Hubs when it is false. */
  hasOperations?(): boolean;
  /** The configured worktree base path; a discard never removes it or anything above it. */
  worktreeBasePath?(): string | undefined;
}
/** A creation request as a caller may state it; the coordinator derives any omitted default. */
export type WorktreeRequest = OperationRequest | ({ kind: 'create' } & CreateWorktreeInput);
/** Derives the collision-free title defaults creation uses when the request omits them. */
export interface WorktreeDefaultsPort { derive(taskId: string): Promise<WorktreeDefaults> }
export interface WorktreeCoordinatorOptions { signal?: AbortSignal; id?: () => string; now?: () => string; index?: TaskBindingIndex; worktreeDefaults?: WorktreeDefaultsPort; onTaskDeleted?: (task: Task, project: Project) => Promise<void>; onCheckoutRetained?: (task: Task, project: Project, path: string, reason: RetainedCheckoutReason) => void; sharing?: WorktreeSharingGuard; /** Shared with project relocation so both serialize on one per-repository lane. */ queue?: OperationQueue }

function requireProject(state: HubState, id: string): Project {
  const project = state.projects.find(item => item.id === id);
  if (!project) throw new KanbanError('PROJECT_NOT_FOUND', 'The task project does not exist.', { projectId: id });
  return project;
}
/** Event-driven, journaled coordination; waiting operations never poll or hold a user request open. */
export class WorktreeCoordinator {
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private readonly id: () => string;
  private readonly now: () => string;
  private readonly onTaskDeleted?: (task: Task, project: Project) => Promise<void>;
  private readonly sharing: WorktreeSharingGuard;
  private readonly journal: OperationJournal;
  private readonly progress: ProgressJournal;
  private readonly worktreeDefaults: WorktreeDefaultsPort | undefined;
  private readonly index: TaskBindingIndex;
  private readonly admission: DestructiveAdmission;
  private readonly destructive: DestructiveExecution;
  private readonly queue: OperationQueue;
  private readonly ownsQueue: boolean;
  private readonly checkout: CheckoutStateProbe;
  private readonly recovery: CreateRecovery;
  private readonly failureClassifier = new CreateFailureClassifier();
  /** One abort controller per running pass, so a cancel targets exactly one operation. */
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelled = new Set<string>();
  private readonly tails = new Map<string, Promise<void>>();
  private resumed: Promise<void> | undefined;
  private resumeAgain = false;
  private disposed = false;

  constructor(private readonly store: WorktreeStore, private readonly sessions: SessionPort, private readonly git: GitPort, options: WorktreeCoordinatorOptions = {}) {
    this.signal = options.signal ? AbortSignal.any([this.controller.signal, options.signal]) : this.controller.signal;
    this.queue = options.queue ?? new OperationQueue();
    this.ownsQueue = options.queue === undefined;
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onTaskDeleted = options.onTaskDeleted;
    this.index = options.index ?? new TaskBindingIndex(store);
    this.worktreeDefaults = options.worktreeDefaults;
    this.sharing = options.sharing ?? new WorktreeSharingGuard(store, sessions, this.index);
    this.journal = new OperationJournal(store, this.now);
    this.progress = new ProgressJournal(this.journal);
    this.admission = new DestructiveAdmission({ locate: taskId => this.read(taskId) }, this.journal);
    this.checkout = new CheckoutStateProbe(this.now);
    this.recovery = new CreateRecovery({
      git: this.git,
      checkout: this.checkout,
      basePath: () => this.store.worktreeBasePath?.(),
    });
    this.destructive = new DestructiveExecution(store, sessions, git, this.destructiveHost(), this.journal, { now: this.now, sharing: this.sharing, index: this.index, ...(options.onTaskDeleted ? { onTaskDeleted: options.onTaskDeleted } : {}), ...(options.onCheckoutRetained ? { onCheckoutRetained: options.onCheckoutRetained } : {}) });
  }

  private destructiveHost(): DestructiveOperationHost {
    return {
      read: taskId => this.read(taskId),
      assertOpen: () => this.assertOpen(),
      assertTaskOpen: taskId => this.assertTaskOpen(taskId),
      sourceUnchanged: (taskId, expected) => this.sourceUnchanged(taskId, expected),
    };
  }

  dispose(): void { this.disposed = true; if (this.ownsQueue) this.queue.dispose(); this.controller.abort(); }

  async settle(): Promise<void> {
    for (;;) {
      await this.resumed;
      await this.queue.settle();
      await Promise.all([...this.tails.values()]);
      if (!this.resumed && this.queue.size === 0 && this.tails.size === 0) return;
    }
  }

  async close(): Promise<void> { this.dispose(); await this.settle(); }

  private assertOpen(): void {
    if (this.disposed) throw new KanbanError('COORDINATOR_DISPOSED', 'The worktree coordinator is disposed.');
    if (this.signal.aborted) throw new KanbanError('OPERATION_ABORTED', 'The worktree operation was interrupted.');
  }

  /** A cancel aborts one operation, so it stops at the next boundary as well as in a running command. */
  private assertTaskOpen(taskId: string): void {
    this.assertOpen();
    if (this.cancelled.has(taskId)) throw new KanbanError('OPERATION_CANCELLED', 'The Git operation was cancelled.');
  }

  private serial<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(taskId) ?? Promise.resolve();
    const result = previous.then(action);
    const tail = result.then(() => {}, () => {});
    this.tails.set(taskId, tail);
    void tail.then(() => { if (this.tails.get(taskId) === tail) this.tails.delete(taskId); });
    return result;
  }

  private read(taskId: string): { task: Task; project: Project; hub: HubState } {
    const located = this.store.locate(taskId);
    return { task: located.task, project: located.project, hub: located.hub };
  }

  private async update(taskId: string, operationId: string, change: (task: Task, operation: ContextOperation) => void): Promise<void> {
    await this.journal.update(taskId, operationId, change);
  }

  private sameRequest(a: OperationRequest, b: OperationRequest): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'create' && b.kind === 'create') return a.path === b.path && a.branchName === b.branchName && a.mode === b.mode && a.sourceBranch === b.sourceBranch;
    if (a.kind === 'attach' && b.kind === 'attach') return a.path === b.path;
    return true;
  }

  async request(taskId: string, input: WorktreeRequest, options: { background?: boolean } = {}): Promise<HubState> {
    if (input.kind === 'return') return this.returnToBase(taskId);
    const current = this.read(taskId);
    if (!isGitProject(current.project) && input.kind !== 'delete') {
      throw new KanbanError('PROJECT_NOT_GIT', 'This project is not a Git repository; Git and worktree actions are unavailable.', { projectId: current.project.id });
    }
    const before = current.hub;
    return this.serial(taskId, async () => {
      this.assertOpen();
      this.cancelled.delete(taskId);
      // Creation may state only what the user chose; everything else is derived once,
      // at the moment it runs, against the repository as it is now.
      const request: OperationRequest = input.kind === 'create' ? await this.createRequest(taskId, input) : input;
      if (!['create', 'attach', 'remove', 'delete'].includes(request.kind)) throw new KanbanError('INVALID_OPERATION', 'Unsupported worktree operation.');
      if ((request.kind === 'remove' || request.kind === 'delete') && typeof request.discardChanges !== 'boolean') throw new KanbanError('INVALID_OPERATION', 'Explicit discard consent must be a boolean.');
      const normalized = structuredClone(request);
      if (normalized.kind === 'create' || normalized.kind === 'attach') normalized.path = await canonicalPath(normalized.path, true);
      const { task } = this.read(taskId);
      this.confirmationMatches(task, normalized);
      if (task.operation && normalized.kind === 'delete' && !this.sameRequest(task.operation.request, normalized) && replaceableByDeletion(task.operation)) {
        // The deletion replaces an abandoned failed journal; it owns the checkout binding
        // and will retain anything it cannot verify.
        await this.start(taskId, normalized);
      } else if (task.operation) {
        if (!this.sameRequest(task.operation.request, normalized)) throw new KanbanError('OPERATION_PENDING', 'Resolve the existing operation before starting a different operation.', { kind: task.operation.request.kind });
        this.recordedTargetMatches(task.operation, normalized);
        await this.update(taskId, task.operation.id, (_task, operation) => {
          if ((operation.request.kind === 'remove' || operation.request.kind === 'delete') && (normalized.kind === 'remove' || normalized.kind === 'delete')) { operation.request.discardChanges ||= normalized.discardChanges; if (normalized.force === true) operation.request.force = true; }
          // Preserve the journal and previous failure stage for safe retry/recovery.
          if (operation.phase === 'failed') operation.phase = 'waiting';
        });
      } else {
        if (task.worktree && (normalized.kind === 'create' || (normalized.kind === 'attach' && task.worktree.path !== normalized.path))) throw new KanbanError('WORKTREE_ALREADY_BOUND', 'Remove or recover the current worktree before choosing another target.');
        await this.start(taskId, normalized);
      }
      if ((normalized.kind === 'delete' || normalized.kind === 'remove') && options.background === true) {
        await this.admitAndQueue(taskId);
      } else {
        // Reusing a leftover branch is a retry behavior: a fresh request never
        // silently adopts a branch the user already had.
        await this.drive(taskId, { allowBranchReuse: task.operation !== null });
      }
      return this.hubAfter(taskId, before);
    });
  }

  /** Normalize one creation request, deriving the collision-free title defaults it omits. */
  private async createRequest(taskId: string, request: { kind: 'create' } & CreateWorktreeInput): Promise<Extract<OperationRequest, { kind: 'create' }>> {
    const sourceBranch = request.sourceBranch;
    if (request.path !== undefined && request.branchName !== undefined) {
      return { kind: 'create', mode: request.mode, path: request.path, branchName: request.branchName, ...(sourceBranch === undefined ? {} : { sourceBranch }) };
    }
    if (request.mode !== 'new') throw new KanbanError('INVALID_INPUT', 'Existing-branch creation requires a branch name and a destination.');
    const defaults = this.worktreeDefaults;
    if (!defaults) throw new KanbanError('INVALID_INPUT', 'A branch name and a destination are required to create this worktree.');
    const derived = await defaults.derive(taskId);
    if (derived.kind === 'unavailable') throw new KanbanError(derived.reason.code, derived.reason.message, derived.reason.details);
    const source = sourceBranch ?? derived.sourceBranch;
    return { kind: 'create', mode: 'new', path: request.path ?? derived.path, branchName: request.branchName ?? derived.branchName, ...(source === undefined ? {} : { sourceBranch: source }) };
  }

  private hubAfter(taskId: string, fallback: HubState): HubState { try { return this.store.locate(taskId).hub; } catch { return fallback; } }

  async retry(taskId: string, options: { background?: boolean } = {}): Promise<HubState> {
    const before = this.read(taskId).hub;
    return this.serial(taskId, async () => {
      this.assertOpen();
      this.cancelled.delete(taskId);
      const { task } = this.read(taskId);
      if (!task.operation) throw new KanbanError('NO_OPERATION', 'There is no operation to retry.');
      const destructive = task.operation.request.kind === 'delete' || task.operation.request.kind === 'remove';
      const previousPhase = task.operation.phase;
      await this.update(taskId, task.operation.id, (_task, operation) => { if (operation.phase === 'failed') operation.phase = 'waiting'; });
      if (destructive && options.background === true) {
        try { await this.admitAndQueue(taskId); }
        catch (error) {
          // Keep the previous failure visible when retry could not even be admitted.
          if (previousPhase === 'failed') await this.update(taskId, task.operation.id, (_task, operation) => { operation.phase = 'failed'; });
          throw error;
        }
      }
      else await this.drive(taskId, { allowBranchReuse: true });
      return this.hubAfter(taskId, before);
    });
  }

  /**
   * Abort exactly one running operation. The command path calls this outside the
   * serial lane so it can interrupt a pass that is still awaiting Git.
   */
  async cancel(taskId: string): Promise<HubState> {
    const before = this.read(taskId).hub;
    const { task } = this.read(taskId);
    if (!task.operation) throw new KanbanError('NO_OPERATION', 'There is no operation to cancel.');
    // A cancel is meaningful only while a pass holds the controller. Refusing an
    // idle task keeps a late request from poisoning the next recovery action.
    const controller = this.controllers.get(taskId);
    if (controller === undefined) throw new KanbanError('NO_RUNNING_OPERATION', 'No Git command is running for this task.');
    this.cancelled.add(taskId);
    controller.abort();
    return this.hubAfter(taskId, before);
  }

  /**
   * The one accepted recovery for an incomplete checkout: discard what the failed
   * attempt left, then retry the same creation. The confirmation is the caller's
   * contract, so an unconfirmed request is refused before anything is touched.
   */
  async discardCreate(taskId: string, confirmed: boolean): Promise<HubState> {
    const before = this.read(taskId).hub;
    return this.serial(taskId, async () => {
      this.assertOpen();
      if (!confirmed) throw new KanbanError('CONFIRMATION_REQUIRED', 'Confirm discarding the incomplete checkout and retrying the creation.');
      this.cancelled.delete(taskId);
      const current = this.read(taskId);
      const operation = current.task.operation;
      if (!operation || operation.request.kind !== 'create') throw new KanbanError('NO_OPERATION', 'There is no creation to discard.');
      const attempt = CreateAttempt.of(operation);
      if (!attempt) throw new KanbanError('CREATE_ATTEMPT_REQUIRED', 'The creation has no recorded attempt to discard.');
      const project = requireGitProject(current.project);
      await attempt.assertVerified(project);
      const repository = await this.git.resolve(project, current.task.sessionIds, this.signal);
      await this.recovery.discard({ attempt, project, repository, sessionIds: current.task.sessionIds });
      await this.update(taskId, operation.id, (_task, draft) => {
        delete draft.createAttempt;
        delete draft.error;
        draft.phase = 'waiting';
      });
      await this.drive(taskId, { allowBranchReuse: true });
      return this.hubAfter(taskId, before);
    });
  }

  /**
   * Admit the recorded destructive operation from persisted state only, then hand
   * execution to its repository lane. The authoritative preflight runs there, so
   * admission never inspects Git, native conversations, or the filesystem.
   */
  private async admitAndQueue(taskId: string): Promise<void> {
    const operationId = this.read(taskId).task.operation?.id;
    try {
      const job = await this.admission.prepare(taskId);
      this.enqueue(job.lane, job.taskId, job.operationId);
    } catch (error) {
      // A rejected admission must not leave the journal in 'waiting': that phase
      // hides the recovery actions and blocks every other context operation.
      if (operationId !== undefined) await this.recordAdmissionFailure(taskId, operationId, error);
      throw error;
    }
  }

  private async recordAdmissionFailure(taskId: string, operationId: string, error: unknown): Promise<void> {
    // A rejected admission settles the operation as failed, so it leaves the same
    // outcome the execution path leaves; only the phase that produced it differs.
    const failedAt = this.now();
    try {
      await this.update(taskId, operationId, (task, operation) => {
        const failure = problem(error);
        operation.error = { ...failure, details: { ...failure.details, failedPhase: operation.phase } };
        operation.phase = 'failed';
        recordSettledOperation(task, operation, failedAt, failure);
      });
    } catch { /* the operation was replaced or the task is gone */ }
  }

  /** A new confirmation may not silently substitute the target of a recorded operation. */
  private recordedTargetMatches(operation: ContextOperation, request: OperationRequest): void {
    if (request.kind !== 'delete' && request.kind !== 'remove') return;
    const recordedRequest = operation.request;
    if (recordedRequest.kind !== 'delete' && recordedRequest.kind !== 'remove') return;
    const recorded = recordedRequest.expectedWorktreePath;
    if (recorded === undefined || request.expectedWorktreePath === undefined) return;
    if (recorded === request.expectedWorktreePath) return;
    throw new KanbanError('OPERATION_TARGET_CHANGED', 'The recorded deletion target no longer matches this confirmation; resolve the existing operation before confirming the new binding.', { recordedTargetPath: recorded, confirmedTargetPath: request.expectedWorktreePath });
  }

  private enqueue(lane: string, ownerId: string, operationId: string): void {
    this.queue.enqueue({ lane, ownerId, operationId, run: () => this.serial(ownerId, async () => { await this.drive(ownerId); }).then(() => {}) });
  }

  async returnToBase(taskId: string): Promise<HubState> {
    const before = this.read(taskId).hub;
    return this.serial(taskId, async () => {
      this.assertOpen();
      this.cancelled.delete(taskId);
      const { task, project } = this.read(taskId);
      const gitProject = requireGitProject(project);
      // Resolve the base before replacing the journal: a return must never discard a
      // failed operation when its target directory cannot be reached.
      try { await this.git.projectDirectory(gitProject); }
      catch (error) {
        if (error instanceof KanbanError && (error.code === 'PATH_UNAVAILABLE' || error.code === 'INVALID_PATH')) {
          throw new KanbanError('PROJECT_PATH_UNAVAILABLE', 'The project directory cannot be resolved. Delete the task or relocate the project before returning its conversations.', { path: project.projectPath, cause: error.code });
        }
        throw error;
      }
      const old = task.operation;
      if (old?.request.kind === 'delete' && (old.archivedSessionIds.length > 0 || old.phase === 'archiving' || old.error?.details?.failedPhase === 'archiving')) throw new KanbanError('DELETE_IN_PROGRESS', 'Retry the partially completed deletion; archived native conversations cannot be silently restored.');
      // A Git create may have succeeded immediately before a persistence failure.
      // An explicit return can abandon an unverifiable ref, never claim or delete it.
      if (old?.request.kind === 'create') await this.releaseCreateAttempt(taskId, old, gitProject);
      await this.start(taskId, { kind: 'return' });
      await this.drive(taskId);
      return this.hubAfter(taskId, before);
    });
  }

  /**
   * Settle what a failed creation left before the task returns to its base. Nothing
   * on disk is claimed: a registered checkout is adopted when it proves the attempt,
   * anything else is retained as a diagnostic, and an attempt with no remaining
   * effect is released so Return itself stays available.
   */
  private async releaseCreateAttempt(taskId: string, operation: ContextOperation, project: GitProject): Promise<void> {
    const request = operation.request;
    if (request.kind !== 'create') return;
    const attempt = CreateAttempt.of(operation);
    if (attempt === undefined) return;
    await attempt.assertVerified(project);
    const repository = await this.git.resolve(project, this.read(taskId).task.sessionIds, this.signal);
    const state = await this.recovery.observe(attempt, repository);
    if (state.directory === 'absent') {
      if (state.registration === 'orphan') await this.git.clearRegistration(project, attempt.path, this.read(taskId).task.sessionIds, repository);
      return;
    }
    if (state.registration === 'registered') {
      const { task } = this.read(taskId);
      const tree = await this.git.inspect(project, attempt.path, task.sessionIds, repository);
      if (tree.path !== attempt.path || await canonicalPath(tree.path) !== attempt.path) throw new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'The checkout no longer matches the canonical create target.');
      const boundPath = task.worktree?.path;
      const sameBinding = !!boundPath && await canonicalPath(boundPath, true) === tree.path;
      const verifiedBranch = tree.branch !== 'HEAD' && tree.branch === request.branchName;
      if (verifiedBranch && (!task.worktree || sameBinding)) {
        if (!task.worktree) await this.update(taskId, operation.id, draft => { draft.worktree = { path: tree.path, branch: tree.branch, owned: true, status: 'error' }; });
        return;
      }
      await this.recordUnclaimed(taskId, operation, task, { path: tree.path, branch: tree.branch, error: { code: 'UNCLAIMED_WORKTREE', message: 'Returned to base without claiming or removing this checkout. Choose explicit attach to use it.', details: { expectedBranch: request.branchName, actualBranch: tree.branch, reason: verifiedBranch ? 'known-binding-preserved' : tree.branch === 'HEAD' ? 'detached-head' : 'branch-mismatch' } } });
      return;
    }
    // A destination that Git does not register cannot be claimed or attached; it is
    // kept on disk and reported so the discard stays an explicit decision.
    const { task } = this.read(taskId);
    await this.recordUnclaimed(taskId, operation, task, { path: attempt.path, branch: attempt.branchName, error: { code: 'CREATE_CHECKOUT_INCOMPLETE', message: 'Returned to base without claiming this incomplete checkout. Discard it from the operation status before creating another.', details: { expectedBranch: attempt.branchName, directory: state.directory, registration: state.registration } } });
  }

  private async recordUnclaimed(taskId: string, operation: ContextOperation, task: Task, record: { path: string; branch: string; error: { code: string; message: string; details?: Record<string, unknown> } }): Promise<void> {
    const aliases = new Set([record.path]);
    for (const entry of task.unclaimedWorktrees ?? []) {
      try { if (await canonicalPath(entry.path, true) === record.path) aliases.add(entry.path); } catch { /* Keep inaccessible diagnostics rather than dropping them. */ }
    }
    await this.update(taskId, operation.id, draft => {
      if (draft.worktree?.path !== undefined && aliases.has(draft.worktree.path)) draft.worktree = null;
      draft.unclaimedWorktrees = [...(draft.unclaimedWorktrees ?? []).filter(entry => !aliases.has(entry.path)), { path: record.path, branch: record.branch, error: record.error }];
    });
  }

  /** Called at startup and by the parent's native activity events, never by a timer. */
  resumePending(): Promise<void> {
    if (this.disposed || this.signal.aborted) return Promise.resolve();
    // The activity timer calls this on every attention edge; without an operation
    // there is nothing to resume and materializing every task would clone each Hub.
    if (this.store.hasOperations?.() === false) return Promise.resolve();
    if (this.resumed) { this.resumeAgain = true; return this.resumed; }
    this.resumed = (async () => {
      do {
        this.resumeAgain = false;
        const pending = this.store.worktreeBindings().filter(binding => binding.operation && binding.operation.phase !== 'failed');
        // Each failure remains on its own task; one failing task must not starve others.
        const destructive = pending.filter(binding => binding.operation!.kind === 'delete' || binding.operation!.kind === 'remove').sort((left, right) => left.operation!.createdAt.localeCompare(right.operation!.createdAt));
        const rest = pending.filter(binding => !destructive.includes(binding));
        for (const binding of destructive) this.enqueue(binding.lane, binding.taskId, binding.operation!.id);
        await Promise.all(rest.map(binding => this.serial(binding.taskId, () => this.drive(binding.taskId, { allowBranchReuse: true }).catch(() => {}))));
      } while (this.resumeAgain && !this.disposed && !this.signal.aborted);
    })().finally(() => {
      this.resumed = undefined;
      // Preserve an activity event that arrived between the last pass and finalization.
      if (this.resumeAgain && !this.disposed && !this.signal.aborted) { this.resumeAgain = false; void this.resumePending(); }
    });
    return this.resumed;
  }

  /** Compare the confirmed target with the persisted binding; canonicalization belongs to the lane preflight. */
  private confirmationMatches(task: Task, request: OperationRequest): void {
    if ((request.kind !== 'remove' && request.kind !== 'delete') || request.expectedWorktreePath === undefined) return;
    const actual = task.worktree?.path ?? null;
    if (request.expectedWorktreePath !== actual) throw new KanbanError('WORKTREE_CHANGED', 'The worktree changed since confirmation; review the current target before continuing.', { expectedWorktreePath: request.expectedWorktreePath, actualWorktreePath: actual });
  }

  private async start(taskId: string, request: OperationRequest): Promise<void> {
    const prior = this.read(taskId).task;
    const destructive = request.kind === 'remove' || request.kind === 'delete';
    const rawTarget = request.kind === 'create' || request.kind === 'attach' ? request.path : prior.worktree?.path;
    // Destructive admission records the persisted binding only; its canonical
    // target is resolved by the queued preflight before anything is removed.
    const targetPath = destructive ? rawTarget : rawTarget ? await canonicalPath(rawTarget, true) : undefined;
    if ((request.kind === 'remove' || request.kind === 'delete') && request.expectedWorktreePath !== undefined && request.expectedWorktreePath !== (targetPath ?? null)) throw new KanbanError('WORKTREE_CHANGED', 'The worktree changed before the confirmed operation could be recorded.');
    await this.store.transactTask(taskId, state => {
      const task = requireTask(state, taskId);
      if (task.projectId !== prior.projectId || task.worktree?.path !== prior.worktree?.path) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The task context changed before the operation was recorded.');
      task.operation = {
        id: this.id(), request: structuredClone(request), phase: 'waiting',
        targetPath,
        previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: this.now(),
      };
      task.updatedAt = this.now();
    });
  }

  /** The pass-scoped idleness gate; records waiting so a busy conversation defers the work. */
  private async passIdle(taskId: string, operationId: string, pass: OperationPass): Promise<boolean> {
    this.assertTaskOpen(taskId);
    const { task } = this.read(taskId);
    const idle = await pass.probe.allIdle(task.sessionIds);
    if (!idle) await this.wait(taskId, operationId);
    return idle;
  }

  /** Keep the progress already accumulated, then record the wait. */
  private async deferToWaiting(taskId: string, operationId: string): Promise<false> {
    await this.progress.flush(taskId, operationId);
    await this.wait(taskId, operationId);
    return false;
  }

  private async wait(taskId: string, operationId: string): Promise<void> {
    await this.update(taskId, operationId, (_task, operation) => {
      const pending = recoveryPendingError(operation);
      if (pending !== undefined) operation.error = pending;
      operation.phase = 'waiting';
    });
  }

  private assertRecoveredBranch(request: Extract<OperationRequest, { kind: 'create' }>, tree: GitTree): void {
    if (tree.branch === 'HEAD' || tree.branch !== request.branchName || tree.path !== request.path) throw new KanbanError('RECOVERY_TARGET_MISMATCH', 'The recovered checkout does not match the requested branch.', { path: tree.path, branch: tree.branch });
  }

  private sourceUnchanged(taskId: string, expected: Project): void {
    const { project } = this.read(taskId);
    if (project.id !== expected.id || project.projectPath !== expected.projectPath || project.gitRootPath !== expected.gitRootPath) throw new KanbanError('PROJECT_CONTEXT_CHANGED', 'The project paths changed during the operation.');
  }

  private async switchDirectories(taskId: string, operationId: string, target: string, write: boolean, project: GitProject, probe: ConversationProbe, signal: AbortSignal): Promise<boolean> {
    const { task } = this.read(taskId);
    await this.git.assertPolicy(project, [target], task.sessionIds, write);
    await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'switching'; operation.targetDirectory = target; });
    // Every participant must be idle before the first conversation moves; the create
    // that ran earlier in this pass is not a verdict this step may reuse.
    if (!await probe.allIdle(task.sessionIds)) return this.deferToWaiting(taskId, operationId);
    let moved = false;
    for (const id of task.sessionIds) {
      const current = await this.sessions.directory(id);
      this.progress.accumulate(taskId, operationId, (_task, operation) => { operation.previousDirectories[id] ??= current; });
      if (await canonicalPath(current, true) !== target) {
        await this.git.assertPolicy(project, [target], [id], write);
        // The gate above covers the first move. After a conversation has moved, only
        // this one is re-asked, so a later wake still stops before it moves.
        if (moved && !await probe.allIdle([id])) return this.deferToWaiting(taskId, operationId);
        this.assertTaskOpen(taskId);
        this.sourceUnchanged(taskId, project);
        await this.sessions.setDirectory(id, target, signal);
        moved = true;
      }
      this.progress.accumulate(taskId, operationId, (_task, operation) => { if (!operation.switchedSessionIds.includes(id)) operation.switchedSessionIds.push(id); });
    }
    await this.progress.flush(taskId, operationId);
    const participants = this.read(taskId).task.sessionIds;
    if (participants.length !== task.sessionIds.length || participants.some(id => !task.sessionIds.includes(id))) throw new KanbanError('CONTEXT_DIVERGED', 'Task conversations changed during migration.');
    for (const id of task.sessionIds) {
      if (await canonicalPath(await this.sessions.directory(id), true) !== target) throw new KanbanError('CONTEXT_DIVERGED', 'A conversation directory changed during migration; retry or return to base.', { sessionId: id });
    }
    this.sourceUnchanged(taskId, project);
    await this.update(taskId, operationId, draft => {
      this.sourceUnchanged(taskId, project);
      if (draft.sessionIds.length !== task.sessionIds.length || draft.sessionIds.some(id => !task.sessionIds.includes(id))) throw new KanbanError('CONTEXT_DIVERGED', 'Task conversations changed before context publication.');
      draft.effectiveCwd = target;
    });
    return true;
  }

  /** One execution pass over the task: its probe, its directory switch, its repository facts. */
  private pass(signal: AbortSignal): OperationPass {
    const probe = new ConversationProbe(this.sessions);
    return {
      probe,
      signal,
      switchDirectories: (taskId, operationId, target, write, project) => this.switchDirectories(taskId, operationId, target, write, project, probe, signal),
      repository: (project, sessionIds) => this.git.resolve(project, sessionIds, signal),
    };
  }

  /** Record what the destination looked like, so the panel and the recovery read one fact. */
  private async observeAttempt(taskId: string, operationId: string, state: CheckoutObservation): Promise<void> {
    try {
      await this.update(taskId, operationId, (_task, operation) => {
        if (operation.createAttempt === undefined) return;
        operation.createAttempt = { ...operation.createAttempt, observed: state };
      });
    } catch { /* the operation was replaced or the task is gone */ }
  }

  private async drive(taskId: string, options: { allowBranchReuse?: boolean } = {}): Promise<'waiting' | 'done'> {
    const initial = this.read(taskId);
    const op = initial.task.operation;
    if (!op) return 'done';
    const operationId = op.id;
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    const signal = AbortSignal.any([this.signal, controller.signal]);
    let createInvoked = false;
    const pass = this.pass(signal);
    try {
      if (op.request.kind === 'delete' || op.request.kind === 'remove') return await this.destructive.drive(taskId, operationId, pass);
      if (!await this.passIdle(taskId, operationId, pass)) return 'waiting';
      await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'preflight'; delete operation.error; });
      let { task, project } = this.read(taskId);
      const expectedProject = project;
      const request = op.request;
      const gitProject = isGitProject(project) ? project : undefined;
      if (gitProject === undefined) throw new KanbanError('PROJECT_NOT_GIT', 'This project is not a Git repository; Git and worktree actions are unavailable.', { projectId: project.id });
      let target: string = task.effectiveCwd;
      if (request.kind === 'create' || request.kind === 'attach') {
        const gitRepo = requireGitProject(project);
        let tree: GitTree;
        if (request.kind === 'create') {
          const operation = this.read(taskId).task.operation;
          if (!operation) return 'done';
          // A destination that already exists is never adopted: it is refused before
          // any read of the source, exactly as a fresh creation always was.
          if (CreateAttempt.of(operation) === undefined && !operation.gitCompleted && await blocksCreate(request.path)) {
            throw new KanbanError('WORKTREE_TARGET_EXISTS', 'Create requires an absent destination. Use explicit attach for an existing checkout.', { path: request.path });
          }
          const repository = await this.git.resolve(gitRepo, task.sessionIds, signal);
          const route = await this.recovery.decide({ operation, project: gitRepo, repository, sessionIds: task.sessionIds, allowBranchReuse: options.allowBranchReuse === true });
          tree = await this.applyCreateRoute(taskId, operationId, gitRepo, repository, route, () => { createInvoked = true; }, signal);
          this.assertRecoveredBranch(request, tree);
        } else tree = await this.git.inspect(gitRepo, request.path, task.sessionIds, await this.git.resolve(gitRepo, task.sessionIds, signal));
        await this.update(taskId, operationId, (draft, operation) => {
          draft.worktree = { path: tree.path, branch: tree.branch, owned: request.kind === 'create' || (draft.worktree?.path === tree.path && draft.worktree.owned), status: 'preparing' };
          operation.targetPath = tree.path;
          operation.gitCompleted = true;
          // The Git write is done; the next step moves conversations. A cancel that
          // lands from here on must not fail a creation that already succeeded.
          operation.phase = 'switching';
        });
        this.cancelled.delete(taskId);
        target = await this.git.projectDirectory(gitRepo, tree.path);
      } else if (gitProject !== undefined) {
        target = await this.git.projectDirectory(gitProject);
      }
      this.sourceUnchanged(taskId, expectedProject);
      if (gitProject !== undefined && !await this.switchDirectories(taskId, operationId, target, request.kind === 'create' || request.kind === 'attach', gitProject, pass.probe, signal)) return 'waiting';
      this.assertTaskOpen(taskId);
      ({ task, project } = this.read(taskId));
      const settledAt = this.now();
      await this.update(taskId, operationId, (draft, operation) => {
        this.sourceUnchanged(taskId, expectedProject);
        if (draft.worktree && request.kind !== 'return') draft.worktree.status = 'ready';
        if (request.kind === 'attach' && draft.unclaimedWorktrees) {
          const remaining = draft.unclaimedWorktrees.filter(record => record.path !== draft.worktree?.path);
          if (remaining.length) draft.unclaimedWorktrees = remaining; else delete draft.unclaimedWorktrees;
        }
        recordSettledOperation(draft, operation, settledAt);
        draft.operation = null;
      });
      return 'done';
    } catch (error) {
      if ((this.disposed || this.signal.aborted) && (op.request.kind === 'delete' || op.request.kind === 'remove')) {
        // Shutdown is not a terminal failure for destructive work: keep the journal resumable.
        try { await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'queued'; delete operation.error; }); }
        catch { /* the task may already be gone */ }
        throw error;
      }
      await this.progress.flush(taskId, operationId).catch(() => undefined);
      const current = this.store.locate(taskId).task;
      // A step that already recorded its own failure keeps that attribution.
      if (current?.operation?.id === operationId && current.operation.phase !== 'failed') {
        const failure = problem(error);
        const classification = this.failureClassifier.classify({ operation: current.operation, invoked: createInvoked, previousAttempt: op.createAttempt !== undefined });
        const failedAt = this.now();
        const retained = await this.retainAttempt(taskId, operationId, current, classification.keepAttempt);
        await this.update(taskId, operationId, (task, operation) => {
          if (!retained.keep) delete operation.createAttempt;
          else if (retained.observed !== undefined && operation.createAttempt !== undefined) operation.createAttempt = { ...operation.createAttempt, observed: retained.observed };
          operation.phase = 'failed';
          operation.error = { ...failure, details: { ...failure.details, failedPhase: classification.failedPhase, gitAttempted: classification.gitAttempted } };
          if (task.worktree && (operation.request.kind === 'create' || operation.request.kind === 'attach')) task.worktree.status = 'error';
          recordSettledOperation(task, operation, failedAt, failure);
        });
      }
      throw error;
    } finally {
      if (this.controllers.get(taskId) === controller) this.controllers.delete(taskId);
      this.cancelled.delete(taskId);
    }
  }

  /**
   * Decide whether a failure keeps its attempt. An attempt with nothing left at the
   * destination protects nothing, so it is released together with the orphan
   * registration that would otherwise block the same path; the panel then offers
   * Retry, Return, and deletion again.
   */
  private async retainAttempt(taskId: string, operationId: string, task: Task, keep: boolean): Promise<{ keep: boolean; observed?: CheckoutObservation }> {
    if (!keep) return { keep: false };
    const operation = task.operation;
    const attempt = operation === null ? undefined : CreateAttempt.of(operation);
    const project = this.read(taskId).project;
    if (attempt === undefined || !isGitProject(project)) return { keep: false };
    try {
      const repository = await this.git.resolve(project, task.sessionIds, this.signal);
      const observed = await this.recovery.observe(attempt, repository);
      if (observed.directory !== 'absent') return { keep: true, observed };
      if (observed.registration === 'orphan') await this.git.clearRegistration(project, attempt.path, task.sessionIds, repository);
      return { keep: false };
    } catch {
      // An unreadable destination keeps the attempt so a later action can retry.
      return { keep: true };
    }
  }

  /** Execute the route the recovery decided, in the pass that already resolved the repository. */
  private async applyCreateRoute(taskId: string, operationId: string, project: GitProject, repository: GitRepository, route: CreateRoute, beforeWrite: () => void, signal: AbortSignal): Promise<GitTree> {
    const operation = this.read(taskId).task.operation;
    if (!operation || operation.request.kind !== 'create') throw unverifiedAttempt();
    const request = operation.request;
    switch (route.kind) {
      case 'adopt':
        return this.git.inspect(project, request.path, this.read(taskId).task.sessionIds, repository);
      case 'incomplete': {
        await this.observeAttempt(taskId, operationId, route.state);
        throw new KanbanError('CREATE_CHECKOUT_INCOMPLETE', 'A previous attempt left a checkout at the destination that Git does not register. Discard it to retry, or return the conversations to the base project.', { path: request.path, branchName: request.branchName, directory: route.state.directory, registration: route.state.registration });
      }
      case 'reuse-blocked':
        throw new KanbanError('CREATE_BRANCH_CHANGED', 'The branch left by the previous attempt no longer points at the source commit, so it is not reused. Choose another branch name or resolve the branch before retrying.', { branchName: route.branchName, expectedCommit: route.expected, actualCommit: route.actual });
      case 'create': {
        const { task } = this.read(taskId);
        if (route.clearRegistration !== undefined) await this.git.clearRegistration(project, route.clearRegistration, task.sessionIds, repository);
        if (route.clearAttempt) await this.update(taskId, operationId, (_task, draft) => { delete draft.createAttempt; });
        if (await blocksCreate(request.path)) throw new KanbanError('WORKTREE_TARGET_EXISTS', 'Create requires an absent or empty destination. Use explicit attach for an existing checkout.', { path: request.path });
        if (await canonicalPath(request.path, true) !== request.path || operation.targetPath !== request.path) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The canonical create destination changed before the attempt.');
        this.assertTaskOpen(taskId);
        this.sourceUnchanged(taskId, this.read(taskId).project);
        const gitRootPath = await canonicalPath(project.gitRootPath);
        await this.update(taskId, operationId, (_task, draft) => {
          draft.createAttempt = { operationId, path: request.path, gitRootPath, branchName: request.branchName, mode: request.mode, absentBefore: true, ...(route.sourceCommit === undefined ? {} : { sourceCommit: route.sourceCommit }), ...(route.reuseBranch ? { reusedBranch: true } : {}) };
          draft.phase = 'git';
        });
        // The write chain is not an external lease: recheck immediately before Git.
        if (await blocksCreate(request.path)) throw new KanbanError('WORKTREE_TARGET_EXISTS', 'The create destination appeared before Git was invoked; it will not be adopted.', { path: request.path });
        this.assertTaskOpen(taskId);
        this.sourceUnchanged(taskId, this.read(taskId).project);
        const tree = await this.git.create(project, route.reuseBranch ? { ...request, mode: 'existing' } : request, task.sessionIds, signal, repository, { ...(route.sourceCommit === undefined ? {} : { sourceCommit: route.sourceCommit }), beforeWrite });
        return tree;
      }
    }
  }
}
