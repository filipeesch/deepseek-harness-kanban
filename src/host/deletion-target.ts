import { KanbanError } from '../shared/errors.js';
import { isGitProject } from '../shared/project.js';
import type { GitPort } from '../shared/ports.js';
import type { Project, RetainedCheckoutReason, Task } from '../shared/types.js';

/** What a deletion does with the task's checkout binding. */
export type CheckoutDisposition = 'remove' | 'retain' | 'none';

export interface DeletionTarget {
  /** The directory conversations return to first; absent means no directory change is needed. */
  directoryTarget?: string;
  /**
   * `remove` deletes the checkout through Git, `retain` leaves an unverifiable
   * checkout on disk, and `none` means the deletion owns no removable checkout.
   */
  checkout: CheckoutDisposition;
  /** The checkout path left on disk when the disposition is `retain`. */
  retainedPath?: string;
  /** Why the checkout is kept on disk; present exactly when the disposition is `retain`. */
  retainReason?: RetainedCheckoutReason;
}

export interface DeletionTargetInput {
  task: Task;
  project: Project;
  git: Pick<GitPort, 'projectDirectory'>;
}

/**
 * Decides how a deletion reconciles the task directory. A task without a worktree
 * needs no base resolution, and an unavailable project context retains the checkout
 * instead of failing the deletion: the host cannot verify or return what is gone.
 */
export async function resolveDeletionTarget(input: DeletionTargetInput): Promise<DeletionTarget> {
  const { task, project, git } = input;
  if (!task.worktree) return { checkout: 'none' };
  // A folder project keeps its plain checkout, and the deletion reports it as retained.
  if (!isGitProject(project)) return { checkout: 'retain', retainedPath: task.worktree.path, retainReason: 'folder' };
  try {
    return { directoryTarget: await git.projectDirectory(project), checkout: 'remove' };
  } catch (error) {
    if (error instanceof KanbanError && (error.code === 'PATH_UNAVAILABLE' || error.code === 'INVALID_PATH')) {
      return { checkout: 'retain', retainedPath: task.worktree.path, retainReason: 'unresolved' };
    }
    throw error;
  }
}
