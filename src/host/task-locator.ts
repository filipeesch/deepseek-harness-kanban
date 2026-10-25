import type { HubState, Project, Task } from '../shared/types.js';
import type { HubRepository, LocatedTask } from './hub-repository.js';
import type { WorktreeStore } from './worktrees.js';

export interface LocatedProject { hubId: string; hub: HubState; project: Project }

/** Read-only task/project lookup across Hubs; no execution or mutation. */
export class TaskLocator {
  constructor(private readonly hubs: HubRepository) {}

  byTask(taskId: string): LocatedTask | undefined { return this.hubs.findTask(taskId); }
  bySession(sessionId: string): LocatedTask | undefined { return this.hubs.findTaskBySession(sessionId); }
  all(): LocatedTask[] { return this.hubs.allTasks(); }

  project(projectId: string): LocatedProject | undefined {
    for (const hub of this.hubs.list()) {
      const project = hub.projects.find(value => value.id === projectId);
      if (project) return { hubId: hub.id, hub, project };
    }
    return undefined;
  }
}

/** Adapts the repository to the worktree coordinator's task-scoped port. */
export class RepositoryWorktreeStore implements WorktreeStore {
  constructor(private readonly hubs: HubRepository) {}

  locate(taskId: string): { hubId: string; hub: HubState; task: Task; project: Project } {
    const located = this.hubs.requireTask(taskId);
    return { hubId: located.hubId, hub: located.hub, task: located.task, project: located.project };
  }

  transactTask<T>(taskId: string, change: (draft: HubState) => T): Promise<T> {
    const located = this.hubs.requireTask(taskId);
    return this.hubs.transact(located.hubId, change);
  }

  allTasks(): Task[] { return this.hubs.allTasks().map(located => located.task); }
}
