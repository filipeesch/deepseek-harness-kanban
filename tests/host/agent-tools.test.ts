import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { declaredAgents } from '../../src/domain/agents.js';
import { fixture } from './helpers.js';

const FLOW = [
  'name: Agent board',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: design',
  '    label: Design',
  '    on_enter_prompt: Design it.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

type F = Awaited<ReturnType<typeof fixture>> & { tools: ToolDefinition[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

function execution(id = 'ordinary-session'): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}
function named(tools: ToolDefinition[], name: string): ToolDefinition {
  const definition = tools.find(candidate => candidate.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}
async function setup(): Promise<F> {
  const f = await fixture();
  const value: F = { ...f, tools: productToolDefinitions(f.app) };
  active.push(value);
  return value;
}
async function run(f: F, name: string, args: Record<string, unknown>): Promise<any> {
  return named(f.tools, name).execute(args, execution());
}
async function boardWith(f: F, yaml: string): Promise<string> {
  const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Agents ' + Math.random().toString(36).slice(2, 8), workflow_yaml: yaml });
  expect(created.saved).toBe(true);
  return created.id;
}
async function document(f: F, boardId: string): Promise<string> {
  return (await run(f, 'get_board_yaml', { board_id: boardId })).yaml;
}

describe('agent authoring tools', () => {
  it('creates, replaces, and removes an agent while preserving authored text', async () => {
    const f = await setup();
    const boardId = await boardWith(f, '# keep me\n' + FLOW);
    const created = await run(f, 'set_agent', { board_id: boardId, agent_id: 'designer', name: 'UX Design', preset: 'ux', model_provider: 'deepseek', model_name: 'reason' });
    expect(created.saved).toBe(true);
    expect(created.report.valid).toBe(true);
    let text = await document(f, boardId);
    expect(text).toContain('# keep me');
    expect(declaredAgents(parseWorkflow(text))).toEqual([{ id: 'designer', name: 'UX Design', preset: 'ux', model: { provider: 'deepseek', model: 'reason' } }]);

    await run(f, 'set_agent', { board_id: boardId, agent_id: 'designer', name: 'UX Design Two', preset: 'ux2' });
    text = await document(f, boardId);
    expect(declaredAgents(parseWorkflow(text))).toEqual([{ id: 'designer', name: 'UX Design Two', preset: 'ux2' }]);

    const stage = await run(f, 'set_stage_agent', { board_id: boardId, stage_id: 'design', agent_id: 'designer' });
    expect(stage.saved).toBe(true);
    expect(parseWorkflow(await document(f, boardId)).columns.find(column => column.id === 'design')?.agent).toBe('designer');

    const refused = await run(f, 'remove_agent', { board_id: boardId, agent_id: 'designer' });
    expect(refused.saved).toBe(false);
    expect(refused.error.message).toMatch(/stage still names/);
    await run(f, 'set_stage_agent', { board_id: boardId, stage_id: 'design', agent_id: '' });
    const removed = await run(f, 'remove_agent', { board_id: boardId, agent_id: 'designer' });
    expect(removed.saved).toBe(true);
    expect(declaredAgents(parseWorkflow(await document(f, boardId)))).toEqual([]);
  });

  it('refuses to remove the main agent and refuses an undeclared stage agent', async () => {
    const f = await setup();
    const boardId = await boardWith(f, FLOW);
    const main = await run(f, 'remove_agent', { board_id: boardId, agent_id: 'main' });
    expect(main.saved).toBe(false);
    expect(main.error.message).toMatch(/main agent cannot be removed/);
    const unknown = await run(f, 'set_stage_agent', { board_id: boardId, stage_id: 'design', agent_id: 'missing' });
    expect(unknown.saved).toBe(false);
    expect(unknown.error.message).toMatch(/does not declare/);
  });

  it('edits one flow-style agent without rewriting the other entry', async () => {
    const flow = `name: Flow agents
initial_column: backlog
columns:
  - id: backlog
    label: Backlog
  - id: done
    label: Done
agents: [{id: researcher, name: 'Researcher', preset: planner}, {id: writer, name: Writer}]
`;
    const f = await setup();
    const boardId = await boardWith(f, flow);
    const replaced = await run(f, 'set_agent', { board_id: boardId, agent_id: 'writer', name: 'Writer Two' });
    expect(replaced.saved).toBe(true);
    expect(await document(f, boardId)).toBe(flow.replace('{id: writer, name: Writer}', '{id: writer, name: Writer Two}'));
    const added = await run(f, 'set_agent', { board_id: boardId, agent_id: 'triage', name: 'Triage' });
    expect(added.saved).toBe(true);
    const removed = await run(f, 'remove_agent', { board_id: boardId, agent_id: 'triage' });
    expect(removed.saved).toBe(true);
    expect(await document(f, boardId)).toBe(flow.replace('{id: writer, name: Writer}', '{id: writer, name: Writer Two}'));
  });

  it('authors the main agent and keeps a legacy document readable', async () => {
    const f = await setup();
    const boardId = await boardWith(f, FLOW);
    const written = await run(f, 'set_agent', { board_id: boardId, agent_id: 'main', name: 'Main', preset: 'kanban-workflow-operator' });
    expect(written.saved).toBe(true);
    const text = await document(f, boardId);
    expect(declaredAgents(parseWorkflow(text))).toEqual([{ id: 'main', name: 'Main', preset: 'kanban-workflow-operator' }]);
    expect(text).toContain('Design it.');
  });
});
