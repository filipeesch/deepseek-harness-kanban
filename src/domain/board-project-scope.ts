import { KanbanError } from '../shared/errors.js';
import { isPublishedProject } from '../shared/project.js';
import { canonicalProjectKeys } from './project-key.js';
import type { Board, Project } from '../shared/types.js';

/**
 * The one authority for "may this project create a task on this board". A board
 * records published project identities; an absent list means every project of the Hub
 * is allowed, and an empty list closes the board to creation.
 */

/**
 * The identity a board scope names for a project: its published key when it carries
 * one, and its local key otherwise. A placeholder's local key is the identity it was
 * received under, so this one rule covers every kind of project.
 */
export function publishedIdentityOf(project: Pick<Project, 'projectKey' | 'publishedKey'>): string {
  return project.publishedKey ?? project.projectKey;
}

/** Every identity the Hub's projects answer to, one per project. */
export function publishedIdentities(projects: readonly Project[]): Set<string> {
  return new Set(projects.map(publishedIdentityOf));
}

/** The project a published identity names, or undefined when the Hub holds none. */
export function projectByIdentity(projects: readonly Project[], identity: string): Project | undefined {
  return projects.find(project => publishedIdentityOf(project) === identity);
}

/** Whether the board accepts a project. The identity is the board's only notion of a project. */
export function isProjectAllowed(board: Board, project: Project): boolean {
  return board.allowedProjectKeys === undefined || board.allowedProjectKeys.includes(publishedIdentityOf(project));
}

/** A board that records an empty list accepts no new task. */
export function isBoardClosedForCreation(board: Board): boolean {
  return board.allowedProjectKeys !== undefined && board.allowedProjectKeys.length === 0;
}

/** The projects that may create a task on the board: allowed by the scope and already adopted. */
export function creatableProjects(board: Board, projects: readonly Project[]): Project[] {
  return projects.filter(project => !isPublishedProject(project) && isProjectAllowed(board, project));
}

/** The boards of a Hub whose scope names one identity. */
export function boardsAllowingIdentity(boards: readonly Board[], identity: string): Board[] {
  return boards.filter(board => board.allowedProjectKeys?.includes(identity) === true);
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

/** Every recorded identity must name a project, including a placeholder, of the same Hub. */
export function assertKnownProjectIdentities(keys: readonly string[], projects: readonly Project[]): void {
  const known = publishedIdentities(projects);
  const unknown = keys.filter(key => !known.has(key));
  if (unknown.length > 0) throw new KanbanError('INVALID_PROJECT_KEY', 'A board project scope can only name projects of its Hub.', { projectKeys: unknown });
}

/** The canonical scope: de-duplicated and ordered, so two equal sets always compare equal. */
export function normalizeProjectKeys(keys: readonly string[]): string[] {
  return canonicalProjectKeys(keys);
}
