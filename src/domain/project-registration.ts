import path from 'node:path';
import { KanbanError, invariant } from '../shared/errors.js';
import type { Project, ProjectInput, ProjectLocationPaths, RegisteredProject } from '../shared/types.js';
import { allocateProjectKey, requireProjectKey } from './project-key.js';

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

/** One task's directory facts the relocation plan reads. */
export interface RelocationTask {
  id: string;
  effectiveCwd: string;
  worktree: { path: string } | null;
}

export interface ProjectRelocationPlan {
  /** Tasks that move from the previous base project path to the new one. */
  tasks: Array<{ taskId: string; from: string; to: string }>;
  /** Tasks whose checkout is kept and whose equivalent project subdirectory is recomputed. */
  worktrees: Array<{ taskId: string; worktreePath: string; target: string }>;
}

/** A blank Git root means the project is a folder project, never an empty path. */
export function projectGitRoot(input: ProjectInput): string | undefined {
  if (input.gitRootPath === undefined) return undefined;
  invariant(typeof input.gitRootPath === 'string', 'INVALID_INPUT', 'Git root must be text.');
  const value = input.gitRootPath.trim();
  return value.length > 0 ? value : undefined;
}

function busyTasks(state: ProjectRegistrationState, projectId: string): ProjectRegistrationTask[] {
  return state.tasks.filter(task => task.projectId === projectId);
}

/**
 * Adding or removing a project's Git association is a registration change: it
 * waits for in-flight worktree work but does not depend on the project path.
 */
export function assertProjectAssociationChange(state: ProjectRegistrationState, projectId: string, input: ProjectInput): void {
  const current = state.projects.find(project => project.id === projectId);
  if (!current) return;
  const nextGitRoot = projectGitRoot(input);
  const kindChanged = (current.gitRootPath === undefined) !== (nextGitRoot === undefined);
  if (!kindChanged) return;
  const busy = busyTasks(state, projectId).some(task => (task.operation !== undefined && task.operation !== null) || task.pendingTransition?.worktreeRequest !== undefined);
  invariant(!busy, 'PROJECT_BUSY', 'Wait for worktree work in this project to finish before changing its Git association.');
}

/**
 * A registration save never moves a project location: a changed project path or
 * Git root with tasks is a relocation, and a project without tasks may be saved
 * in place.
 */
export function assertProjectLocationUnchanged(state: ProjectRegistrationState, projectId: string, input: ProjectInput): void {
  const current = state.projects.find(project => project.id === projectId);
  if (!current) return;
  const nextGitRoot = projectGitRoot(input);
  const pathChanged = current.projectPath !== input.projectPath;
  const rootChanged = current.gitRootPath !== undefined && nextGitRoot !== undefined && current.gitRootPath !== nextGitRoot;
  if (!pathChanged && !rootChanged) return;
  invariant(busyTasks(state, projectId).length === 0, 'PROJECT_IN_USE', 'Changing a project location with tasks requires a project relocation.');
}

/** The full registration save policy: no location move, no association change while busy, no pending relocation. */
export function assertProjectSave(state: ProjectRegistrationState, projectId: string, input: ProjectInput): void {
  const current = state.projects.find(project => project.id === projectId);
  if (!current) return;
  invariant(!current.operation, 'PROJECT_BUSY', 'Resolve the recorded project relocation before saving the project.');
  assertProjectLocationUnchanged(state, projectId, input);
  assertProjectAssociationChange(state, projectId, input);
}

/**
 * The pure relocation plan. It never resolves a directory or inspects Git: it maps
 * the recorded previous location and the confirmed target to the directories each
 * task should use, and leaves every other task untouched.
 */
export function planProjectRelocation(from: ProjectLocationPaths, to: ProjectLocationPaths, tasks: RelocationTask[]): ProjectRelocationPlan {
  const plan: ProjectRelocationPlan = { tasks: [], worktrees: [] };
  for (const task of tasks) {
    if (task.worktree) {
      // A folder project keeps a retained plain checkout as-is: there is no Git
      // root to derive an equivalent subdirectory from, and the binding stays valid.
      if (to.gitRootPath === undefined) continue;
      const relative = path.relative(to.gitRootPath, to.projectPath);
      plan.worktrees.push({ taskId: task.id, worktreePath: task.worktree.path, target: relative === '' ? task.worktree.path : path.join(task.worktree.path, relative) });
      continue;
    }
    if (task.effectiveCwd !== from.projectPath) continue;
    plan.tasks.push({ taskId: task.id, from: task.effectiveCwd, to: to.projectPath });
  }
  return plan;
}

/**
 * Build the stored project, discarding a default branch that has no Git root to belong
 * to. The key is kept when the project already has one, generated deterministically
 * when it does not, and validated for uniqueness against the Hub's other projects.
 */
export function buildProject(projectId: string, input: ProjectInput, current?: Project, takenKeys: Iterable<string> = []): RegisteredProject {
  const gitRootPath = projectGitRoot(input);
  const taken = new Set(takenKeys);
  const requested = input.projectKey === undefined ? undefined : requireProjectKey(input.projectKey);
  if (requested !== undefined && requested !== current?.projectKey && taken.has(requested)) {
    throw new KanbanError('PROJECT_KEY_CONFLICT', 'Another project of this Hub already uses this key.', { projectKey: requested });
  }
  const projectKey = requested ?? current?.projectKey ?? allocateProjectKey(input.name, taken);
  const project: RegisteredProject = {
    id: projectId, name: input.name.trim(), projectPath: input.projectPath, projectKey,
    ...(gitRootPath === undefined ? {} : { gitRootPath }),
    ...(current?.workspaceId ? { workspaceId: current.workspaceId } : {}),
    ...(current?.workspaceOwned !== undefined ? { workspaceOwned: current.workspaceOwned } : {}),
    ...(current?.operation ? { operation: current.operation } : {}),
  };
  if (gitRootPath !== undefined && input.defaultBranch !== undefined) {
    invariant(typeof input.defaultBranch === 'string', 'INVALID_INPUT', 'Default branch must be text.');
    if (input.defaultBranch.trim()) project.defaultBranch = input.defaultBranch.trim();
  }
  return project;
}
