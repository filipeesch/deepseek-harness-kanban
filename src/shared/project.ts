import { KanbanError } from './errors.js';
import type { GitProject, Project } from './types.js';

/** A project is Git-backed exactly when it carries a non-empty Git root. */
export function isGitProject(project: Project): project is GitProject {
  return typeof project.gitRootPath === 'string' && project.gitRootPath.length > 0;
}

/** Narrow at the Git boundary; folder projects never reach a Git or worktree operation. */
export function requireGitProject(project: Project): GitProject {
  if (!isGitProject(project)) {
    throw new KanbanError('PROJECT_NOT_GIT', 'This project is not a Git repository; Git and worktree actions are unavailable.', { projectId: project.id });
  }
  return project;
}
