import { KanbanError } from './errors.js';
import type { GitProject, Project, PublishedProject, RegisteredProject } from './types.js';

/** A project that exists only because a received board names its key; it has no directory yet. */
export function isPublishedProject(project: Project): project is PublishedProject {
  return project.origin === 'published';
}

/** Narrow to a project that owns a directory; placeholders never reach a path-dependent operation. */
export function isRegisteredProject(project: Project): project is RegisteredProject {
  return project.origin !== 'published';
}

/** A project is Git-backed exactly when it is registered and carries a non-empty Git root. */
export function isGitProject(project: Project): project is GitProject {
  return isRegisteredProject(project) && typeof project.gitRootPath === 'string' && project.gitRootPath.length > 0;
}

/** A placeholder is unusable until adopted; the failure names adoption instead of exposing an empty path. */
export function requireRegisteredProject(project: Project): RegisteredProject {
  if (isPublishedProject(project)) {
    throw new KanbanError('PROJECT_NOT_ADOPTED', 'Adopt this published project by choosing its directory before using it.', { projectId: project.id, projectKey: project.projectKey });
  }
  return project;
}

/** The directory a registered project's tasks use. */
export function requireProjectPath(project: Project): string {
  return requireRegisteredProject(project).projectPath;
}

/** Narrow at the Git boundary; folder projects and placeholders never reach a Git or worktree operation. */
export function requireGitProject(project: Project): GitProject {
  if (!isGitProject(project)) {
    throw new KanbanError('PROJECT_NOT_GIT', 'This project is not a Git repository; Git and worktree actions are unavailable.', { projectId: project.id });
  }
  return project;
}
