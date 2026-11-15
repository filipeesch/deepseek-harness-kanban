import type { Project, WorktreePolicy } from './types.js';

/** The worktree policy a project carries. A project stored without one is Ask. */
export function worktreePolicy(project: Project | undefined): WorktreePolicy {
  return project?.worktreePolicy ?? 'ask';
}
