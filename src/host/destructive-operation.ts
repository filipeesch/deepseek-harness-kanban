import { KanbanError, problem } from '../shared/errors.js';
import { isGitProject } from '../shared/project.js';
import type { GitPort, GitRepository, SessionPort } from '../shared/ports.js';
import type { ContextOperation, GitProject, HubState, Project, Task } from '../shared/types.js';
import { canonicalPath, containsPath } from './git.js';
import { CheckoutPreflight, type DestructiveRequest } from './checkout-preflight.js';
import { CheckoutRemoval } from './checkout-removal.js';
import type { ConversationProbe } from './conversation-probe.js';
import type { DestructiveJournal } from './destructive-journal.js';
import type { WorktreeBinding } from './hub-repository.js';
import { requireTask, type OperationJournal } from './operation-journal.js';
import { SessionArchiver, WaitingForIdle } from './session-archiver.js';
import { TaskBindingIndex } from './task-binding-index.js';
import { TaskTeardown, type TeardownOutcome } from './task-teardown.js';
import { WorktreeSharingGuard } from './worktree-sharing.js';

export interface DestructiveStore {
  locate(taskId: string): { task: Task; project: Project; hub: HubState };
  worktreeBindings(): readonly WorktreeBinding[];
  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T>;
}

/** Narrow view of the coordinator that destructive execution needs. */
export interface DestructiveOperationHost {
  read(taskId: string): { task: Task; project: Project; hub: HubState };
  assertOpen(): void;
  signal: AbortSignal;
  sourceUnchanged(taskId: string, expected: Project): void;
}

/** One execution pass: the idleness probe, the directory switch, and the repository facts. */
export interface OperationPass {
  readonly probe: ConversationProbe;
  switchDirectories(taskId: string, operationId: string, target: string, write: boolean, project: GitProject): Promise<boolean>;
  repository(project: GitProject, sessionIds: string[]): Promise<GitRepository>;
}

export interface DestructiveOperationOptions {
  now?: () => string;
  sharing?: WorktreeSharingGuard;
  index?: TaskBindingIndex;
  onTaskDeleted?: (task: Task, project: Project) => Promise<void>;
  /** Reports a checkout left on disk because the deletion could not resolve its project context. */
  onCheckoutRetained?: (task: Task, project: Project, path: string) => void;
}

async function canonicalOrNull(value: string): Promise<string | null> {
  try { return await canonicalPath(value, true); }
  catch { return null; }
}

/**
 * Owns the journaled delete/remove execution that the host queue runs: one
 * authoritative preflight, the directory return, and a teardown that overlaps
 * checkout removal with native archiving. It never schedules itself and never
 * runs on the interactive command path.
 */
export class DestructiveExecution {
  private readonly now: () => string;
  private readonly sharing: WorktreeSharingGuard;
  private readonly index: TaskBindingIndex;
  private readonly onTaskDeleted?: (task: Task, project: Project) => Promise<void>;
  private readonly onCheckoutRetained?: (task: Task, project: Project, path: string) => void;
  readonly signal: AbortSignal;

  constructor(
    private readonly store: DestructiveStore,
    private readonly sessions: SessionPort,
    private readonly git: GitPort,
    private readonly host: DestructiveOperationHost,
    private readonly journal: OperationJournal,
    options: DestructiveOperationOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.index = options.index ?? new TaskBindingIndex(store);
    this.sharing = options.sharing ?? new WorktreeSharingGuard(store, sessions, this.index);
    this.onTaskDeleted = options.onTaskDeleted;
    this.onCheckoutRetained = options.onCheckoutRetained;
    this.signal = host.signal;
  }

  private update(taskId: string, operationId: string, change: (task: Task, operation: ContextOperation) => void): Promise<void> {
    return this.journal.update(taskId, operationId, change);
  }

  /** The journal as one task's operation sees it. */
  private scoped(taskId: string): DestructiveJournal {
    return {
      read: () => this.host.read(taskId),
      update: (operationId, change) => this.update(taskId, operationId, change),
      assertOpen: () => this.host.assertOpen(),
    };
  }

  private operation(taskId: string, operationId: string): ContextOperation {
    const operation = this.host.read(taskId).task.operation;
    if (!operation || operation.id !== operationId) throw new KanbanError('OPERATION_CHANGED', 'The operation changed while it was being coordinated.');
    return operation;
  }

  /** The authoritative preflight, the directory return, and the teardown. */
  async drive(taskId: string, operationId: string, pass: OperationPass): Promise<'waiting' | 'done'> {
    if (!await this.idle(taskId, operationId, pass)) return 'waiting';
    await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'preflight'; delete operation.error; });
    let { task, project } = this.host.read(taskId);
    const operation = this.operation(taskId, operationId);
    const request = operation.request as DestructiveRequest;
    // The confirmed target is revalidated against the current binding before any
    // removal, so a binding changed after admission fails instead of removing it.
    if (request.expectedWorktreePath !== undefined) {
      const actual = task.worktree?.path ?? null;
      if (request.expectedWorktreePath !== actual) throw new KanbanError('WORKTREE_CHANGED', 'The worktree changed since this confirmation was displayed.', { expectedWorktreePath: request.expectedWorktreePath, actualWorktreePath: actual });
    }
    const gitProject = isGitProject(project) ? project : undefined;
    if (gitProject === undefined && request.kind !== 'delete') throw new KanbanError('PROJECT_NOT_GIT', 'This project is not a Git repository; Git and worktree actions are unavailable.', { projectId: project.id });
    if (!operation.gitCompleted) {
      // Admission records the persisted binding without touching the filesystem;
      // the canonical comparison happens here, inside the lane.
      const currentTarget = task.worktree ? await canonicalPath(task.worktree.path, true) : undefined;
      const confirmedTarget = operation.targetPath === undefined ? undefined : await canonicalPath(operation.targetPath, true);
      if (currentTarget !== confirmedTarget) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The confirmed worktree target changed; it will not be removed.');
    }

    const journal = this.scoped(taskId);
    const preflight = new CheckoutPreflight({ git: this.git, sharing: this.sharing, index: this.index });
    const needsCheckout = task.worktree !== null && !operation.gitCompleted;
    const repository = needsCheckout && gitProject !== undefined ? await this.resolvableRepository(gitProject, task.sessionIds, pass) : undefined;
    const plan = await preflight.plan({ task, project, request, ...(repository === undefined ? {} : { repository }) });

    this.host.sourceUnchanged(taskId, project);
    if (plan.directoryTarget !== undefined) {
      if (gitProject === undefined) throw new KanbanError('PROJECT_NOT_GIT', 'This project is not a Git repository; Git and worktree actions are unavailable.', { projectId: project.id });
      if (!await pass.switchDirectories(taskId, operationId, plan.directoryTarget, false, gitProject)) return 'waiting';
      ({ task, project } = this.host.read(taskId));
    }

    let checkoutRemoved = false;
    let archivedInTeardown = false;
    const removable = !operation.gitCompleted && plan.checkout === 'remove' && gitProject !== undefined && task.worktree !== null && repository !== undefined;
    if (!operation.gitCompleted && !removable) {
      // A deletion tolerates a context it cannot verify; the checkout stays on disk.
      await this.update(taskId, operationId, (draft, current) => {
        if (plan.checkout === 'retain' && plan.retainedPath !== undefined) current.retainedCheckoutPath = plan.retainedPath;
        draft.worktree = null; current.gitCompleted = true;
      });
    } else if (removable) {
      const archiver = new SessionArchiver({ sessions: this.sessions, probe: pass.probe, journal });
      const removal = new CheckoutRemoval({ git: this.git, sharing: this.sharing, index: this.index, journal, signal: this.signal });
      const input = { task, request, operationId, plan, repository: repository! };
      const outcome = await new TaskTeardown().run({
        prepare: () => removal.prepare(input),
        remove: () => removal.run(input),
        archive: () => request.kind === 'delete' ? this.archive(taskId, archiver, task, operationId) : Promise.resolve('skipped' as const),
      });
      checkoutRemoved = outcome.removed;
      archivedInTeardown = request.kind === 'delete';
      if (await this.settle(taskId, operationId, outcome) === 'waiting') return 'waiting';
    }

    const target = operation.targetPath;
    if (request.kind === 'remove') {
      if (request.force === true && checkoutRemoved && target !== undefined) await this.markAffectedBindings(taskId, target);
      await this.update(taskId, operationId, draft => { draft.operation = null; });
      return 'done';
    }

    if (!archivedInTeardown) {
      const archiver = new SessionArchiver({ sessions: this.sessions, probe: pass.probe, journal });
      if (await this.archive(taskId, archiver, task, operationId) === 'waiting') return 'waiting';
    }

    this.host.assertOpen();
    const deleted = this.host.read(taskId);
    const settled = deleted.task.operation!;
    const retainedPath = settled.retainedCheckoutPath;
    // A checkout recorded as retained was never removed, so it cannot count as removed
    // on a resumed execution either.
    const removedCheckout = checkoutRemoved || (settled.gitCompleted && settled.targetPath !== undefined && retainedPath === undefined && gitProject !== undefined);
    const affected = request.force === true && removedCheckout && target !== undefined ? await this.affectedBindings(taskId, target) : [];
    if (affected.length > 0 && target !== undefined) await this.markAffectedBindings(taskId, target, affected);
    await this.store.transactTask(taskId, state => {
      if (requireTask(state, taskId).operation?.id !== operationId) throw new KanbanError('OPERATION_CHANGED', 'The deletion operation changed.');
      state.notes = state.notes.filter(note => note.taskId !== taskId);
      state.tasks = state.tasks.filter(item => item.id !== taskId);
    });
    try { await this.onTaskDeleted?.(deleted.task, deleted.project); } catch { /* cleanup is reported by the callback owner */ }
    if (retainedPath !== undefined) {
      try { this.onCheckoutRetained?.(deleted.task, deleted.project, retainedPath); } catch { /* reporting is best effort */ }
    }
    return 'done';
  }

  /**
   * The operation's repository context, or undefined when the project context can no
   * longer be resolved. A deletion keeps working in that case: the plan retains the
   * checkout instead of failing, and the retained path is reported.
   */
  private async resolvableRepository(project: GitProject, sessionIds: string[], pass: OperationPass): Promise<GitRepository | undefined> {
    try { return await pass.repository(project, sessionIds); }
    catch (error) {
      if (error instanceof KanbanError && (error.code === 'PATH_UNAVAILABLE' || error.code === 'INVALID_PATH')) return undefined;
      throw error;
    }
  }

  /** Archive through the probe, turning a running conversation into a wait. */
  private async archive(taskId: string, archiver: SessionArchiver, task: Task, operationId: string): Promise<'done' | 'waiting'> {
    try { return await archiver.archive({ task, operationId }); }
    catch (error) {
      if (!(error instanceof WaitingForIdle)) throw error;
      try { await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'waiting'; }); } catch { /* the operation was replaced */ }
      return 'waiting';
    }
  }

  /**
   * Resolve the two steps' failures. Archiving wins a tie because archived native
   * conversations cannot be restored, so the recorded phase must name it.
   */
  private async settle(taskId: string, operationId: string, outcome: TeardownOutcome): Promise<'done' | 'waiting'> {
    if (outcome.archivingError !== undefined) {
      if (outcome.archivingError instanceof WaitingForIdle) return 'waiting';
      await this.recordFailure(taskId, operationId, 'archiving', outcome.archivingError);
      throw outcome.archivingError;
    }
    if (outcome.removalError !== undefined) {
      if (outcome.removalError instanceof WaitingForIdle) return 'waiting';
      await this.recordFailure(taskId, operationId, 'removing', outcome.removalError);
      throw outcome.removalError;
    }
    return outcome.archived === 'waiting' ? 'waiting' : 'done';
  }

  /** Record a teardown failure with the step that produced it, before propagating it. */
  private async recordFailure(taskId: string, operationId: string, phase: 'removing' | 'archiving', error: unknown): Promise<void> {
    const failure = problem(error);
    try {
      await this.update(taskId, operationId, (_task, current) => {
        current.phase = 'failed';
        current.error = { ...failure, details: { ...failure.details, failedPhase: phase, gitAttempted: current.gitCompleted } };
      });
    } catch { /* the task or operation is gone */ }
  }

  private async markAffectedBindings(removedByTaskId: string, target: string, affected?: readonly string[]): Promise<void> {
    const entries = affected ?? (await this.affectedBindings(removedByTaskId, target));
    if (entries.length === 0) return;
    const failure = this.removalProblem(removedByTaskId, target);
    // Each task may live in a different Hub aggregate; mark it through its own write chain.
    for (const taskId of entries) {
      await this.store.transactTask(taskId, state => {
        const other = state.tasks.find(item => item.id === taskId);
        if (!other?.worktree) return;
        other.worktree = { ...other.worktree, status: 'error', error: failure };
        other.updatedAt = this.now();
      });
    }
  }

  /** Every other task bound to the removed checkout, read from the binding projection. */
  private async affectedBindings(removedByTaskId: string, target: string): Promise<string[]> {
    const canonical = await canonicalPath(target, true);
    const affected: string[] = [];
    for (const binding of this.store.worktreeBindings()) {
      if (binding.taskId === removedByTaskId || binding.worktreePath === null) continue;
      const otherPath = await canonicalOrNull(binding.worktreePath);
      if (!otherPath) continue;
      if (containsPath(canonical, otherPath) || containsPath(otherPath, canonical)) affected.push(binding.taskId);
    }
    return affected;
  }

  private removalProblem(removedByTaskId: string, target: string) {
    return { code: 'WORKTREE_REMOVED', message: 'This checkout was removed by another task\'s forced deletion.', details: { removedByTaskId, path: target } };
  }

  private async idle(taskId: string, operationId: string, pass: OperationPass): Promise<boolean> {
    this.host.assertOpen();
    const { task } = this.host.read(taskId);
    const idle = await pass.probe.allIdle(task.sessionIds);
    if (!idle) await this.update(taskId, operationId, (_task, operation) => {
      if (operation.phase === 'git' && !operation.gitCompleted) operation.error = { code: 'RECOVERY_PENDING', message: 'Waiting to inspect the previously started Git operation.', details: { failedPhase: 'git', gitAttempted: !!operation.createAttempt } };
      operation.phase = 'waiting';
    });
    return idle;
  }
}
