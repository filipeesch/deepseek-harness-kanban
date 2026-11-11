import { KanbanError } from '../shared/errors.js';
import { requireGitProject } from '../shared/project.js';
import type { GitPort, GitRepository } from '../shared/ports.js';
import type { Task } from '../shared/types.js';
import type { DeletionPlan, DestructiveRequest } from './checkout-preflight.js';
import type { DestructiveJournal } from './destructive-journal.js';
import type { TaskBindingIndex } from './task-binding-index.js';
import type { WorktreeSharingGuard } from './worktree-sharing.js';

export interface CheckoutRemovalDependencies {
  git: Pick<GitPort, 'remove' | 'assertRemovable' | 'assertPolicy'>;
  sharing: WorktreeSharingGuard;
  index: TaskBindingIndex;
  journal: DestructiveJournal;
  signal: AbortSignal;
}

export interface CheckoutRemovalInput {
  task: Task;
  request: DestructiveRequest;
  operationId: string;
  plan: DeletionPlan;
  repository: GitRepository;
}

/**
 * Executes the checkout removal a preflight plan authorized. Preparation repeats
 * the refusals that the host can invalidate at any moment — another task's
 * operation and a newly shared checkout — and journals the removal phase before
 * the Git command runs, so a refusal still leaves the task untouched.
 */
export class CheckoutRemoval {
  constructor(private readonly dependencies: CheckoutRemovalDependencies) {}

  async prepare(input: CheckoutRemovalInput): Promise<void> {
    const target = input.plan.removalTarget;
    if (target === undefined) return;
    // The persisted binding must still describe the persisted target before either
    // teardown step mutates anything.
    this.assertConfirmedTarget();
    // The phase is journaled before the refusals so a refusal is reported from the
    // step that produced it, and a checkout shared after the preflight is still caught.
    await this.dependencies.journal.update(input.operationId, (_task, operation) => { operation.phase = 'removing'; });
    this.dependencies.journal.assertOpen();
    if (input.request.force === true) {
      const active = await this.dependencies.index.activeOperations(target, input.task.id);
      if (active.length > 0) {
        const other = active[0]!;
        throw new KanbanError('OPERATION_PENDING', 'Another task is operating on this checkout. Wait for that operation to settle before forcing removal.', { taskId: other.taskId, taskTitle: other.title, path: other.path });
      }
    }
    await this.dependencies.sharing.assertExclusive(input.task.id, target, { force: input.request.force === true });
    // The checkout must still be removable before archiving can start.
    const project = requireGitProject(this.dependencies.journal.read().project);
    await this.dependencies.git.assertRemovable(project, target, input.task.sessionIds, input.repository);
    // The write policy is a refusal too: proving it here keeps a denied removal from
    // archiving first. The removal still re-proves it immediately before Git.
    await this.dependencies.git.assertPolicy(project, [input.repository.commonDirectory, target], input.task.sessionIds, true);
    // Any awaited refusal above can observe a binding that changed meanwhile, and the
    // archiving that follows cannot be undone, so the binding is compared again here.
    this.assertConfirmedTarget();
    this.dependencies.journal.assertOpen();
  }

  /** Compare the persisted binding with the persisted target, verbatim as admission recorded it. */
  private assertConfirmedTarget(): void {
    const { task } = this.dependencies.journal.read();
    const operation = task.operation;
    if (!operation) throw new KanbanError('OPERATION_CHANGED', 'The deletion operation changed.');
    if (!task.worktree || task.worktree.path !== operation.targetPath) {
      throw new KanbanError('OPERATION_TARGET_CHANGED', 'The worktree binding changed before removal.');
    }
  }

  /** Remove the confirmed checkout; returns whether this execution removed it. */
  async run(input: CheckoutRemovalInput): Promise<boolean> {
    const target = input.plan.removalTarget;
    if (target === undefined) return false;
    this.assertConfirmedTarget();
    this.dependencies.journal.assertOpen();
    const { task, project } = this.dependencies.journal.read();
    await this.dependencies.git.remove(requireGitProject(project), target, input.request.discardChanges, task.sessionIds, this.dependencies.signal, input.repository, { verifiedClean: input.plan.verifiedClean === true });
    await this.dependencies.journal.update(input.operationId, (draft, operation) => {
      draft.worktree = null;
      operation.gitCompleted = true;
      // The checkout step finished, so the still-running archiving now owns the phase.
      if (input.request.kind === 'delete' && draft.sessionIds.some(sessionId => !operation.archivedSessionIds.includes(sessionId))) operation.phase = 'archiving';
    });
    return true;
  }
}
