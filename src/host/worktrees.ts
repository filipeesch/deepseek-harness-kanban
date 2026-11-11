import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { KanbanError, problem } from '../shared/errors.js';
import type { GitPort, GitTree, SessionPort } from '../shared/ports.js';
import type { ContextOperation, CreateWorktreeInput, GitProject, HubState, OperationRequest, Project, RetainedCheckoutReason, Task, WorktreeDefaults } from '../shared/types.js';
import { canonicalPath } from './git.js';
import { isGitProject, requireGitProject } from '../shared/project.js';
import { WorktreeSharingGuard } from './worktree-sharing.js';
import { DestructiveExecution, type DestructiveOperationHost } from './destructive-operation.js';
import { DestructiveAdmission } from './destructive-admission.js';
import { OperationQueue } from './operation-queue.js';
import { OperationJournal, ProgressJournal, requireTask } from './operation-journal.js';
import { entryExists } from './paths.js';
import { ConversationProbe } from './conversation-probe.js';
import { TaskBindingIndex } from './task-binding-index.js';
import type { OperationPass } from './destructive-operation.js';
import type { WorktreeBinding } from './hub-repository.js';
import { replaceableByDeletion } from '../shared/context-operation.js';
import { recordSettledOperation } from './worktree-history.js';

export interface WorktreeStore {
  locate(taskId: string): { hubId: string; hub: HubState; task: Task; project: Project };
  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T>;
  /** The lightweight binding projection every destructive decision reads. */
  worktreeBindings(): readonly WorktreeBinding[];
  /** Whether any task holds a context operation; the resume path avoids cloning Hubs when it is false. */
  hasOperations?(): boolean;
}
/** A creation request as a caller may state it; the coordinator derives any omitted default. */
export type WorktreeRequest = OperationRequest | ({ kind: 'create' } & CreateWorktreeInput);
/** Derives the collision-free title defaults creation uses when the request omits them. */
export interface WorktreeDefaultsPort { derive(taskId: string): Promise<WorktreeDefaults> }
export interface WorktreeCoordinatorOptions { signal?: AbortSignal; id?: () => string; now?: () => string; index?: TaskBindingIndex; worktreeDefaults?: WorktreeDefaultsPort; onTaskDeleted?: (task: Task, project: Project) => Promise<void>; onCheckoutRetained?: (task: Task, project: Project, path: string, reason: RetainedCheckoutReason) => void; sharing?: WorktreeSharingGuard; /** Shared with project relocation so both serialize on one per-repository lane. */ queue?: OperationQueue }
type CreateAttempt = NonNullable<ContextOperation['createAttempt']>;

function requireProject(state: HubState, id: string): Project {
  const project = state.projects.find(item => item.id === id);
  if (!project) throw new KanbanError('PROJECT_NOT_FOUND', 'The task project does not exist.', { projectId: id });
  return project;
}
function beforeCreateFailure(error: unknown): boolean {
  if (!(error instanceof KanbanError)) return false;
  if (error.code === 'INVALID_BRANCH' || error.code === 'LOCAL_BRANCH_REQUIRED') return true;
  const args = error.details?.args;
  return Array.isArray(args) && args[0] === '-C' && (args[2] === 'check-ref-format' || (args[2] === 'rev-parse' && args.includes('--verify')));
}
async function exists(value: string): Promise<boolean> {
  try { await stat(value); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
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
    this.destructive = new DestructiveExecution(store, sessions, git, this.destructiveHost(), this.journal, { now: this.now, sharing: this.sharing, index: this.index, ...(options.onTaskDeleted ? { onTaskDeleted: options.onTaskDeleted } : {}), ...(options.onCheckoutRetained ? { onCheckoutRetained: options.onCheckoutRetained } : {}) });
  }

  private destructiveHost(): DestructiveOperationHost {
    return {
      read: taskId => this.read(taskId),
      assertOpen: () => this.assertOpen(),
      signal: this.signal,
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
        await this.drive(taskId);
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
      else await this.drive(taskId);
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
      if (old?.request.kind === 'create') {
        const proof = await this.createProof(old, gitProject);
        if (proof) {
          if (!await entryExists(proof.path)) throw new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'The attempted checkout is unavailable; its recovery journal has been retained.');
          const tree = await this.git.inspect(gitProject, proof.path, task.sessionIds);
          if (tree.path !== proof.path || await canonicalPath(tree.path) !== proof.path) throw new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'The checkout no longer matches the canonical create target.');
          const boundPath = task.worktree?.path;
          const sameBinding = !!boundPath && await canonicalPath(boundPath, true) === tree.path;
          const verifiedBranch = tree.branch !== 'HEAD' && tree.branch === old.request.branchName;
          if (verifiedBranch && (!task.worktree || sameBinding)) {
            if (!task.worktree) await this.update(taskId, old.id, draft => { draft.worktree = { path: tree.path, branch: tree.branch, owned: true, status: 'error' }; });
          } else {
            const aliases = new Set([tree.path]);
            for (const record of task.unclaimedWorktrees ?? []) {
              try { if (await canonicalPath(record.path, true) === tree.path) aliases.add(record.path); } catch { /* Keep inaccessible diagnostics rather than dropping them. */ }
            }
            const error = { code: 'UNCLAIMED_WORKTREE', message: 'Returned to base without claiming or removing this checkout. Choose explicit attach to use it.', details: { expectedBranch: old.request.branchName, actualBranch: tree.branch, reason: verifiedBranch ? 'known-binding-preserved' : tree.branch === 'HEAD' ? 'detached-head' : 'branch-mismatch' } };
            await this.update(taskId, old.id, draft => {
              if (sameBinding && draft.worktree?.path === boundPath) draft.worktree = null;
              draft.unclaimedWorktrees = [...(draft.unclaimedWorktrees ?? []).filter(record => !aliases.has(record.path)), { path: tree.path, branch: tree.branch, error }];
            });
          }
        }
      }
      await this.start(taskId, { kind: 'return' });
      await this.drive(taskId);
      return this.hubAfter(taskId, before);
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
        await Promise.all(rest.map(binding => this.serial(binding.taskId, () => this.drive(binding.taskId).catch(() => {}))));
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
    this.assertOpen();
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
      if (operation.phase === 'git' && !operation.gitCompleted) operation.error = { code: 'RECOVERY_PENDING', message: 'Waiting to inspect the previously started Git operation.', details: { failedPhase: 'git', gitAttempted: !!operation.createAttempt } };
      operation.phase = 'waiting';
    });
  }

  private async createProof(operation: ContextOperation, project: GitProject): Promise<CreateAttempt | undefined> {
    const proof = operation.createAttempt;
    if (!proof) return;
    const request = operation.request;
    if (request.kind !== 'create' || proof.absentBefore !== true || proof.operationId !== operation.id || proof.path !== operation.targetPath || proof.path !== request.path || proof.path !== await canonicalPath(request.path, true) || proof.branchName !== request.branchName || proof.mode !== request.mode || proof.gitRootPath !== await canonicalPath(project.gitRootPath)) throw new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'The recorded create precondition no longer matches this operation.');
    return proof;
  }

  private assertRecoveredBranch(request: Extract<OperationRequest, { kind: 'create' }>, tree: GitTree): void {
    if (tree.branch === 'HEAD' || tree.branch !== request.branchName || tree.path !== request.path) throw new KanbanError('RECOVERY_TARGET_MISMATCH', 'The recovered checkout does not match the requested branch.', { path: tree.path, branch: tree.branch });
  }

  private sourceUnchanged(taskId: string, expected: Project): void {
    const { project } = this.read(taskId);
    if (project.id !== expected.id || project.projectPath !== expected.projectPath || project.gitRootPath !== expected.gitRootPath) throw new KanbanError('PROJECT_CONTEXT_CHANGED', 'The project paths changed during the operation.');
  }

  private async switchDirectories(taskId: string, operationId: string, target: string, write: boolean, project: GitProject, probe: ConversationProbe): Promise<boolean> {
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
        this.assertOpen();
        this.sourceUnchanged(taskId, project);
        await this.sessions.setDirectory(id, target, this.signal);
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
  private pass(): OperationPass {
    const probe = new ConversationProbe(this.sessions);
    return {
      probe,
      switchDirectories: (taskId, operationId, target, write, project) => this.switchDirectories(taskId, operationId, target, write, project, probe),
      repository: (project, sessionIds) => this.git.resolve(project, sessionIds, this.signal),
    };
  }

  private async drive(taskId: string): Promise<'waiting' | 'done'> {
    const initial = this.read(taskId);
    const op = initial.task.operation;
    if (!op) return 'done';
    const operationId = op.id;
    let createInvoked = false;
    const pass = this.pass();
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
          const proof = await this.createProof(op, gitRepo);
          if (proof || op.gitCompleted) {
            if (!proof) throw new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'This create has no persisted absent-target precondition; use explicit attach instead.');
            tree = await this.git.inspect(gitRepo, request.path, task.sessionIds, await this.git.resolve(gitRepo, task.sessionIds, this.signal));
            this.assertRecoveredBranch(request, tree);
          } else {
            if (await entryExists(request.path)) throw new KanbanError('WORKTREE_TARGET_EXISTS', 'Create requires an absent destination. Use explicit attach for an existing checkout.', { path: request.path });
            if (await canonicalPath(request.path, true) !== request.path || op.targetPath !== request.path) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The canonical create destination changed before the attempt.');
            // One repository context for the rest of the creation: branch occupancy,
            // the Git write, and the created checkout's verification reuse it.
            const repository = await this.git.resolve(gitRepo, task.sessionIds, this.signal);
            // Validate the source repository and read policy before arming a create intent.
            await this.git.branches(gitRepo, task.sessionIds, repository);
            const gitRootPath = await canonicalPath(gitRepo.gitRootPath);
            this.assertOpen();
            this.sourceUnchanged(taskId, expectedProject);
            await this.update(taskId, operationId, (_task, operation) => {
              operation.createAttempt = { operationId, path: request.path, gitRootPath, branchName: request.branchName, mode: request.mode, absentBefore: true };
              operation.phase = 'git';
            });
            // The write chain is not an external lease: recheck immediately before Git.
            if (await entryExists(request.path)) throw new KanbanError('WORKTREE_TARGET_EXISTS', 'The create destination appeared before Git was invoked; it will not be adopted.', { path: request.path });
            this.assertOpen();
            this.sourceUnchanged(taskId, expectedProject);
            createInvoked = true;
            tree = await this.git.create(gitRepo, request, task.sessionIds, this.signal, repository);
            this.assertRecoveredBranch(request, tree);
          }
        } else tree = await this.git.inspect(gitRepo, request.path, task.sessionIds, await this.git.resolve(gitRepo, task.sessionIds, this.signal));
        await this.update(taskId, operationId, (draft, operation) => {
          draft.worktree = { path: tree.path, branch: tree.branch, owned: request.kind === 'create' || (draft.worktree?.path === tree.path && draft.worktree.owned), status: 'preparing' };
          operation.targetPath = tree.path;
          operation.gitCompleted = true;
        });
        target = await this.git.projectDirectory(gitRepo, tree.path);
      } else if (gitProject !== undefined) {
        target = await this.git.projectDirectory(gitProject);
      }
      this.sourceUnchanged(taskId, expectedProject);
      if (gitProject !== undefined && !await this.switchDirectories(taskId, operationId, target, request.kind === 'create' || request.kind === 'attach', gitProject, pass.probe)) return 'waiting';
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
        const recorded = current.operation.createAttempt;
        const possibleCreate = !!recorded && !beforeCreateFailure(error) && (current.operation.gitCompleted || (!!op.createAttempt || createInvoked) && await entryExists(recorded.path));
        const failedPhase = current.operation.request.kind === 'create' && !possibleCreate ? 'preflight' : current.operation.phase;
        const failedAt = this.now();
        await this.update(taskId, operationId, (task, operation) => {
          if (!possibleCreate) delete operation.createAttempt;
          operation.phase = 'failed';
          operation.error = { ...failure, details: { ...failure.details, failedPhase, gitAttempted: possibleCreate } };
          if (task.worktree && (operation.request.kind === 'create' || operation.request.kind === 'attach')) task.worktree.status = 'error';
          recordSettledOperation(task, operation, failedAt, failure);
        });
      }
      throw error;
    }
  }
}
