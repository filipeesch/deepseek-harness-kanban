import type { Task } from '../shared/types.js';
import { compareTaskOrder } from '../domain/task-order.js';

export interface TaskFilter {
  readonly search: string;
  /** Empty means every project. */
  readonly projectFilter: string;
}

/** The cards both board presentations show for the active search and project filter. */
export function filterTasks(tasks: readonly Task[], filter: TaskFilter): Task[] {
  const query = filter.search.trim().toLowerCase();
  return tasks.filter(task => (filter.projectFilter === '' || task.projectId === filter.projectFilter) && (query === '' || (task.title + ' ' + task.description).toLowerCase().includes(query))).sort(compareTaskOrder);
}
