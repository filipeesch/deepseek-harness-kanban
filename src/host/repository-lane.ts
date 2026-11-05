import { isGitProject } from '../shared/project.js';
import type { Project } from '../shared/types.js';

/**
 * Destructive work serializes per repository, not per board: Git worktree
 * metadata, removal, and the repository lock are per repository, while native
 * archiving and workspace deletion act on distinct sessions and workspaces.
 * A project without a Git root has no shared Git metadata, so it keeps its own
 * lane and never waits behind an unrelated repository.
 */
export function repositoryLane(project: Project): string {
  return isGitProject(project) ? project.gitRootPath : 'project:' + project.id;
}
