import { describe, expect, it } from 'vitest';
import {
  assertKnownProjectIdentities, assertProjectCreatable, boardsAllowingIdentity, creatableProjects,
  isBoardClosedForCreation, isProjectAllowed, normalizeProjectKeys, projectByIdentity, publishedIdentities, publishedIdentityOf,
} from '../../src/domain/board-project-scope.js';
import { requireProjectPath, requireRegisteredProject } from '../../src/shared/project.js';
import type { Board, Project } from '../../src/shared/types.js';

const workflow = { name: 'Flow', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] };
function board(keys?: string[]): Board {
  return { id: 'board', name: 'Board', workflowYaml: 'name: Flow', workflow, ...(keys === undefined ? {} : { allowedProjectKeys: keys }), createdAt: '', updatedAt: '' };
}
const registered: Project = { id: 'api', name: 'API', projectKey: 'api', projectPath: '/repo/apps/api' };
const other: Project = { id: 'web', name: 'Web', projectKey: 'web', projectPath: '/repo/apps/web' };
const placeholder: Project = { id: 'ops', name: 'ops', projectKey: 'ops', origin: 'published' };

function codeOf(run: () => void): string | undefined {
  try { run(); return undefined; }
  catch (error) { return (error as { code?: string }).code; }
}

describe('board project scope', () => {
  it('allows every project when the board records no list', () => {
    expect(isProjectAllowed(board(), registered)).toBe(true);
    expect(isProjectAllowed(board(), placeholder)).toBe(true);
    expect(isBoardClosedForCreation(board())).toBe(false);
  });

  it('allows only the recorded keys', () => {
    expect(isProjectAllowed(board(['api']), registered)).toBe(true);
    expect(isProjectAllowed(board(['api']), other)).toBe(false);
  });

  it('treats an empty list as closed for creation', () => {
    expect(isBoardClosedForCreation(board([]))).toBe(true);
    expect(isProjectAllowed(board([]), registered)).toBe(false);
  });

  it('offers only allowed, adopted projects for creation', () => {
    expect(creatableProjects(board(['api', 'ops']), [registered, other, placeholder]).map(project => project.id)).toEqual(['api']);
    expect(creatableProjects(board(), [registered, other, placeholder]).map(project => project.id)).toEqual(['api', 'web']);
  });

  it('rejects a project the board does not allow with a typed problem', () => {
    expect(codeOf(() => assertProjectCreatable(board(['api']), other))).toBe('PROJECT_NOT_ALLOWED_ON_BOARD');
    expect(() => assertProjectCreatable(board([]), registered)).toThrow(/does not allow/);
  });

  it('rejects a placeholder even when its key is allowed', () => {
    expect(codeOf(() => assertProjectCreatable(board(['ops']), placeholder))).toBe('PROJECT_NOT_ADOPTED');
  });

  it('finds the boards that name an identity', () => {
    expect(boardsAllowingIdentity([board(['api']), board(['web']), board(), board([])], 'api').map((value: Board) => value.id)).toEqual(['board']);
  });

  it('rejects an identity that no project of the Hub owns', () => {
    expect(codeOf(() => assertKnownProjectIdentities(['api', 'missing'], [registered]))).toBe('INVALID_PROJECT_KEY');
    expect(() => assertKnownProjectIdentities(['api'], [registered])).not.toThrow();
  });

  it('names a linked project by its published identity', () => {
    const linked: Project = { ...registered, publishedKey: 'team-api' };
    expect(publishedIdentityOf(linked)).toBe('team-api');
    expect(isProjectAllowed(board(['team-api']), linked)).toBe(true);
    expect(isProjectAllowed(board(['api']), linked)).toBe(false);
    expect(publishedIdentityOf(registered)).toBe('api');
    expect(publishedIdentityOf(placeholder)).toBe('ops');
  });

  it('resolves one project per identity and lists every identity once', () => {
    const linked: Project = { ...registered, publishedKey: 'team-api' };
    expect(projectByIdentity([linked, placeholder], 'team-api')?.id).toBe('api');
    expect(projectByIdentity([linked, placeholder], 'ops')?.id).toBe('ops');
    expect(projectByIdentity([linked], 'api')).toBeUndefined();
    expect([...publishedIdentities([linked, placeholder])]).toEqual(['team-api', 'ops']);
  });

  it('offers a linked project for creation by its published identity', () => {
    const linked: Project = { ...registered, publishedKey: 'team-api' };
    expect(creatableProjects(board(['team-api']), [linked]).map(project => project.id)).toEqual(['api']);
  });

  it('refuses a placeholder everywhere a directory is required', () => {
    expect(codeOf(() => requireProjectPath(placeholder))).toBe('PROJECT_NOT_ADOPTED');
    expect(codeOf(() => requireRegisteredProject(placeholder))).toBe('PROJECT_NOT_ADOPTED');
    expect(requireProjectPath(registered)).toBe('/repo/apps/api');
  });

  it('de-duplicates a recorded scope', () => {
    expect(normalizeProjectKeys(['api', 'api', 'web'])).toEqual(['api', 'web']);
  });
});
