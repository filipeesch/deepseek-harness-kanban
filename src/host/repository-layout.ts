import path from 'node:path';
import { KanbanError } from '../shared/errors.js';

/** Whether a candidate path is the root itself or lives under it. */
export function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

/** The repository facts a worktree target must be checked against. */
export interface RepositoryTargets {
  readonly root: string;
  readonly projectPath: string;
  readonly commonDirectory: string;
}

/**
 * The one worktree target rule: a target must never be the base project, the Git
 * root, an ancestor of either, or the Git metadata directory.
 */
export function assertWorktreeTarget(targets: RepositoryTargets, target: string): void {
  const { root, projectPath, commonDirectory } = targets;
  if (containsPath(target, root) || containsPath(target, projectPath) || containsPath(commonDirectory, target) || containsPath(target, commonDirectory)) {
    throw new KanbanError('UNSAFE_WORKTREE_TARGET', 'The worktree target must not be the base project, Git root, their ancestor, or Git metadata.', { path: target });
  }
}

/** The project's subdirectory inside one checkout, preserved for a monorepo project. */
export function projectSubdirectory(root: string, projectPath: string, worktreeRoot: string): string {
  return path.join(worktreeRoot, path.relative(root, projectPath));
}
