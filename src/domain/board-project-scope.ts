import { KanbanError } from '../shared/errors.js';
import { isPublishedProject } from '../shared/project.js';
import { canonicalProjectKeys } from './project-key.js';
import type { Board, Project } from '../shared/types.js';

/**
 * The one authority for "may this project create a task on this board". A board
 * records project keys; an absent list means every project of the Hub is allowed,
 * and an empty list closes the board to creation.
 */

/** Whether the board accepts a project. The key is the board's only notion of a project. */
export function isProjectAllowed(board: Board, project: Project): boolean {
  return board.allowedProjectKeys === undefined || board.allowedProjectKeys.includes(project.projectKey);
}

/** A board that records an empty list accepts no new task. */
export function isBoardClosedForCreation(board: Board): boolean {
  return board.allowedProjectKeys !== undefined && board.allowedProjectKeys.length === 0;
}

/** The projects that may create a task on the board: allowed by the scope and already adopted. */
export function creatableProjects(board: Board, projects: readonly Project[]): Project[] {
  return projects.filter(project => !isPublishedProject(project) && isProjectAllowed(board, project));
}

/** The boards of a Hub whose scope names one key. */
export function boardsAllowingKey(boards: readonly Board[], projectKey: string): Board[] {
  return boards.filter(board => board.allowedProjectKeys?.includes(projectKey) === true);
}

/** The creation gate. Every creation path, including the agent surface, reaches this one rule. */
export function assertProjectCreatable(board: Board, project: Project): void {
  if (isPublishedProject(project)) {
    throw new KanbanError('PROJECT_NOT_ADOPTED', 'Adopt this published project by choosing its directory before creating a task in it.', { projectId: project.id, projectKey: project.projectKey, boardId: board.id });
  }
  if (!isProjectAllowed(board, project)) {
    throw new KanbanError('PROJECT_NOT_ALLOWED_ON_BOARD', 'The board does not allow the selected project. Change the board project scope or choose another board.', { projectId: project.id, projectKey: project.projectKey, boardId: board.id, boardName: board.name });
  }
}

/** Every recorded key must name a project, including a placeholder, of the same Hub. */
export function assertKnownProjectKeys(keys: readonly string[], projects: readonly Project[]): void {
  const known = new Set(projects.map(project => project.projectKey));
  const unknown = keys.filter(key => !known.has(key));
  if (unknown.length > 0) throw new KanbanError('INVALID_PROJECT_KEY', 'A board project scope can only name projects of its Hub.', { projectKeys: unknown });
}

/** The canonical scope: de-duplicated and ordered, so two equal sets always compare equal. */
export function normalizeProjectKeys(keys: readonly string[]): string[] {
  return canonicalProjectKeys(keys);
}
