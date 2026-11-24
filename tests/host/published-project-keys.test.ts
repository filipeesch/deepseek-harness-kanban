import { describe, expect, it } from 'vitest';
import { publishedIdentityOf } from '../../src/domain/board-project-scope.js';
import { isPublishedProject } from '../../src/shared/project.js';
import type { Project } from '../../src/shared/types.js';

/** The ignore mark one project carries, when it is a placeholder at all. */
function dismissedOf(project: Project | undefined): boolean | undefined {
  return project !== undefined && isPublishedProject(project) ? project.dismissed : undefined;
}
import * as operations from '../../src/domain/hub-operations.js';
import { fixture } from './helpers.js';

describe('published project keys', () => {
  it('creates one placeholder per identity the Hub does not hold', async () => {
    const f = await fixture();
    await f.store.transact(draft => { operations.ensurePublishedProjects(draft, ['alpha', 'beta'], f.hubs.operationDeps()); });
    const placeholders = f.hubs.requireHub(f.hub.id).projects.filter(project => project.origin === 'published');
    expect(placeholders.map(project => project.projectKey).sort()).toEqual(['alpha', 'beta']);
    expect(placeholders.every(project => project.projectPath === undefined)).toBe(true);
    expect(placeholders.every(project => project.publishedKey === undefined)).toBe(true);
    await f.close();
  });

  it('binds an existing project by creating one with the received identity', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'management', projectKey: 'management', origin: 'published' }); });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: ['management'] });
    const saved = await f.app.command({ type: 'project.save', project: { name: 'Management', projectPath: f.projectPath, gitRootPath: f.gitRoot, projectKey: 'management' } });
    const hub = f.hubs.requireHub(f.hub.id);
    const projects = hub.projects.filter(project => publishedIdentityOf(project) === 'management');
    expect(projects).toHaveLength(1);
    expect(projects[0]!.origin).toBeUndefined();
    expect(hub.boards[0]!.allowedProjectKeys).toEqual(['management']);
    expect(saved.state.hubs[0]!.projects.map(project => project.id)).not.toContain('placeholder');
    await f.close();
  });

  it('links a project to an identity and rewrites the boards naming its previous identity', async () => {
    const f = await fixture();
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey] });
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'management', projectKey: 'management', origin: 'published' }); });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey, 'management'] });
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.project.projectPath, gitRootPath: f.project.gitRootPath, publishedKey: 'management' } });
    const hub = f.hubs.requireHub(f.hub.id);
    expect(publishedIdentityOf(hub.projects.find(project => project.id === f.project.id)!)).toBe('management');
    expect(hub.boards[0]!.allowedProjectKeys).toEqual(['management']);
    expect(hub.projects.some(project => project.id === 'placeholder')).toBe(false);
    expect(hub.projects.find(project => project.id === f.project.id)!.projectKey).toBe(f.project.projectKey);
    await f.close();
  });

  it('leaves every scope alone when a linked project changes its local key', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'management', projectKey: 'management', origin: 'published' }); });
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.project.projectPath, gitRootPath: f.project.gitRootPath, publishedKey: 'management' } });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: ['management'] });
    const before = structuredClone(f.hubs.requireHub(f.hub.id).boards[0]!.allowedProjectKeys);
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectKey: 'renamed-local', projectPath: f.project.projectPath, gitRootPath: f.project.gitRootPath } });
    expect(f.hubs.requireHub(f.hub.id).boards[0]!.allowedProjectKeys).toEqual(before);
    await f.close();
  });

  it('receives an identity another project uses as its local key', async () => {
    const f = await fixture();
    // A registered project holds the local key "api" while answering the team's "team-api".
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectKey: 'api', projectPath: f.project.projectPath, gitRootPath: f.gitRoot, publishedKey: 'team-api' } });
    const created = await f.store.transact(draft => {
      const identities = operations.ensurePublishedProjects(draft, ['api'], f.hubs.operationDeps());
      operations.setBoardProjectScope(draft, f.board.id, ['api'], f.hubs.operationDeps());
      return identities;
    });
    expect(created).toEqual(['api']);
    const hub = f.hubs.requireHub(f.hub.id);
    const placeholder = hub.projects.find(project => project.origin === 'published')!;
    expect(placeholder.projectKey).not.toBe('api');
    expect(publishedIdentityOf(placeholder)).toBe('api');
    expect(publishedIdentityOf(hub.projects.find(project => project.id === f.project.id)!)).toBe('team-api');
    expect(hub.boards[0]!.allowedProjectKeys).toEqual(['api']);
    // Adopting it keeps the received identity, whatever local key it had to take.
    const adopted = await f.app.command({ type: 'project.save', project: { id: placeholder.id, name: 'API files', projectPath: f.gitRoot, gitRootPath: f.gitRoot } });
    const project = adopted.state.hubs[0]!.projects.find(value => value.id === placeholder.id)!;
    expect(project.projectKey).not.toBe('api');
    expect(publishedIdentityOf(project)).toBe('api');
    await f.close();
  });

  it('keeps the natural local key of an identity received beside a collision', async () => {
    const f = await fixture();
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectKey: 'api', projectPath: f.project.projectPath, gitRootPath: f.gitRoot, publishedKey: 'team-api' } });
    await f.store.transact(draft => {
      operations.ensurePublishedProjects(draft, ['api', 'api-2'], f.hubs.operationDeps());
      operations.setBoardProjectScope(draft, f.board.id, ['api', 'api-2'], f.hubs.operationDeps());
    });
    const placeholders = f.hubs.requireHub(f.hub.id).projects.filter(project => project.origin === 'published');
    const byIdentity = new Map(placeholders.map(project => [publishedIdentityOf(project), project]));
    expect(byIdentity.get('api-2')!.projectKey).toBe('api-2');
    expect(byIdentity.get('api')!.projectKey).not.toBe('api');
    await f.close();
  });

  it('writes nothing when the cleanup has nothing to drop', async () => {
    const f = await fixture();
    const before = f.hubs.requireHub(f.hub.id).revision;
    expect(await f.hubs.pruneUncitedPlaceholders(f.hub.id)).toEqual([]);
    // A transaction always advances the revision, so an unchanged revision proves the
    // cleanup wrote nothing at all.
    expect(f.hubs.requireHub(f.hub.id).revision).toBe(before);
    await f.close();
  });

  it('reports the received identity it pruned, not its mechanical local key', async () => {
    const f = await fixture();
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectKey: 'api', projectPath: f.project.projectPath, gitRootPath: f.gitRoot, publishedKey: 'team-api' } });
    const removed = await f.store.transact(draft => {
      operations.ensurePublishedProjects(draft, ['api'], f.hubs.operationDeps());
      const placeholder = draft.projects.find(project => project.origin === 'published')!;
      expect(placeholder.projectKey).not.toBe('api');
      return operations.pruneUncitedPlaceholders(draft, f.hubs.operationDeps());
    });
    expect(removed).toEqual(['api']);
    await f.close();
  });

  it('refuses a local key that a placeholder holds when the save keeps its own team key', async () => {
    const f = await fixture();
    // A linked project answers "team-api"; a placeholder holds the identity "api".
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectKey: 'p-local', projectPath: f.project.projectPath, gitRootPath: f.gitRoot, publishedKey: 'team-api' } });
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'Api', projectKey: 'api', origin: 'published' }); });
    // Claiming the placeholder's local key without claiming its identity is a key conflict,
    // not a silent absorption that would leave two projects sharing the local key.
    await expect(f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectKey: 'api', projectPath: f.project.projectPath, gitRootPath: f.gitRoot } })).rejects.toMatchObject({ code: 'PROJECT_KEY_CONFLICT' });
    const hub = f.hubs.requireHub(f.hub.id);
    expect(publishedIdentityOf(hub.projects.find(project => project.id === f.project.id)!)).toBe('team-api');
    expect(hub.projects.some(project => project.id === 'placeholder')).toBe(true);
    await f.close();
  });

  it('refuses to change either key while adopting a received identity', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    const revision = f.hubs.requireHub(f.hub.id).revision;
    const path = { name: 'Ops', projectPath: f.projectPath, gitRootPath: f.gitRoot };
    await expect(f.app.command({ type: 'project.save', project: { id: 'placeholder', ...path, projectKey: 'other' } })).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_FIXED' });
    await expect(f.app.command({ type: 'project.save', project: { id: 'placeholder', ...path, publishedKey: 'other' } })).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_FIXED' });
    const hub = f.hubs.requireHub(f.hub.id);
    expect(hub.revision).toBe(revision);
    expect(hub.projects.find(project => project.id === 'placeholder')).toMatchObject({ projectKey: 'ops', origin: 'published' });
    await f.close();
  });

  it('refuses to clear the team key of a collision placeholder while adopting', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'Api', projectKey: 'api-2', publishedKey: 'api', origin: 'published' }); });
    await expect(f.app.command({ type: 'project.save', project: { id: 'placeholder', name: 'Api', projectPath: f.projectPath, gitRootPath: f.gitRoot, publishedKey: '' } })).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_FIXED' });
    // Adopting without stating a key keeps the identity the boards name.
    const adopted = await f.app.command({ type: 'project.save', project: { id: 'placeholder', name: 'Api', projectPath: f.projectPath, gitRootPath: f.gitRoot } });
    const project = adopted.state.hubs[0]!.projects.find(value => value.id === 'placeholder')!;
    expect(project.origin).toBeUndefined();
    expect(publishedIdentityOf(project)).toBe('api');
    expect(project.projectKey).toBe('api-2');
    await f.close();
  });

  it('clears an ignore by creating a project that claims the identity', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'Ops', projectKey: 'ops', origin: 'published', dismissed: true }); });
    await f.app.command({ type: 'project.save', project: { name: 'Ops', projectPath: f.projectPath, gitRootPath: f.gitRoot, projectKey: 'ops' } });
    const hub = f.hubs.requireHub(f.hub.id);
    expect(hub.projects.some(project => project.id === 'placeholder')).toBe(false);
    const bound = hub.projects.filter(project => publishedIdentityOf(project) === 'ops');
    expect(bound).toHaveLength(1);
    expect(bound[0]!.origin).toBeUndefined();
    expect(dismissedOf(bound[0])).toBeUndefined();
    await f.close();
  });

  it('refuses an identity another project already answers', async () => {
    const f = await fixture();
    const second = await f.store.saveProject({ name: 'Second', projectPath: f.gitRoot, gitRootPath: f.gitRoot });
    await f.app.command({ type: 'project.save', project: { id: second.id, name: second.name, projectPath: f.gitRoot, gitRootPath: f.gitRoot, publishedKey: 'taken' } });
    await expect(f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.project.projectPath, gitRootPath: f.gitRoot, publishedKey: 'taken' } })).rejects.toMatchObject({ code: 'PROJECT_KEY_CONFLICT' });
    await f.close();
  });

  it('ignores and restores a received identity without touching a scope', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey, 'ops'] });
    await f.app.command({ type: 'project.dismiss', projectId: 'placeholder', dismissed: true });
    let hub = f.hubs.requireHub(f.hub.id);
    expect(dismissedOf(hub.projects.find(project => project.id === 'placeholder'))).toBe(true);
    expect(hub.boards[0]!.allowedProjectKeys).toEqual([f.project.projectKey, 'ops'].sort());
    await f.app.command({ type: 'project.dismiss', projectId: 'placeholder', dismissed: false });
    hub = f.hubs.requireHub(f.hub.id);
    expect(dismissedOf(hub.projects.find(project => project.id === 'placeholder'))).toBeUndefined();
    await f.close();
  });

  it('refuses to delete a received identity instead of stripping it from the scopes', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey, 'ops'] });
    await expect(f.app.command({ type: 'project.delete', projectId: 'placeholder', confirmed: true })).rejects.toMatchObject({ code: 'PROJECT_NOT_DELETABLE' });
    const hub = f.hubs.requireHub(f.hub.id);
    expect(hub.projects.some(project => project.id === 'placeholder')).toBe(true);
    expect(hub.boards[0]!.allowedProjectKeys).toEqual([f.project.projectKey, 'ops'].sort());
    await f.close();
  });

  it('prunes a placeholder a narrowed scope no longer names', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: ['ops'] });
    expect(f.hubs.requireHub(f.hub.id).projects.some(project => project.id === 'placeholder')).toBe(true);
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey] });
    expect(f.hubs.requireHub(f.hub.id).projects.some(project => project.id === 'placeholder')).toBe(false);
    await f.close();
  });

  it('refuses to ignore a registered project or a stale revision', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    await expect(f.app.command({ type: 'project.dismiss', projectId: f.project.id, dismissed: true })).rejects.toMatchObject({ code: 'PROJECT_NOT_IGNORABLE' });
    await expect(f.app.command({ type: 'project.dismiss', projectId: 'placeholder', dismissed: true, expectedRevision: 99 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await f.close();
  });

  it('prunes a placeholder no board names and never records an ignore', async () => {
    const f = await fixture();
    const now = { id: () => 'generated', now: () => '2026-01-01T00:00:00.000Z' };
    await f.store.transact(draft => { operations.ensurePublishedProjects(draft, ['gone'], now); });
    await f.store.transact(draft => { operations.pruneUncitedPlaceholders(draft, now); });
    expect(f.hubs.requireHub(f.hub.id).projects.some(project => project.projectKey === 'gone')).toBe(false);
    await f.close();
  });

  it('keeps a placeholder a board names', async () => {
    const f = await fixture();
    const now = { id: () => 'generated', now: () => '2026-01-01T00:00:00.000Z' };
    await f.store.transact(draft => {
      operations.ensurePublishedProjects(draft, ['kept'], now);
      operations.setBoardProjectScope(draft, f.board.id, ['kept'], now);
      operations.pruneUncitedPlaceholders(draft, now);
    });
    const hub = f.hubs.requireHub(f.hub.id);
    expect(hub.projects.find(project => project.projectKey === 'kept')).toMatchObject({ origin: 'published' });
    expect(dismissedOf(hub.projects.find(project => project.projectKey === 'kept'))).toBeUndefined();
    await f.close();
  });

  it('reports the published key on the agent surface', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'management', projectKey: 'management', origin: 'published' }); });
    await f.app.command({ type: 'project.save', project: { id: f.project.id, name: f.project.name, projectPath: f.project.projectPath, gitRootPath: f.project.gitRootPath, publishedKey: 'management' } });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: ['management'] });
    const { productToolDefinitions } = await import('../../src/host/tools/index.js');
    const definition = productToolDefinitions(f.app).find(candidate => candidate.name === 'list_projects')!;
    const projects = await definition.execute({ board_id: f.board.id }, { signal: new AbortController().signal, agent: { id: 'ordinary-synthetic-caller' }, deferContext: () => {}, concludeTurn: () => {} } as never) as Array<{ id: string; publishedKey?: string; allowed: boolean }>;
    expect(projects.find(project => project.id === f.project.id)).toMatchObject({ publishedKey: 'management', allowed: true });
    const summary = await productToolDefinitions(f.app).find(candidate => candidate.name === 'get_workflow_summary')!.execute({ board_id: f.board.id }, { signal: new AbortController().signal, agent: { id: 'ordinary-synthetic-caller' }, deferContext: () => {}, concludeTurn: () => {} } as never) as { records: Array<{ kind: string; key?: string }> };
    const names = summary.records.filter(record => record.kind === 'project').map(record => record.key);
    expect(names).toContain('management');
    expect(names).not.toContain(f.project.projectKey);
    await f.close();
  });
});
