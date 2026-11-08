import type { Project, ProjectInput, Task } from '../../shared/types.js';

/** What a relocation would migrate, shown before the user confirms it. */
export interface RelocationImpact {
  projectId: string;
  input: ProjectInput & { id: string };
  tasks: number;
  conversations: number;
  worktrees: number;
  activeConversations: number;
}

/** A location change is a relocation only while the project still has tasks. */
function projectTasks(project: Project, tasks: readonly Task[]): Task[] {
  return tasks.filter(task => task.projectId === project.id);
}

export function needsRelocation(project: Project | undefined, input: ProjectInput, tasks: readonly Task[]): boolean {
  if (!project || projectTasks(project, tasks).length === 0) return false;
  const currentRoot = project.gitRootPath ?? '';
  const nextRoot = input.gitRootPath ?? '';
  // Clearing or adding a Git association is a registration save; only a different
  // existing root is a location change.
  if ((currentRoot === '') !== (nextRoot === '')) return false;
  const rootChanged = currentRoot !== '' && nextRoot !== '' && currentRoot !== nextRoot;
  return project.projectPath !== input.projectPath || rootChanged;
}

export function relocationImpact(project: Project, input: ProjectInput, tasks: readonly Task[], isActive: (sessionId: string) => boolean): RelocationImpact {
  const owned = projectTasks(project, tasks);
  const sessionIds = owned.flatMap(task => task.sessionIds);
  return {
    projectId: project.id,
    input: { ...input, id: project.id },
    tasks: owned.length,
    conversations: sessionIds.length,
    worktrees: owned.filter(task => task.worktree !== null).length,
    activeConversations: sessionIds.filter(sessionId => isActive(sessionId)).length,
  };
}

/**
 * A Git-association change and a location change cannot be sent as one command:
 * the association is a registration save and the location is a relocation.
 */
export function relocationBlockedReason(project: Project | undefined, input: ProjectInput, tasks: readonly Task[]): string | null {
  if (!project || projectTasks(project, tasks).length === 0) return null;
  const currentRoot = project.gitRootPath ?? '';
  const nextRoot = input.gitRootPath ?? '';
  const kindChanged = (currentRoot === '') !== (nextRoot === '');
  if (!kindChanged) return null;
  const locationChanged = project.projectPath !== input.projectPath || (currentRoot !== '' && nextRoot !== '' && currentRoot !== nextRoot);
  return locationChanged ? 'Change the Git association and save the project first, then relocate its location.' : null;
}
