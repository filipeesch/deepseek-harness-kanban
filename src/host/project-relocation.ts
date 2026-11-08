import { randomUUID } from 'node:crypto';
import { KanbanError, invariant, problem } from '../shared/errors.js';
import { isGitProject } from '../shared/project.js';
import type { GitPort, SessionPort } from '../shared/ports.js';
import type { Project, ProjectInput, ProjectLocationPaths, ProjectRelocation, ProjectRelocationPhase, Task } from '../shared/types.js';
import { planProjectRelocation } from '../domain/project-registration.js';
import { repositoryLane } from './repository-lane.js';
import type { OperationQueue } from './operation-queue.js';
import type { ProjectRelocationStore } from './project-relocation-store.js';

/** Narrows the coordinator to the one workspace action a relocation needs. */
export interface ProjectWorkspaceBinder {
  bind(hubId: string, project: Project): Promise<void>;
}

export interface ProjectRelocationOptions {
  /** Shared with the worktree coordinator so both serialize per repository. */
  queue: OperationQueue;
  workspaces?: ProjectWorkspaceBinder;
  signal?: AbortSignal;
  id?: () => string;
  now?: () => string;
  report?: (error: unknown) => void;
}

type RelocationTarget = ProjectInput & { id: string };
type WorktreeUpdate = { branch: string; target: string } | { error: ReturnType<typeof problem> };

/** Steps that may still be cancelled because no durable project or task change was applied. */
const CANCELLABLE: ReadonlySet<ProjectRelocationPhase> = new Set(['queued', 'preflight', 'waiting']);

function fromProject(project: Project): ProjectLocationPaths {
  return {
    projectPath: project.projectPath,
    ...(project.gitRootPath === undefined ? {} : { gitRootPath: project.gitRootPath }),
    ...(project.defaultBranch === undefined ? {} : { defaultBranch: project.defaultBranch }),
  };
}

function toLocation(input: RelocationTarget): ProjectLocationPaths & { name: string } {
  const gitRootPath = typeof input.gitRootPath === 'string' && input.gitRootPath.trim() ? input.gitRootPath.trim() : undefined;
  return {
    name: input.name.trim(),
    projectPath: input.projectPath,
    ...(gitRootPath === undefined ? {} : { gitRootPath }),
    ...(gitRootPath !== undefined && input.defaultBranch !== undefined && input.defaultBranch.trim() ? { defaultBranch: input.defaultBranch.trim() } : {}),
  };
}

function sameLocation(left: ProjectLocationPaths, right: ProjectLocationPaths): boolean {
  return left.projectPath === right.projectPath && left.gitRootPath === right.gitRootPath;
}

function assertKindPreserved(project: Project, input: RelocationTarget): void {
  const targetIsGit = typeof input.gitRootPath === 'string' && input.gitRootPath.trim().length > 0;
  invariant((project.gitRootPath !== undefined) === targetIsGit, 'PROJECT_ASSOCIATION_CHANGE', 'Adding or removing a Git association is a project save, not a relocation.');
}

function hasUnresolvedTaskWork(tasks: Task[]): boolean {
  return tasks.some(task => task.operation !== null || task.pendingTransition !== undefined);
}

function assertTasksIdle(tasks: Task[]): void {
  invariant(tasks.every(task => task.operation === null), 'PROJECT_BUSY', 'Resolve the context operation of every task in this project before relocating it.');
  invariant(tasks.every(task => task.pendingTransition === undefined), 'PROJECT_BUSY', 'Resolve the confirmed transition of every task in this project before relocating it.');
}

/**
 * Owns the durable project relocation: persisted-state admission, the journal,
 * the per-repository lane job, conversation migration, workspace rebinding, and
 * worktree repair and revalidation. It never schedules itself and never runs on
 * the interactive command path.
 */
export class ProjectRelocationCoordinator {
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private readonly id: () => string;
  private readonly now: () => string;
  private disposed = false;

  constructor(
    private readonly store: ProjectRelocationStore,
    private readonly sessions: SessionPort,
    private readonly git: GitPort,
    private readonly options: ProjectRelocationOptions,
  ) {
    this.signal = options.signal ? AbortSignal.any([this.controller.signal, options.signal]) : this.controller.signal;
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  dispose(): void { this.disposed = true; this.controller.abort(); }

  async settle(): Promise<void> { await this.options.queue.settle(); }

  /** Validate and record the relocation from persisted state, then hand it to its lane. */
  async request(input: RelocationTarget, expectedRevision?: number): Promise<Project> {
    this.assertOpen();
    const { project } = this.store.locate(input.id);
    assertKindPreserved(project, input);
    const target = toLocation(input);
    const recorded = project.operation;
    if (recorded) {
      if (sameLocation(recorded.request.to, target)) {
        // Re-submitting the same target is a retry for a failed journal, not a new operation.
        if (recorded.phase === 'failed') {
          await this.update(input.id, recorded.id, (_project, current) => { current.phase = 'queued'; delete current.error; });
          this.enqueue(this.store.locate(input.id).project, recorded.id);
        }
        return project;
      }
      throw new KanbanError('CONTEXT_OPERATION_PENDING', 'Resolve the recorded project relocation before starting a different one.', { projectId: project.id, target: recorded.request.to });
    }
    invariant(!sameLocation(fromProject(project), target), 'NO_LOCATION_CHANGE', 'Change the project path or Git root to relocate it; save the project for a name or branch change.');
    assertTasksIdle(this.store.tasksOf(input.id));
    const operation: ProjectRelocation = {
      id: this.id(),
      request: { from: fromProject(project), to: target },
      phase: 'queued',
      migratedSessionIds: [],
      started: false,
      createdAt: this.now(),
    };
    const value = await this.store.transact(input.id, draft => {
      const current = draft.projects.find(candidate => candidate.id === input.id);
      invariant(current, 'PROJECT_NOT_FOUND', 'The project does not exist.');
      invariant(!current.operation, 'CONTEXT_OPERATION_PENDING', 'Another relocation was recorded first.');
      current.operation = operation;
      return structuredClone(current);
    }, expectedRevision);
    this.enqueue(value, operation.id);
    return value;
  }

  async retry(projectId: string): Promise<void> {
    this.assertOpen();
    const { project } = this.store.locate(projectId);
    const operation = project.operation;
    invariant(operation, 'NO_OPERATION', 'There is no project relocation to retry.');
    invariant(operation.phase === 'failed', 'RELOCATION_NOT_FAILED', 'Only a failed relocation can be retried.');
    const value = await this.update(projectId, operation.id, (_project, current) => {
      current.phase = 'queued';
      delete current.error;
    }).then(() => this.store.locate(projectId).project);
    this.enqueue(value, operation.id);
  }

  async cancel(projectId: string): Promise<void> {
    this.assertOpen();
    const { project } = this.store.locate(projectId);
    const operation = project.operation;
    invariant(operation, 'NO_OPERATION', 'There is no project relocation to cancel.');
    invariant(CANCELLABLE.has(operation.phase) && !operation.started, 'RELOCATION_STARTED', 'This relocation has already started and cannot be cancelled.');
    await this.store.transact(projectId, draft => {
      const value = draft.projects.find(candidate => candidate.id === projectId);
      if (value?.operation?.id === operation.id) delete value.operation;
    });
  }

  /** Called at startup and by native activity events; the queue deduplicates a repeated job. */
  async resumePending(): Promise<void> {
    if (this.disposed || this.signal.aborted) return;
    for (const projectId of this.store.pendingProjectIds()) {
      const { project } = this.store.locate(projectId);
      const operation = project.operation;
      if (!operation || operation.phase === 'failed') continue;
      this.enqueue(project, operation.id);
    }
  }

  private enqueue(project: Project, operationId: string): void {
    this.options.queue.enqueue({ lane: repositoryLane(project), ownerId: project.id, operationId, run: () => this.drive(project.id, operationId) });
  }

  private async drive(projectId: string, operationId: string): Promise<void> {
    try {
      this.assertOpen();
      this.recorded(projectId, operationId);
      await this.setPhase(projectId, operationId, 'preflight');
      // The authoritative preflight re-reads task work: a stage transition admitted while
      // the relocation waited defers it instead of migrating under the change.
      if (hasUnresolvedTaskWork(this.store.tasksOf(projectId))) { await this.setPhase(projectId, operationId, 'waiting'); return; }
      if (!await this.everyConversationIdle(projectId)) { await this.setPhase(projectId, operationId, 'waiting'); return; }
      await this.migrate(projectId, operationId);
      await this.revalidateWorktrees(projectId, operationId);
      if (!await this.migrateConversations(projectId, operationId)) return;
      await this.bindWorkspace(projectId, operationId);
      await this.complete(projectId, operationId);
    } catch (error) {
      await this.recordFailure(projectId, operationId, error);
    }
  }

  private async everyConversationIdle(projectId: string): Promise<boolean> {
    for (const task of this.store.tasksOf(projectId)) {
      for (const sessionId of task.sessionIds) {
        if (!await this.sessions.isIdle(sessionId)) return false;
      }
    }
    return true;
  }

  private async migrate(projectId: string, operationId: string): Promise<void> {
    const project = this.recorded(projectId, operationId);
    const { from, to } = project.operation!.request;
    if (project.projectPath === to.projectPath && project.gitRootPath === to.gitRootPath) {
      // A retry after the location was committed still applies the submitted metadata.
      await this.update(projectId, operationId, (value, operation) => {
        value.name = to.name;
        if (to.gitRootPath === undefined) delete value.gitRootPath; else value.gitRootPath = to.gitRootPath;
        if (to.defaultBranch === undefined) delete value.defaultBranch; else value.defaultBranch = to.defaultBranch;
        operation.started = true;
      });
      await this.setPhase(projectId, operationId, 'migrating');
      return;
    }
    invariant(project.projectPath === from.projectPath && project.gitRootPath === from.gitRootPath, 'CONTEXT_CHANGED', 'The project location changed while the relocation was pending.');
    await this.setPhase(projectId, operationId, 'migrating');
    this.assertRecorded(projectId, operationId);
    const plan = planProjectRelocation(from, to, this.store.tasksOf(projectId).map(task => ({ id: task.id, effectiveCwd: task.effectiveCwd, worktree: task.worktree })));
    await this.store.transact(projectId, draft => {
      const value = draft.projects.find(candidate => candidate.id === projectId);
      invariant(value?.operation?.id === operationId, 'OPERATION_CHANGED', 'The relocation changed before the project could move.');
      invariant(value.projectPath === from.projectPath && value.gitRootPath === from.gitRootPath, 'CONTEXT_CHANGED', 'The project location changed before it could move.');
      value.name = to.name;
      value.projectPath = to.projectPath;
      if (to.gitRootPath === undefined) delete value.gitRootPath; else value.gitRootPath = to.gitRootPath;
      if (to.defaultBranch === undefined) delete value.defaultBranch; else value.defaultBranch = to.defaultBranch;
      value.operation.started = true;
      for (const change of plan.tasks) {
        const task = draft.tasks.find(candidate => candidate.id === change.taskId);
        if (task && task.effectiveCwd === change.from) task.effectiveCwd = change.to;
      }
    });
  }

  private async revalidateWorktrees(projectId: string, operationId: string): Promise<void> {
    const project = this.recorded(projectId, operationId);
    await this.setPhase(projectId, operationId, 'worktrees');
    const tasks = this.store.tasksOf(projectId);
    if (!isGitProject(project)) return;
    const { from, to } = project.operation!.request;
    const plan = planProjectRelocation(from, to, tasks.map(task => ({ id: task.id, effectiveCwd: task.effectiveCwd, worktree: task.worktree })));
    if (plan.worktrees.length === 0) return;
    const byId = new Map(tasks.map(task => [task.id, task]));
    const updates = new Map<string, WorktreeUpdate>();
    for (const planned of plan.worktrees) {
      const task = byId.get(planned.taskId);
      if (!task?.worktree) continue;
      this.assertRecorded(projectId, operationId);
      // Repair with this checkout's own conversation policies. A task without a
      // conversation skips the repair rather than widening to the host write policy.
      if (task.sessionIds.length > 0) {
        try { await this.git.repair(project, [task.worktree.path], task.sessionIds, this.signal); }
        catch (error) { this.options.report?.(error); }
      }
      this.assertRecorded(projectId, operationId);
      try {
        const tree = await this.git.inspect(project, task.worktree.path, task.sessionIds);
        updates.set(task.id, { branch: tree.branch, target: await this.git.projectDirectory(project, task.worktree.path) });
      } catch (error) {
        updates.set(task.id, { error: problem(error) });
      }
    }
    await this.store.transact(projectId, draft => {
      const value = draft.projects.find(candidate => candidate.id === projectId);
      invariant(value?.operation?.id === operationId, 'OPERATION_CHANGED', 'The relocation changed before its worktrees could be recorded.');
      for (const [taskId, update] of updates) {
        const task = draft.tasks.find(candidate => candidate.id === taskId);
        if (!task?.worktree) continue;
        if ('error' in update) { task.worktree = { ...task.worktree, status: 'error', error: update.error }; continue; }
        task.worktree = { ...task.worktree, branch: update.branch, status: 'ready' };
        delete task.worktree.error;
        task.effectiveCwd = update.target;
      }
    });
  }

  /** Returns false when a busy conversation moved the relocation back to waiting. */
  private async migrateConversations(projectId: string, operationId: string): Promise<boolean> {
    let recorded = this.recorded(projectId, operationId);
    await this.setPhase(projectId, operationId, 'sessions');
    for (const task of this.store.tasksOf(projectId)) {
      for (const sessionId of task.sessionIds) {
        if (recorded.operation!.migratedSessionIds.includes(sessionId)) continue;
        if (!await this.sessions.isIdle(sessionId)) { await this.setPhase(projectId, operationId, 'waiting'); return false; }
        this.assertRecorded(projectId, operationId);
        if (await this.sessions.directory(sessionId) !== task.effectiveCwd) await this.sessions.setDirectory(sessionId, task.effectiveCwd, this.signal);
        await this.update(projectId, operationId, (_project, operation) => {
          if (!operation.migratedSessionIds.includes(sessionId)) operation.migratedSessionIds.push(sessionId);
        });
        recorded = this.recorded(projectId, operationId);
      }
    }
    return true;
  }

  private async bindWorkspace(projectId: string, operationId: string): Promise<void> {
    this.assertRecorded(projectId, operationId);
    await this.setPhase(projectId, operationId, 'workspace');
    const { hubId, project } = this.store.locate(projectId);
    await this.options.workspaces?.bind(hubId, project);
  }

  private async complete(projectId: string, operationId: string): Promise<void> {
    await this.store.transact(projectId, draft => {
      const value = draft.projects.find(candidate => candidate.id === projectId);
      if (value?.operation?.id === operationId) delete value.operation;
    });
  }

  private setPhase(projectId: string, operationId: string, phase: ProjectRelocationPhase): Promise<void> {
    return this.update(projectId, operationId, (_project, operation) => { operation.phase = phase; });
  }

  private update(projectId: string, operationId: string, change: (project: Project, operation: ProjectRelocation) => void): Promise<void> {
    return this.store.transact(projectId, draft => {
      const value = draft.projects.find(candidate => candidate.id === projectId);
      invariant(value, 'PROJECT_NOT_FOUND', 'The project does not exist.');
      invariant(value.operation?.id === operationId, 'OPERATION_CHANGED', 'The project relocation changed while it was being coordinated.');
      change(value, value.operation);
    });
  }

  private recorded(projectId: string, operationId: string): Project {
    const { project } = this.store.locate(projectId);
    invariant(project.operation?.id === operationId, 'OPERATION_CHANGED', 'The project relocation is no longer recorded.');
    return project;
  }

  private assertRecorded(projectId: string, operationId: string): void {
    this.recorded(projectId, operationId);
  }

  private assertOpen(): void {
    if (this.disposed || this.signal.aborted) throw new KanbanError('OPERATION_ABORTED', 'The project relocation was interrupted.');
  }

  private async recordFailure(projectId: string, operationId: string, error: unknown): Promise<void> {
    const aborted = this.disposed || this.signal.aborted;
    try {
      await this.store.transact(projectId, draft => {
        const value = draft.projects.find(candidate => candidate.id === projectId);
        const operation = value?.operation;
        if (!operation || operation.id !== operationId) return;
        if (aborted) {
          // Shutdown is not terminal: keep the journal resumable at its next run.
          operation.phase = 'queued';
          delete operation.error;
          return;
        }
        const failure = problem(error);
        operation.error = { ...failure, details: { ...failure.details, failedPhase: operation.phase } };
        operation.phase = 'failed';
      });
    } catch (failure) {
      this.options.report?.(failure);
    }
    if (!aborted) this.options.report?.(error);
  }
}
