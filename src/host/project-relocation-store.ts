import { invariant } from '../shared/errors.js';
import type { HubState, Project, Task } from '../shared/types.js';
import type { HubRepository } from './hub-repository.js';

/** What the relocation coordinator persists through. */
export interface ProjectRelocationStore {
  locate(projectId: string): { hubId: string; project: Project };
  tasksOf(projectId: string): Task[];
  /** Projects whose recorded relocation is not finished, without cloning their Hubs. */
  pendingProjectIds(): string[];
  transact<T>(projectId: string, change: (draft: HubState) => T | Promise<T>, expectedRevision?: number): Promise<T>;
}

/** Durable Hub access for one project relocation. */
export class RepositoryProjectRelocationStore implements ProjectRelocationStore {
  constructor(private readonly hubs: HubRepository) {}

  private required(projectId: string) {
    const found = this.hubs.findProject(projectId);
    invariant(found, 'PROJECT_NOT_FOUND', 'The project does not exist.');
    return found;
  }

  locate(projectId: string): { hubId: string; project: Project } {
    const found = this.required(projectId);
    return { hubId: found.hubId, project: found.project };
  }

  tasksOf(projectId: string): Task[] {
    return this.required(projectId).hub.tasks.filter(task => task.projectId === projectId);
  }

  pendingProjectIds(): string[] {
    return this.hubs.projectSummaries().filter(summary => summary.hasOperation).map(summary => summary.projectId);
  }

  transact<T>(projectId: string, change: (draft: HubState) => T | Promise<T>, expectedRevision?: number): Promise<T> {
    return this.hubs.transact(this.required(projectId).hubId, change, expectedRevision);
  }
}
