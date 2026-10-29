import { invariant } from '../shared/errors.js';
import type { Project, ProjectInput } from '../shared/types.js';

/** The task facts that make a Git-association change unsafe while work is in flight. */
export interface ProjectRegistrationTask {
  projectId: string;
  operation?: unknown;
  pendingTransition?: { worktreeRequest?: unknown } | undefined;
}

export interface ProjectRegistrationState {
  projects: Project[];
  tasks: ProjectRegistrationTask[];
}

/** A blank Git root means the project is a folder project, never an empty path. */
export function projectGitRoot(input: ProjectInput): string | undefined {
  if (input.gitRootPath === undefined) return undefined;
  invariant(typeof input.gitRootPath === 'string', 'INVALID_INPUT', 'Git root must be text.');
  const value = input.gitRootPath.trim();
  return value.length > 0 ? value : undefined;
}

/**
 * Registration may add or remove a project's Git association without changing its
 * project path. A path change or a different Git root still requires the project to
 * have no tasks, and a kind change waits for in-flight worktree work.
 */
export function assertProjectConversion(state: ProjectRegistrationState, projectId: string, input: ProjectInput): void {
  const current = state.projects.find(project => project.id === projectId);
  if (!current) return;
  const nextGitRoot = projectGitRoot(input);
  const pathChanged = current.projectPath !== input.projectPath;
  const rootChanged = current.gitRootPath !== undefined && nextGitRoot !== undefined && current.gitRootPath !== nextGitRoot;
  const kindChanged = (current.gitRootPath === undefined) !== (nextGitRoot === undefined);
  const tasks = state.tasks.filter(task => task.projectId === projectId);
  if (pathChanged || rootChanged) {
    invariant(tasks.length === 0, 'PROJECT_IN_USE', 'Project paths cannot change while tasks reference the project.');
  }
  if (kindChanged) {
    const busy = tasks.some(task => (task.operation !== undefined && task.operation !== null) || task.pendingTransition?.worktreeRequest !== undefined);
    invariant(!busy, 'PROJECT_BUSY', 'Wait for worktree work in this project to finish before changing its Git association.');
  }
}

/** Build the stored project, discarding a default branch that has no Git root to belong to. */
export function buildProject(projectId: string, input: ProjectInput, current?: Project): Project {
  const gitRootPath = projectGitRoot(input);
  const project: Project = {
    id: projectId, name: input.name.trim(), projectPath: input.projectPath,
    ...(gitRootPath === undefined ? {} : { gitRootPath }),
    ...(current?.workspaceId ? { workspaceId: current.workspaceId } : {}),
    ...(current?.workspaceOwned !== undefined ? { workspaceOwned: current.workspaceOwned } : {}),
  };
  if (gitRootPath !== undefined && input.defaultBranch !== undefined) {
    invariant(typeof input.defaultBranch === 'string', 'INVALID_INPUT', 'Default branch must be text.');
    if (input.defaultBranch.trim()) project.defaultBranch = input.defaultBranch.trim();
  }
  return project;
}
