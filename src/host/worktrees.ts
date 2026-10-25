import { randomUUID } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import { KanbanError, problem } from '../shared/errors.js';
import type { GitPort, GitTree, SessionPort } from '../shared/ports.js';
import type { ContextOperation, HubState, OperationRequest, Project, Task } from '../shared/types.js';
import { canonicalPath } from './git.js';
import { WorktreeSharingGuard } from './worktree-sharing.js';

export interface WorktreeStore {
  locate(taskId: string): { hubId: string; hub: HubState; task: Task; project: Project };
  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T>;
  allTasks(): Task[];
}
export interface WorktreeCoordinatorOptions { signal?: AbortSignal; id?: () => string; now?: () => string; onTaskDeleted?: (task: Task, project: Project) => Promise<void>; sharing?: WorktreeSharingGuard }
type CreateAttempt = NonNullable<ContextOperation['createAttempt']>;

function requireTask(state: HubState, id: string): Task {
  const task = state.tasks.find(item => item.id === id);
  if (!task) throw new KanbanError('TASK_NOT_FOUND', 'The task does not exist.', { taskId: id });
  return task;
}
function requireProject(state: HubState, id: string): Project {
  const project = state.projects.find(item => item.id === id);
  if (!project) throw new KanbanError('PROJECT_NOT_FOUND', 'The task project does not exist.', { projectId: id });
  return project;
}
async function entryExists(value: string): Promise<boolean> {
  try { await lstat(value); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
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
  private readonly tails = new Map<string, Promise<void>>();
  private resumed: Promise<void> | undefined;
  private resumeAgain = false;
  private disposed = false;

  constructor(private readonly store: WorktreeStore, private readonly sessions: SessionPort, private readonly git: GitPort, options: WorktreeCoordinatorOptions = {}) {
    this.signal = options.signal ? AbortSignal.any([this.controller.signal, options.signal]) : this.controller.signal;
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onTaskDeleted = options.onTaskDeleted;
    this.sharing = options.sharing ?? new WorktreeSharingGuard(store, sessions);
  }

  dispose(): void { this.disposed = true; this.controller.abort(); }

  async settle(): Promise<void> {
    await Promise.all([...this.tails.values()]);
    await this.resumed;
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
    await this.store.transactTask(taskId, state => {
      const task = requireTask(state, taskId);
      if (task.operation?.id !== operationId) throw new KanbanError('OPERATION_CHANGED', 'The operation changed while it was being coordinated.');
      change(task, task.operation);
      task.updatedAt = this.now();
    });
  }

  private sameRequest(a: OperationRequest, b: OperationRequest): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'create' && b.kind === 'create') return a.path === b.path && a.branchName === b.branchName && a.mode === b.mode && a.sourceBranch === b.sourceBranch;
    if (a.kind === 'attach' && b.kind === 'attach') return a.path === b.path;
    return true;
  }

  async request(taskId: string, request: OperationRequest): Promise<HubState> {
    if (request.kind === 'return') return this.returnToBase(taskId);
    const before = this.read(taskId).hub;
    return this.serial(taskId, async () => {
      this.assertOpen();
      if (!['create', 'attach', 'remove', 'delete'].includes(request.kind)) throw new KanbanError('INVALID_OPERATION', 'Unsupported worktree operation.');
      if ((request.kind === 'remove' || request.kind === 'delete') && typeof request.discardChanges !== 'boolean') throw new KanbanError('INVALID_OPERATION', 'Explicit discard consent must be a boolean.');
      const normalized = structuredClone(request);
      if (normalized.kind === 'create' || normalized.kind === 'attach') normalized.path = await canonicalPath(normalized.path, true);
      const { task } = this.read(taskId);
      await this.confirmationMatches(task, normalized);
      if (task.operation) {
        if (!this.sameRequest(task.operation.request, normalized)) throw new KanbanError('OPERATION_PENDING', 'Resolve the existing operation before starting a different operation.', { kind: task.operation.request.kind });
        await this.update(taskId, task.operation.id, (_task, operation) => {
          if ((operation.request.kind === 'remove' || operation.request.kind === 'delete') && (normalized.kind === 'remove' || normalized.kind === 'delete')) operation.request.discardChanges ||= normalized.discardChanges;
          // Preserve the journal and previous failure stage for safe retry/recovery.
          if (operation.phase === 'failed') operation.phase = 'waiting';
        });
      } else {
        if (task.worktree && (normalized.kind === 'create' || (normalized.kind === 'attach' && task.worktree.path !== normalized.path))) throw new KanbanError('WORKTREE_ALREADY_BOUND', 'Remove or recover the current worktree before choosing another target.');
        await this.start(taskId, normalized);
      }
      await this.drive(taskId);
      return this.hubAfter(taskId, before);
    });
  }

  private hubAfter(taskId: string, fallback: HubState): HubState { try { return this.store.locate(taskId).hub; } catch { return fallback; } }

  async retry(taskId: string): Promise<HubState> {
    const before = this.read(taskId).hub;
    return this.serial(taskId, async () => {
      this.assertOpen();
      const { task } = this.read(taskId);
      if (!task.operation) throw new KanbanError('NO_OPERATION', 'There is no operation to retry.');
      await this.update(taskId, task.operation.id, (_task, operation) => { if (operation.phase === 'failed') operation.phase = 'waiting'; });
      await this.drive(taskId);
      return this.hubAfter(taskId, before);
    });
  }

  async returnToBase(taskId: string): Promise<HubState> {
    const before = this.read(taskId).hub;
    return this.serial(taskId, async () => {
      this.assertOpen();
      const { task, project } = this.read(taskId);
      const old = task.operation;
      if (old?.request.kind === 'delete' && (old.archivedSessionIds.length > 0 || old.phase === 'archiving' || old.error?.details?.failedPhase === 'archiving')) throw new KanbanError('DELETE_IN_PROGRESS', 'Retry the partially completed deletion; archived native conversations cannot be silently restored.');
      // A Git create may have succeeded immediately before a persistence failure.
      // An explicit return can abandon an unverifiable ref, never claim or delete it.
      if (old?.request.kind === 'create') {
        const proof = await this.createProof(old, project);
        if (proof) {
          if (!await entryExists(proof.path)) throw new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'The attempted checkout is unavailable; its recovery journal has been retained.');
          const tree = await this.git.inspect(project, proof.path, task.sessionIds);
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
    if (this.resumed) { this.resumeAgain = true; return this.resumed; }
    this.resumed = (async () => {
      do {
        this.resumeAgain = false;
        const tasks = this.store.allTasks().filter(task => task.operation && task.operation.phase !== 'failed');
        // Each failure remains on its own task; one failing task must not starve others.
        await Promise.all(tasks.map(task => this.serial(task.id, () => this.drive(task.id)).catch(() => {})));
      } while (this.resumeAgain && !this.disposed && !this.signal.aborted);
    })().finally(() => {
      this.resumed = undefined;
      // Preserve an activity event that arrived between the last pass and finalization.
      if (this.resumeAgain && !this.disposed && !this.signal.aborted) { this.resumeAgain = false; void this.resumePending(); }
    });
    return this.resumed;
  }

  private async confirmationMatches(task: Task, request: OperationRequest): Promise<void> {
    if ((request.kind !== 'remove' && request.kind !== 'delete') || request.expectedWorktreePath === undefined) return;
    const actual = task.worktree ? await canonicalPath(task.worktree.path, true) : null;
    if (request.expectedWorktreePath !== actual) throw new KanbanError('WORKTREE_CHANGED', 'The worktree changed since confirmation; review the current target before continuing.', { expectedWorktreePath: request.expectedWorktreePath, actualWorktreePath: actual });
  }

  private async start(taskId: string, request: OperationRequest): Promise<void> {
    const prior = this.read(taskId).task;
    const rawTarget = request.kind === 'create' || request.kind === 'attach' ? request.path : prior.worktree?.path;
    const targetPath = rawTarget ? await canonicalPath(rawTarget, true) : undefined;
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

  private async idle(taskId: string, operationId: string): Promise<boolean> {
    this.assertOpen();
    const { task } = this.read(taskId);
    const idle = (await Promise.all(task.sessionIds.map(id => this.sessions.isIdle(id)))).every(Boolean);
    if (!idle) await this.update(taskId, operationId, (_task, operation) => {
      if (operation.phase === 'git' && !operation.gitCompleted) operation.error = { code: 'RECOVERY_PENDING', message: 'Waiting to inspect the previously started Git operation.', details: { failedPhase: 'git', gitAttempted: !!operation.createAttempt } };
      operation.phase = 'waiting';
    });
    return idle;
  }

  private async createProof(operation: ContextOperation, project: Project): Promise<CreateAttempt | undefined> {
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

  private async switchDirectories(taskId: string, operationId: string, target: string, write: boolean): Promise<boolean> {
    const { task, project } = this.read(taskId);
    await this.git.assertPolicy(project, [target], task.sessionIds, write);
    await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'switching'; operation.targetDirectory = target; });
    for (const id of task.sessionIds) {
      if (!await this.idle(taskId, operationId)) return false;
      const current = await this.sessions.directory(id);
      await this.update(taskId, operationId, (_task, operation) => { operation.previousDirectories[id] ??= current; });
      if (await canonicalPath(current, true) !== target) {
        await this.git.assertPolicy(project, [target], [id], write);
        if (!await this.idle(taskId, operationId)) return false;
        this.assertOpen();
        this.sourceUnchanged(taskId, project);
        await this.sessions.setDirectory(id, target, this.signal);
      }
      await this.update(taskId, operationId, (_task, operation) => { if (!operation.switchedSessionIds.includes(id)) operation.switchedSessionIds.push(id); });
    }
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

  private async drive(taskId: string): Promise<void> {
    const initial = this.read(taskId);
    const op = initial.task.operation;
    if (!op) return;
    const operationId = op.id;
    let createInvoked = false;
    try {
      if (!await this.idle(taskId, operationId)) return;
      await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'preflight'; delete operation.error; });
      let { task, project } = this.read(taskId);
      const expectedProject = project;
      const request = op.request;
      if ((request.kind === 'remove' || request.kind === 'delete') && !op.gitCompleted) {
        const currentTarget = task.worktree ? await canonicalPath(task.worktree.path, true) : undefined;
        if (currentTarget !== op.targetPath) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The confirmed worktree target changed; it will not be removed.');
      }
      let target: string;
      if (request.kind === 'create' || request.kind === 'attach') {
        let tree: GitTree;
        if (request.kind === 'create') {
          const proof = await this.createProof(op, project);
          if (proof || op.gitCompleted) {
            if (!proof) throw new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'This create has no persisted absent-target precondition; use explicit attach instead.');
            tree = await this.git.inspect(project, request.path, task.sessionIds);
            this.assertRecoveredBranch(request, tree);
          } else {
            if (await entryExists(request.path)) throw new KanbanError('WORKTREE_TARGET_EXISTS', 'Create requires an absent destination. Use explicit attach for an existing checkout.', { path: request.path });
            if (await canonicalPath(request.path, true) !== request.path || op.targetPath !== request.path) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The canonical create destination changed before the attempt.');
            // Validate the source repository and read policy before arming a create intent.
            await this.git.branches(project, task.sessionIds);
            const gitRootPath = await canonicalPath(project.gitRootPath);
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
            tree = await this.git.create(project, request, task.sessionIds, this.signal);
            this.assertRecoveredBranch(request, tree);
          }
        } else tree = await this.git.inspect(project, request.path, task.sessionIds);
        await this.update(taskId, operationId, (draft, operation) => {
          draft.worktree = { path: tree.path, branch: tree.branch, owned: request.kind === 'create' || (draft.worktree?.path === tree.path && draft.worktree.owned), status: 'preparing' };
          operation.targetPath = tree.path;
          operation.gitCompleted = true;
        });
        target = await this.git.projectDirectory(project, tree.path);
      } else {
        target = await this.git.projectDirectory(project);
        if ((request.kind === 'remove' || request.kind === 'delete') && task.worktree && !op.gitCompleted) {
          await this.sharing.assertExclusive(taskId, task.worktree.path);
          if (await exists(task.worktree.path)) {
            const tree = await this.git.inspect(project, task.worktree.path, task.sessionIds);
            if (tree.dirty && !request.discardChanges) throw new KanbanError('DISCARD_REQUIRED', 'Explicit confirmation is required to discard local worktree changes.', { path: tree.path });
          }
        }
      }
      this.sourceUnchanged(taskId, expectedProject);
      if (!await this.switchDirectories(taskId, operationId, target, request.kind === 'create' || request.kind === 'attach')) return;
      ({ task, project } = this.read(taskId));
      if (request.kind === 'create' || request.kind === 'attach' || request.kind === 'return') {
        await this.update(taskId, operationId, draft => {
          this.sourceUnchanged(taskId, expectedProject);
          if (draft.worktree && request.kind !== 'return') draft.worktree.status = 'ready';
          if (request.kind === 'attach' && draft.unclaimedWorktrees) {
            const remaining = draft.unclaimedWorktrees.filter(record => record.path !== draft.worktree?.path);
            if (remaining.length) draft.unclaimedWorktrees = remaining; else delete draft.unclaimedWorktrees;
          }
          draft.operation = null;
        });
        return;
      }
      if (!task.operation!.gitCompleted) {
        if (!await this.idle(taskId, operationId)) return;
        if (task.worktree) {
          await this.sharing.assertExclusive(taskId, task.worktree.path);
          await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'removing'; });
          this.assertOpen();
          if (!await this.idle(taskId, operationId)) return;
          this.sourceUnchanged(taskId, expectedProject);
          await this.sharing.assertExclusive(taskId, op.targetPath!);
          this.sourceUnchanged(taskId, expectedProject);
          const confirmed = this.read(taskId).task.worktree;
          if (!confirmed || await canonicalPath(confirmed.path, true) !== op.targetPath) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The worktree binding changed before removal.');
          await this.git.remove(project, op.targetPath!, request.discardChanges, task.sessionIds, this.signal);
        }
        await this.update(taskId, operationId, (draft, operation) => { draft.worktree = null; operation.gitCompleted = true; });
      }
      if (request.kind === 'remove') { await this.update(taskId, operationId, draft => { draft.operation = null; }); return; }
      for (const id of task.sessionIds) {
        const latest = this.read(taskId).task.operation!;
        if (latest.archivedSessionIds.includes(id)) continue;
        if (!await this.idle(taskId, operationId)) return;
        await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'archiving'; });
        this.assertOpen();
        await this.sessions.archive(id);
        await this.update(taskId, operationId, (_task, operation) => { operation.archivedSessionIds.push(id); });
      }
      this.assertOpen();
      const deleted = this.read(taskId);
      await this.store.transactTask(taskId, state => {
        if (requireTask(state, taskId).operation?.id !== operationId) throw new KanbanError('OPERATION_CHANGED', 'The deletion operation changed.');
        state.notes = state.notes.filter(note => note.taskId !== taskId);
        state.tasks = state.tasks.filter(item => item.id !== taskId);
      });
      try { await this.onTaskDeleted?.(deleted.task, deleted.project); } catch { /* cleanup is reported by the callback owner */ }
    } catch (error) {
      const current = this.store.locate(taskId).task;
      if (current?.operation?.id === operationId) {
        const failure = problem(error);
        const recorded = current.operation.createAttempt;
        const possibleCreate = !!recorded && !beforeCreateFailure(error) && (current.operation.gitCompleted || (!!op.createAttempt || createInvoked) && await entryExists(recorded.path));
        const failedPhase = current.operation.request.kind === 'create' && !possibleCreate ? 'preflight' : current.operation.phase;
        await this.update(taskId, operationId, (task, operation) => {
          if (!possibleCreate) delete operation.createAttempt;
          operation.phase = 'failed';
          operation.error = { ...failure, details: { ...failure.details, failedPhase, gitAttempted: possibleCreate } };
          if (task.worktree && (operation.request.kind === 'create' || operation.request.kind === 'attach')) task.worktree.status = 'error';
        });
      }
      throw error;
    }
  }
}
