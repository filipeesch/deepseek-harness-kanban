import { lstat } from 'node:fs/promises';
import { KanbanError } from '../shared/errors.js';
import type { GitPort, SessionPort } from '../shared/ports.js';
import { isGitProject } from '../shared/project.js';
import type { ContextOperation, GitProject, HubState, Project, Task } from '../shared/types.js';
import { canonicalPath, containsPath } from './git.js';
import { resolveDeletionTarget } from './deletion-target.js';
import { requireTask, type OperationJournal } from './operation-journal.js';
import { WorktreeSharingGuard } from './worktree-sharing.js';

export interface DestructiveStore {
  locate(taskId: string): { task: Task; project: Project; hub: HubState };
  allTasks(): Task[];
  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T>;
}

/** Narrow view of the coordinator that destructive execution needs. */
export interface DestructiveOperationHost {
  read(taskId: string): { task: Task; project: Project; hub: HubState };
  assertOpen(): void;
  signal: AbortSignal;
  idle(taskId: string, operationId: string): Promise<boolean>;
  switchDirectories(taskId: string, operationId: string, target: string, write: boolean, project: GitProject): Promise<boolean>;
  sourceUnchanged(taskId: string, expected: Project): void;
}

export interface DestructiveOperationOptions {
  now?: () => string;
  sharing?: WorktreeSharingGuard;
  onTaskDeleted?: (task: Task, project: Project) => Promise<void>;
  /** Reports a checkout left on disk because the deletion could not resolve its project context. */
  onCheckoutRetained?: (task: Task, project: Project, path: string) => void;
}

type DestructiveRequest = Extract<ContextOperation['request'], { kind: 'delete' | 'remove' }>;
type DriveResult = 'waiting' | 'done';

async function entryExists(value: string): Promise<boolean> {
  try { await lstat(value); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function canonicalOrNull(value: string): Promise<string | null> {
  try { return await canonicalPath(value, true); }
  catch { return null; }
}

/**
 * Owns the journaled delete/remove execution that the host queue runs: the
 * authoritative preflight followed by the slow cleanup. It never schedules
 * itself and never runs on the interactive command path.
 */
export class DestructiveExecution {
  private readonly now: () => string;
  private readonly sharing: WorktreeSharingGuard;
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
    this.sharing = options.sharing ?? new WorktreeSharingGuard(store, sessions);
    this.onTaskDeleted = options.onTaskDeleted;
    this.onCheckoutRetained = options.onCheckoutRetained;
    this.signal = host.signal;
  }

  private update(taskId: string, operationId: string, change: (task: Task, operation: ContextOperation) => void): Promise<void> {
    return this.journal.update(taskId, operationId, change);
  }

  /** The authoritative preflight and the cleanup, both inside the queued lane. */
  async drive(taskId: string, operationId: string): Promise<DriveResult> {
    if (!await this.idle(taskId, operationId)) return 'waiting';
    await this.update(taskId, operationId, (_task, operation) => { operation.phase = 'preflight'; delete operation.error; });
    let { task, project } = this.host.read(taskId);
    const operation = task.operation;
    if (!operation || operation.id !== operationId) throw new KanbanError('OPERATION_CHANGED', 'The operation changed while it was being coordinated.');
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

    // Delete tolerates a project context that no longer resolves; a worktree-only
    // removal still needs its base directory to return the conversations to.
    const disposition = request.kind === 'delete'
      ? await resolveDeletionTarget({ task, project, git: this.git })
      : { directoryTarget: gitProject === undefined ? undefined : await this.git.projectDirectory(gitProject), checkout: 'remove' as const };
    let checkoutRemoved = false;
    if (task.worktree && !operation.gitCompleted && disposition.checkout === 'remove') {
      await this.assertPreRemoval(taskId, task, gitProject, request);
    }

    this.host.sourceUnchanged(taskId, project);
    if (disposition.directoryTarget !== undefined) {
      if (gitProject === undefined) throw new KanbanError('PROJECT_NOT_GIT', 'This project is not a Git repository; Git and worktree actions are unavailable.', { projectId: project.id });
      if (!await this.host.switchDirectories(taskId, operationId, disposition.directoryTarget, false, gitProject)) return 'waiting';
      ({ task, project } = this.host.read(taskId));
    }

    if (!task.operation!.gitCompleted) {
      if (!await this.idle(taskId, operationId)) return 'waiting';
      if (gitProject === undefined || disposition.checkout !== 'remove') {
        await this.update(taskId, operationId, (draft, current) => {
          if (disposition.checkout === 'retain' && disposition.retainedPath !== undefined) current.retainedCheckoutPath = disposition.retainedPath;
          draft.worktree = null; current.gitCompleted = true;
        });
      } else if (task.worktree) {
        await this.assertPreRemoval(taskId, task, gitProject, request);
        await this.update(taskId, operationId, (_draft, current) => { current.phase = 'removing'; });
        this.host.assertOpen();
        if (!await this.idle(taskId, operationId)) return 'waiting';
        this.host.sourceUnchanged(taskId, project);
        await this.assertRemovalTarget(taskId, request);
        this.host.sourceUnchanged(taskId, project);
        const confirmed = this.host.read(taskId).task.worktree;
        // Compare the persisted binding with the persisted target: admission
        // records the binding verbatim, so canonicalizing one side here would
        // reject a correct target that is not already realpath-canonical.
        if (!confirmed || confirmed.path !== operation.targetPath) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The worktree binding changed before removal.');
        await this.git.remove(gitProject, operation.targetPath!, request.discardChanges, task.sessionIds, this.signal);
        checkoutRemoved = true;
      }
      await this.update(taskId, operationId, (draft, current) => { draft.worktree = null; current.gitCompleted = true; });
    }

    const settled = this.host.read(taskId).task.operation!;
    const retainedPath = settled.retainedCheckoutPath;
    // A checkout recorded as retained was never removed, so it cannot count as removed
    // on a resumed execution either.
    const removedCheckout = checkoutRemoved || (settled.gitCompleted && settled.targetPath !== undefined && retainedPath === undefined && gitProject !== undefined);
    if (request.kind === 'remove') {
      if (request.force === true && removedCheckout) await this.markAffectedBindings(taskId, operation.targetPath!);
      await this.update(taskId, operationId, draft => { draft.operation = null; });
      return 'done';
    }

    for (const id of task.sessionIds) {
      const latest = this.host.read(taskId).task.operation!;
      if (latest.archivedSessionIds.includes(id)) continue;
      if (!await this.idle(taskId, operationId)) return 'waiting';
      await this.update(taskId, operationId, (_draft, current) => { current.phase = 'archiving'; });
      this.host.assertOpen();
      await this.sessions.archive(id);
      await this.update(taskId, operationId, (_draft, current) => { current.archivedSessionIds.push(id); });
    }
    this.host.assertOpen();
    const deleted = this.host.read(taskId);
    const affected = request.force === true && removedCheckout ? await this.affectedBindings(taskId, operation.targetPath!) : [];
    if (affected.length > 0) await this.markAffectedBindings(taskId, operation.targetPath!, affected);
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

  private async assertPreRemoval(taskId: string, task: Task, gitProject: GitProject | undefined, request: DestructiveRequest): Promise<void> {
    const target = task.worktree!.path;
    if (request.force === true) await this.assertNoActiveOperation(taskId, target);
    if (gitProject === undefined) return;
    await this.sharing.assertExclusive(taskId, target, { force: request.force === true });
    if (!await entryExists(target)) return;
    const tree = await this.git.inspect(gitProject, target, task.sessionIds);
    if (tree.dirty && !request.discardChanges) throw new KanbanError('DISCARD_REQUIRED', 'Explicit confirmation is required to discard local worktree changes.', { path: tree.path });
  }

  private async assertRemovalTarget(taskId: string, request: DestructiveRequest): Promise<void> {
    const operation = this.host.read(taskId).task.operation;
    if (!operation?.targetPath) throw new KanbanError('OPERATION_TARGET_CHANGED', 'The worktree target is unavailable.');
    if (request.force === true) await this.assertNoActiveOperation(taskId, operation.targetPath);
    await this.sharing.assertExclusive(taskId, operation.targetPath, { force: request.force === true });
  }

  /** Force must not remove a checkout another task is actively operating on. */
  private async assertNoActiveOperation(taskId: string, target: string): Promise<void> {
    const canonical = await canonicalPath(target, true);
    for (const other of this.store.allTasks()) {
      if (other.id === taskId) continue;
      const operation = other.operation;
      if (!operation || operation.phase === 'failed') continue;
      const candidates = [operation.targetPath, other.worktree?.path];
      if (operation.request.kind === 'create' || operation.request.kind === 'attach') candidates.push(operation.request.path);
      for (const candidate of candidates) {
        if (!candidate) continue;
        const resolved = await canonicalOrNull(candidate);
        if (!resolved) continue;
        if (containsPath(canonical, resolved) || containsPath(resolved, canonical)) {
          throw new KanbanError('OPERATION_PENDING', 'Another task is operating on this checkout. Wait for that operation to settle before forcing removal.', { taskId: other.id, taskTitle: other.title, path: canonical });
        }
      }
    }
  }

  private async markAffectedBindings(removedByTaskId: string, target: string, affected?: Array<{ taskId: string }>): Promise<void> {
    const entries = affected ?? await this.affectedBindings(removedByTaskId, target);
    if (entries.length === 0) return;
    const problem = this.removalProblem(removedByTaskId, target);
    // Each task may live in a different Hub aggregate; mark it through its own write chain.
    for (const entry of entries) {
      await this.store.transactTask(entry.taskId, state => {
        const other = state.tasks.find(item => item.id === entry.taskId);
        if (!other?.worktree) return;
        other.worktree = { ...other.worktree, status: 'error', error: problem };
        other.updatedAt = this.now();
      });
    }
  }

  private async affectedBindings(removedByTaskId: string, target: string): Promise<Array<{ taskId: string }>> {
    const canonical = await canonicalPath(target, true);
    const affected: Array<{ taskId: string }> = [];
    for (const other of this.store.allTasks()) {
      if (other.id === removedByTaskId || !other.worktree) continue;
      const otherPath = await canonicalOrNull(other.worktree.path);
      if (!otherPath) continue;
      if (containsPath(canonical, otherPath) || containsPath(otherPath, canonical)) affected.push({ taskId: other.id });
    }
    return affected;
  }

  private removalProblem(removedByTaskId: string, target: string) {
    return { code: 'WORKTREE_REMOVED', message: 'This checkout was removed by another task\'s forced deletion.', details: { removedByTaskId, path: target } };
  }

  private async idle(taskId: string, operationId: string): Promise<boolean> {
    this.host.assertOpen();
    const { task } = this.host.read(taskId);
    const idle = (await Promise.all(task.sessionIds.map(id => this.sessions.isIdle(id)))).every(Boolean);
    if (!idle) await this.update(taskId, operationId, (_task, operation) => {
      if (operation.phase === 'git' && !operation.gitCompleted) operation.error = { code: 'RECOVERY_PENDING', message: 'Waiting to inspect the previously started Git operation.', details: { failedPhase: 'git', gitAttempted: !!operation.createAttempt } };
      operation.phase = 'waiting';
    });
    return idle;
  }
}
