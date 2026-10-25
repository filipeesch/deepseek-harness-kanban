import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import type { HubState } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0).reverse()) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
type F = Awaited<ReturnType<typeof setup>>;
async function secondHub(f: F) {
  const created = await f.app.command({ type: 'hub.create', name: 'Second Hub' });
  const hubId = created.commandReceipt?.kind === 'hub' ? created.commandReceipt.id : undefined;
  if (!hubId) throw new Error('Missing Hub receipt');
  const projectResult = await f.app.command({ type: 'project.save', hubId, project: { name: 'Second project', projectPath: f.projectPath, gitRootPath: f.gitRoot } });
  const project = projectResult.state.hubs.find(hub => hub.id === hubId)!.projects[0]!;
  const boardResult = await f.app.command({ type: 'board.create', hubId, name: 'Second board' });
  const boardId = boardResult.commandReceipt?.kind === 'board' ? boardResult.commandReceipt.id : undefined;
  if (!boardId) throw new Error('Missing board receipt');
  return { hubId, project, boardId };
}
function execution(id = 'ordinary-session'): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}
function tool(f: F, name: string) { const value = productToolDefinitions(f.app).find(entry => entry.name === name); if (!value) throw new Error('Missing tool ' + name); return value; }

describe('Hub-scoped host commands', () => {
  it('creates a second Hub and board and keeps tasks isolated', async () => {
    const f = await setup();
    const second = await secondHub(f);
    const result = await f.app.command({ type: 'task.create', hubId: second.hubId, boardId: second.boardId, projectId: second.project.id, title: 'Second task', description: '' });
    const task = result.state.hubs.find(hub => hub.id === second.hubId)!.tasks[0]!;
    expect(task.boardId).toBe(second.boardId);
    expect(result.state.hubs.find(hub => hub.id === f.hub.id)!.tasks.some(value => value.title === 'Second task')).toBe(false);
    expect(result.state.hubs).toHaveLength(2);
  });

  it('rejects a project from another Hub and anchors direct creation by board', async () => {
    const f = await setup();
    const second = await secondHub(f);
    await expect(f.app.command({ type: 'task.create', hubId: second.hubId, boardId: second.boardId, projectId: f.project.id, title: 'Wrong Hub', description: '' })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    const created = await f.app.createTask({ boardId: second.boardId, projectId: second.project.id, title: 'Anchored', description: '' });
    const state = await f.app.snapshot();
    expect(state.state.hubs.find(hub => hub.id === second.hubId)!.tasks.some(task => task.id === created.id)).toBe(true);
    expect(state.state.hubs.find(hub => hub.id === f.hub.id)!.tasks.some(task => task.id === created.id)).toBe(false);
  });

  it('keeps board workflows independent', async () => {
    const f = await setup();
    const second = await secondHub(f);
    const yaml = 'name: Second flow\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';
    await f.app.command({ type: 'board.workflow.save', hubId: second.hubId, boardId: second.boardId, yaml });
    const state = (await f.app.snapshot()).state;
    const other = state.hubs.find(hub => hub.id === second.hubId)!.boards.find(board => board.id === second.boardId)!;
    const base = state.hubs.find(hub => hub.id === f.hub.id)!.boards[0]!;
    expect(other.workflow.columns.map(column => column.id)).toEqual(['todo', 'done']);
    expect(base.workflow.columns.map(column => column.id)).toContain('backlog');
  });

  it('enforces board, Hub, and last-Hub deletion rules', async () => {
    const f = await setup();
    const firstTask = await f.app.createTask({ projectId: f.project.id, title: 'Keep', description: '' });
    const second = await secondHub(f);
    await expect(f.app.command({ type: 'hub.delete', hubId: f.hub.id, confirmed: true })).rejects.toMatchObject({ code: 'HUB_IN_USE' });
    await expect(f.app.command({ type: 'board.delete', hubId: second.hubId, boardId: second.boardId, confirmed: true })).resolves.toBeTruthy();
    await expect(f.app.command({ type: 'hub.delete', hubId: second.hubId, confirmed: true })).resolves.toBeTruthy();
    await f.app.command({ type: 'task.delete', taskId: firstTask.id, confirmed: true, expectedWorktreePath: null });
    await expect(f.app.command({ type: 'hub.delete', hubId: f.hub.id, confirmed: true })).rejects.toMatchObject({ code: 'LAST_HUB' });
  });

  it('anchors tools on the board and returns Hub/board identity', async () => {
    const f = await setup();
    const second = await secondHub(f);
    const hubs = await tool(f, 'list_hubs').execute({}, execution());
    expect(hubs).toEqual(expect.arrayContaining([expect.objectContaining({ id: second.hubId, name: 'Second Hub' })]));
    const boards = await tool(f, 'list_boards').execute({ hub_id: second.hubId }, execution());
    expect(boards).toEqual([expect.objectContaining({ id: second.boardId, hubId: second.hubId, name: 'Second board' })]);
    const projects = await tool(f, 'list_projects').execute({ board_id: second.boardId }, execution());
    expect(projects).toEqual([expect.objectContaining({ id: second.project.id })]);
    const created = await tool(f, 'create_card').execute({ board_id: second.boardId, project_id: second.project.id, title: 'Tool task', description: '' }, execution()) as { id: string; boardId: string; projectId: string; title: string };
    expect(created).toMatchObject({ boardId: second.boardId, projectId: second.project.id, title: 'Tool task' });
    const listed = await tool(f, 'list_cards').execute({ board_id: second.boardId }, execution()) as Array<{ id: string; hubId: string }>;
    expect(listed).toEqual([expect.objectContaining({ id: created.id, hubId: second.hubId })]);
    const edited = await tool(f, 'edit_card').execute({ task_id: created.id, title: 'Edited tool task' }, execution()) as { id: string; hubId: string };
    expect(edited).toMatchObject({ id: created.id, hubId: second.hubId });
    const card = await tool(f, 'get_card').execute({ task_id: created.id }, execution());
    expect(card).toMatchObject({ task: expect.objectContaining({ id: created.id }), board: expect.objectContaining({ id: second.boardId }), hub: expect.objectContaining({ id: second.hubId }) });
  });

  it('projects execution attention from tasks in every Hub', async () => {
    const f = await setup();
    const second = await secondHub(f);
    const result = await f.app.command({ type: 'task.create', hubId: second.hubId, boardId: second.boardId, projectId: second.project.id, title: 'Running elsewhere', description: '' });
    const task = result.state.hubs.find(hub => hub.id === second.hubId)!.tasks[0]!;
    f.sessions.busy.add(task.sessionIds[0]!);
    f.app.sessionActivity(task.sessionIds[0]!);
    const snapshot = await f.app.snapshot();
    expect(snapshot.attention[task.id]?.running).toBe(true);
  });

  it('rejects a board that does not belong to the supplied hub_id', async () => {
    const f = await setup();
    const second = await secondHub(f);
    await expect(tool(f, 'list_projects').execute({ hub_id: second.hubId, board_id: f.board.id }, execution())).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
    const projects = await tool(f, 'list_projects').execute({ hub_id: second.hubId, board_id: second.boardId }, execution());
    expect(projects).toEqual([expect.objectContaining({ id: second.project.id })]);
  });

  it('rejects a board operation from an ordinary chat without a board id', async () => {
    const f = await setup();
    await expect(tool(f, 'list_cards').execute({}, execution())).rejects.toMatchObject({ code: 'BOARD_CONTEXT_REQUIRED' });
  });
});
