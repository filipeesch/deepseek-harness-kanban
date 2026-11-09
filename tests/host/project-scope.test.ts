import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { HubRepository } from '../../src/host/hub-repository.js';
import { productToolDefinitions } from '../../src/host/tools/index.js';
import { boardSummary } from '../../src/host/tools/scope.js';
import { MemoryHubStorage } from '../domain/hub-helpers.js';
import { fixture } from './helpers.js';

describe('board project scope', () => {
  it('refuses a task from a project the board does not allow', async () => {
    const f = await fixture();
    const second = await f.store.saveProject({ name: 'API', projectPath: f.gitRoot, gitRootPath: f.gitRoot });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey] });
    await expect(f.app.command({ type: 'task.create', projectId: second.id, title: 'Blocked', description: '' })).rejects.toMatchObject({ code: 'PROJECT_NOT_ALLOWED_ON_BOARD' });
    const created = await f.app.command({ type: 'task.create', projectId: f.project.id, title: 'Allowed', description: '' });
    expect(created.state.hubs[0]!.tasks.map(task => task.title)).toContain('Allowed');
    await f.close();
  });

  it('creates on another board of the same Hub using the destination scope', async () => {
    const f = await fixture();
    const created = await f.app.command({ type: 'board.create', hubId: f.hub.id, name: 'Implementation' });
    const secondBoardId = created.commandReceipt?.id;
    expect(secondBoardId).toBeDefined();
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [] });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: secondBoardId!, projectKeys: [f.project.projectKey] });
    const result = await f.app.command({ type: 'task.create', hubId: f.hub.id, boardId: secondBoardId, projectId: f.project.id, title: 'Cross board', description: '' });
    const task = f.hubs.requireHub(f.hub.id).tasks.find(value => value.id === result.commandReceipt?.id);
    expect(task?.boardId).toBe(secondBoardId);
    await f.close();
  });

  it('closes a board that records no project', async () => {
    const f = await fixture();
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [] });
    await expect(f.app.command({ type: 'task.create', projectId: f.project.id, title: 'Closed', description: '' })).rejects.toMatchObject({ code: 'PROJECT_NOT_ALLOWED_ON_BOARD' });
    const board = f.hubs.requireHub(f.hub.id).boards[0]!;
    expect(boardSummary(board, f.hubs.requireHub(f.hub.id))).toMatchObject({ acceptsNewTasks: false, projectScope: { mode: 'restricted', projectKeys: [] } });
    await f.close();
  });

  it('reopens a board when the scope is cleared', async () => {
    const f = await fixture();
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [] });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id });
    const board = f.hubs.requireHub(f.hub.id).boards[0]!;
    expect(board.allowedProjectKeys).toBeUndefined();
    expect(boardSummary(board, f.hubs.requireHub(f.hub.id))).toMatchObject({ acceptsNewTasks: true, projectScope: { mode: 'all' } });
    await f.close();
  });

  it('rejects a scope that names a project the Hub does not own', async () => {
    const f = await fixture();
    await expect(f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: ['missing'] })).rejects.toMatchObject({ code: 'INVALID_PROJECT_KEY' });
    await f.close();
  });

  it('rejects a scope save with a stale Hub revision', async () => {
    const f = await fixture();
    await expect(f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [], expectedRevision: 99 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await f.close();
  });

  it('keeps the workflow untouched when the scope is saved', async () => {
    const f = await fixture();
    const before = f.hubs.requireHub(f.hub.id).boards[0]!.workflowYaml;
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [] });
    expect(f.hubs.requireHub(f.hub.id).boards[0]!.workflowYaml).toBe(before);
    await f.close();
  });

  it('rewrites every board scope when a project key changes', async () => {
    const f = await fixture();
    const project = f.project;
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [project.projectKey] });
    await f.app.command({ type: 'project.save', project: { id: project.id, name: project.name, projectKey: 'renamed-key', projectPath: project.projectPath, gitRootPath: project.gitRootPath! } });
    expect(f.hubs.requireHub(f.hub.id).boards[0]!.allowedProjectKeys).toEqual(['renamed-key']);
    expect(f.hubs.requireHub(f.hub.id).projects[0]!.projectKey).toBe('renamed-key');
    await f.close();
  });

  it('keeps the key across a rename and rejects a duplicate key', async () => {
    const f = await fixture();
    const project = f.project;
    await f.store.saveProject({ name: 'API', projectPath: f.gitRoot, gitRootPath: f.gitRoot });
    const renamed = await f.store.saveProject({ id: project.id, name: 'Renamed', projectPath: project.projectPath, gitRootPath: project.gitRootPath! });
    expect(renamed.projectKey).toBe(project.projectKey);
    await expect(f.store.saveProject({ id: project.id, name: 'Other', projectKey: 'api', projectPath: project.projectPath, gitRootPath: project.gitRootPath! })).rejects.toMatchObject({ code: 'PROJECT_KEY_CONFLICT' });
    await f.close();
  });

  it('removes a deleted project key from every board scope', async () => {
    const f = await fixture();
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey] });
    await f.store.deleteProject(f.project.id);
    const hub = f.hubs.requireHub(f.hub.id);
    expect(hub.boards[0]!.allowedProjectKeys).toEqual([]);
    expect(hub.projects).toHaveLength(0);
    await f.close();
  });

  it('refuses a published placeholder as a task project', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    await expect(f.app.command({ type: 'task.create', projectId: 'placeholder', title: 'Adopt me', description: '' })).rejects.toMatchObject({ code: 'PROJECT_NOT_ADOPTED' });
    await f.close();
  });

  it('adopts a placeholder with a directory and keeps its key', async () => {
    const f = await fixture();
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    const adopted = await f.app.command({
      type: 'project.save',
      project: { id: 'placeholder', name: 'Ops', projectPath: f.projectPath, gitRootPath: f.gitRoot },
    });
    const project = adopted.state.hubs[0]!.projects.find(value => value.id === 'placeholder')!;
    expect(project).toMatchObject({ projectKey: 'ops', projectPath: f.projectPath });
    expect(project.origin).toBeUndefined();
    await f.close();
  });
});

/** The agent surface, invoked the way the host invokes a product tool. */
function toolFor(app: Parameters<typeof productToolDefinitions>[0]) {
  const definitions = productToolDefinitions(app);
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const definition = definitions.find(candidate => candidate.name === name);
    if (!definition) throw new Error('Missing product tool: ' + name);
    const execution = { signal: new AbortController().signal, agent: { id: 'ordinary-synthetic-caller' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
    return definition.execute(args, execution);
  };
}

describe('project scope on the agent surface', () => {
  it('reports the scope and each project on the board', async () => {
    const f = await fixture();
    const second = await f.store.saveProject({ name: 'API', projectPath: f.gitRoot, gitRootPath: f.gitRoot });
    await f.store.transact(draft => { draft.projects.push({ id: 'placeholder', name: 'ops', projectKey: 'ops', origin: 'published' }); });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [f.project.projectKey] });
    const tool = toolFor(f.app);
    const summary = await tool('get_board_summary', { board_id: f.board.id }) as { acceptsNewTasks: boolean; projectScope: { mode: string } };
    expect(summary).toMatchObject({ acceptsNewTasks: true, projectScope: { mode: 'restricted' } });
    const projects = await tool('list_projects', { board_id: f.board.id }) as Array<{ id: string; allowed: boolean }>;
    expect(projects.find(project => project.id === f.project.id)).toMatchObject({ allowed: true });
    expect(projects.find(project => project.id === second.id)).toMatchObject({ allowed: false });
    expect(projects.find(project => project.id === 'placeholder')).toMatchObject({ allowed: false });
    await f.close();
  });

  it('reports a closed board and refuses a card from a disallowed project', async () => {
    const f = await fixture();
    const second = await f.store.saveProject({ name: 'API', projectPath: f.gitRoot, gitRootPath: f.gitRoot });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [] });
    const tool = toolFor(f.app);
    expect(await tool('get_board_summary', { board_id: f.board.id })).toMatchObject({ acceptsNewTasks: false });
    await expect(tool('create_card', { board_id: f.board.id, project_id: second.id, title: 'Blocked' })).rejects.toMatchObject({ code: 'PROJECT_NOT_ALLOWED_ON_BOARD' });
    expect(f.hubs.requireHub(f.hub.id).tasks).toHaveLength(0);
    await f.close();
  });

  it('creates on another board of the same Hub by the destination scope', async () => {
    const f = await fixture();
    const created = await f.app.command({ type: 'board.create', hubId: f.hub.id, name: 'Implementation' });
    const secondBoardId = created.commandReceipt!.id;
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: f.board.id, projectKeys: [] });
    await f.app.command({ type: 'board.projects.save', hubId: f.hub.id, boardId: secondBoardId, projectKeys: [f.project.projectKey] });
    const tool = toolFor(f.app);
    await tool('create_card', { board_id: secondBoardId, project_id: f.project.id, title: 'Cross board tool' });
    const task = f.hubs.requireHub(f.hub.id).tasks.find(value => value.title === 'Cross board tool');
    expect(task?.boardId).toBe(secondBoardId);
    await f.close();
  });
});

describe('project key backfill', () => {
  it('keys a stored project when the Hub opens and writes once', async () => {
    const storage = new MemoryHubStorage();
    const legacy = {
      id: 'hub', name: 'Hub', revision: 0,
      projects: [{ id: 'project', name: 'Platform API', projectPath: '/repo/app', gitRootPath: '/repo' }],
      boards: [{ id: 'board', name: 'Board', workflowYaml: 'name: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n', workflow: { name: 'Flow', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }], groups: [] }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      tasks: [], notes: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    storage.hubs.set('hub', legacy as never);
    const hubs = await HubRepository.open(storage, { id: () => 'generated', now: () => '2026-01-02T00:00:00.000Z' });
    expect(hubs.requireHub('hub').projects[0]!.projectKey).toBe('platform-api');
    expect(storage.writes).toEqual(['hub']);
    const reopened = await HubRepository.open(storage, { id: () => 'generated', now: () => '2026-01-03T00:00:00.000Z' });
    expect(reopened.requireHub('hub').projects[0]!.projectKey).toBe('platform-api');
    expect(storage.writes).toEqual(['hub']);
    await hubs.close();
    await reopened.close();
  });
});
