import { KanbanError } from '../shared/errors.js';
import { isGitProject, requireGitProject } from '../shared/project.js';
import type { GitPort, GitRepository } from '../shared/ports.js';
import type { ContextOperation, Project, Task } from '../shared/types.js';
import { resolveDeletionTarget, type DeletionTarget } from './deletion-target.js';
import type { TaskBindingIndex } from './task-binding-index.js';
import type { WorktreeSharingGuard } from './worktree-sharing.js';

export type DestructiveRequest = Extract<ContextOperation['request'], { kind: 'delete' | 'remove' }>;

/** The decision one execution's checkout preflight reaches before anything is touched. */
export interface DeletionPlan extends DeletionTarget {
  /** The confirmed checkout the plan removes, when the task has one. */
  readonly removalTarget?: string;
  /** The preflight itself read the working tree and found no local changes. */
  readonly verifiedClean?: boolean;
}

export interface CheckoutPreflightDependencies {
  git: Pick<GitPort, 'projectDirectory' | 'localChanges' | 'assertRemovable'>;
  sharing: WorktreeSharingGuard;
  index: TaskBindingIndex;
}

export interface CheckoutPreflightInput {
  task: Task;
  project: Project;
  request: DestructiveRequest;
  /** Resolved repository facts, present when the task has a removable checkout. */
  repository?: GitRepository;
}

/**
 * The one authoritative checkout preflight. It reaches every refusal a
 * destructive operation needs — checkout sharing, another task's active
 * operation, and local changes still requiring consent — in a single pass, and
 * returns the plan the removal executes. The sharing refusal is evaluated again
 * immediately before removal by the removal step itself, because the host may
 * report a new user of the checkout at any point.
 */
export class CheckoutPreflight {
  constructor(private readonly dependencies: CheckoutPreflightDependencies) {}

  async plan(input: CheckoutPreflightInput): Promise<DeletionPlan> {
    const { task, project, request } = input;
    const disposition = request.kind === 'delete'
      ? await resolveDeletionTarget({ task, project, git: this.dependencies.git })
      : { directoryTarget: isGitProject(project) ? await this.dependencies.git.projectDirectory(project) : undefined, checkout: 'remove' as const };
    if (!task.worktree || disposition.checkout !== 'remove') return disposition;
    const target = request.expectedWorktreePath ?? task.worktree.path;
    if (request.force === true) await this.assertNoForeignOperation(task.id, target);
    await this.dependencies.sharing.assertExclusive(task.id, target, { force: request.force === true });
    // Without resolved repository facts the removal cannot be proven safe here, so
    // the plan retires it: the checkout is retained rather than removed.
    if (input.repository === undefined) return disposition;
    // Every refusal the removal itself would raise is decided here, because the
    // teardown starts archiving conversations and archiving cannot be undone.
    const gitProject = requireGitProject(project);
    await this.dependencies.git.assertRemovable(gitProject, target, task.sessionIds, input.repository);
    // Discard consent already decides the outcome, so the local-change scan is
    // only read when it can still refuse the removal.
    if (request.discardChanges) return { ...disposition, removalTarget: target, verifiedClean: false };
    if (await this.dependencies.git.localChanges(gitProject, target, task.sessionIds, input.repository)) {
      throw new KanbanError('DISCARD_REQUIRED', 'Explicit confirmation is required to discard local worktree changes.', { path: target });
    }
    return { ...disposition, removalTarget: target, verifiedClean: true };
  }

  /** Force must not remove a checkout another task is actively operating on. */
  private async assertNoForeignOperation(taskId: string, target: string): Promise<void> {
    const active = await this.dependencies.index.activeOperations(target, taskId);
    if (active.length === 0) return;
    const other = active[0]!;
    throw new KanbanError('OPERATION_PENDING', 'Another task is operating on this checkout. Wait for that operation to settle before forcing removal.', { taskId: other.taskId, taskTitle: other.title, path: other.path });
  }
}
