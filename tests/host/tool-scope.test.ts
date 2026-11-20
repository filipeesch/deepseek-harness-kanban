import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { fixture, taskWithConversation } from './helpers.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const active: Fixture[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

async function setup(): Promise<Fixture> {
  const f = await fixture();
  active.push(f);
  return f;
}

/** The tool run context one conversation id stands for. */
function context(sessionId: string): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id: sessionId }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}

/** One registered product tool, resolved the way the host resolves it. */
function definition(f: Fixture, name: string): ToolDefinition {
  const found = productToolDefinitions(f.app).find(candidate => candidate.name === name);
  if (!found) throw new Error('Missing tool ' + name);
  return found;
}

/** Run one registered product tool from one conversation. */
async function runTool(f: Fixture, name: string, args: Record<string, unknown>, sessionId = 'ordinary-session'): Promise<any> {
  return definition(f, name).execute(args, context(sessionId));
}

describe('card listing scope', () => {
  it('lists one Hub by identifier', async () => {
    const f = await setup();
    await f.app.createTask({ projectId: f.project.id, title: 'Listed', description: '' });
    await f.app.command({ type: 'hub.create', name: 'Second' });
    const second = f.hubs.list().find(hub => hub.name === 'Second')!;
    const listed = await runTool(f, 'list_cards', { hub_id: f.hub.id });
    expect(listed.map((card: { title: string }) => card.title)).toContain('Listed');
    expect(await runTool(f, 'list_cards', { hub_id: second.id })).toEqual([]);
  });

  it('refuses a Hub identifier that names no Hub', async () => {
    const f = await setup();
    await expect(runTool(f, 'list_cards', { hub_id: 'ghost' })).rejects.toThrowError(/Hub/);
  });

  it('refuses a board that does not belong to the explicitly named Hub', async () => {
    const f = await setup();
    await f.app.command({ type: 'hub.create', name: 'Second' });
    const second = f.hubs.list().find(hub => hub.name === 'Second')!;
    await expect(runTool(f, 'list_cards', { hub_id: second.id, board_id: f.board.id }))
      .rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
  });

  it('refuses an ordinary chat that names neither a Hub nor a board', async () => {
    const f = await setup();
    await expect(runTool(f, 'list_cards', {})).rejects.toMatchObject({ code: 'BOARD_CONTEXT_REQUIRED' });
  });

  it('resolves the Hub and the board from the calling task conversation', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Scoped listing', description: '' });
    const listed = await runTool(f, 'list_cards', {}, task.sessionIds[0]!) as Array<{ id: string }>;
    expect(listed.map(card => card.id)).toContain(task.id);
  });
});
