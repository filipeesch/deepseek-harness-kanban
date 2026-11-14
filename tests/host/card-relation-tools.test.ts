import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { fixture } from './helpers.js';
import type { TaskActivitySource } from '../../src/domain/task-activity.js';

const fixtures: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

const exec = () => ({ signal: new AbortController().signal, agent: { id: 'ordinary-session' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext);

function named(definitions: ToolDefinition[], name: string): ToolDefinition {
  const definition = definitions.find(value => value.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

async function setup(options: { activity?: TaskActivitySource } = {}) {
  const f = await fixture();
  fixtures.push(f);
  const tools = productToolDefinitions(f.app, f.app.boards, undefined, options.activity === undefined ? {} : { activity: options.activity });
  return {
    ...f,
    tools,
    run: (name: string, args: Record<string, unknown>, run?: ToolRunContext) => named(tools, name).execute(args, run ?? exec()),
  };
}

async function twoCards(f: Awaited<ReturnType<typeof setup>>) {
  const epic = await f.store.createTask({ projectId: f.project.id, title: 'Epic card', description: '**Epic** body' });
  const child = await f.store.createTask({ projectId: f.project.id, title: 'Child card', description: 'Child body' });
  return { epic, child };
}

describe('card relation tool surface', () => {
  it('exposes the relation writes and the batch read, and keeps writes out of the read lane', async () => {
    const f = await setup();
    const names = f.tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(['create_relation', 'delete_relation', 'get_cards']));
    expect(named(f.tools, 'create_relation').isConcurrencySafe?.({ relations: [{ type: 'epic', from: 'a', to: 'b' }] })).toBe(false);
    expect(named(f.tools, 'delete_relation').isConcurrencySafe?.({ relation_ids: ['r'] })).toBe(false);
    expect(named(f.tools, 'get_cards').isConcurrencySafe?.({ task_ids: ['t'] })).toBe(true);
  });

  it('names the authorization rule in the relation write guidance', async () => {
    const f = await setup();
    for (const name of ['create_relation', 'delete_relation']) {
      expect(named(f.tools, name).description).toMatch(/user explicitly requests/);
      expect(named(f.tools, name).description).toMatch(/stage instruction/);
      expect(named(f.tools, name).description).toMatch(/cross-card message/);
    }
  });
});

describe('relation writes through tools', () => {
  it('stores a batch and reports every stored relation', async () => {
    const f = await setup();
    const { epic, child } = await twoCards(f);
    const value = await f.run('create_relation', { relations: [{ type: 'epic', from: epic.id, to: child.id }] }) as { relations: Array<{ id: string; type: string; from: string; to: string }> };
    expect(value.relations).toHaveLength(1);
    expect(value.relations[0]).toMatchObject({ type: 'epic', from: epic.id, to: child.id });
    expect(f.store.snapshot().relations).toHaveLength(1);
  });

  it('does not move, message, or start anything when a relation is written', async () => {
    const f = await setup();
    const { epic, child } = await twoCards(f);
    const before = f.store.snapshot();
    await f.run('create_relation', { relations: [{ type: 'epic', from: epic.id, to: child.id }] });
    const after = f.store.snapshot();
    expect(after.tasks.map(task => ({ id: task.id, columnId: task.columnId, position: task.position, sessions: task.sessionIds })))
      .toEqual(before.tasks.map(task => ({ id: task.id, columnId: task.columnId, position: task.position, sessions: task.sessionIds })));
    expect(f.sessions.sent).toEqual([]);
  });

  it('rejects a batch that closes an epic cycle without storing any of it', async () => {
    const f = await setup();
    const { epic, child } = await twoCards(f);
    await f.run('create_relation', { relations: [{ type: 'epic', from: epic.id, to: child.id }] });
    await expect(f.run('create_relation', { relations: [{ type: 'related', from: epic.id, to: child.id }, { type: 'epic', from: child.id, to: epic.id }] })).rejects.toMatchObject({ code: 'INVALID_RELATION' });
    expect(f.store.snapshot().relations).toHaveLength(1);
  });

  it('rejects a relation that reaches another Hub', async () => {
    const f = await setup();
    const { epic } = await twoCards(f);
    const second = await f.hubs.createHub('Second Hub');
    const store = f.hubs.hub(second.id);
    await store.addBoard('Second board');
    const project = await store.saveProject({ name: 'Second project', projectPath: f.projectPath });
    const other = await store.createTask({ projectId: project.id, title: 'Other card', description: '' });
    await expect(f.run('create_relation', { relations: [{ type: 'epic', from: epic.id, to: other.id }] })).rejects.toMatchObject({ code: 'CROSS_HUB_RELATION' });
  });

  it('rejects an empty collection and a batch over the accepted limit before touching the graph', async () => {
    const f = await setup();
    const { epic, child } = await twoCards(f);
    await expect(f.run('create_relation', { relations: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const oversized = Array.from({ length: 101 }, () => ({ type: 'epic', from: epic.id, to: child.id }));
    await expect(f.run('create_relation', { relations: oversized })).rejects.toMatchObject({ code: 'TOO_MANY_RELATIONS' });
    expect(f.store.snapshot().relations).toBeUndefined();
  });

  it('removes a batch by identifier and names an unknown identifier', async () => {
    const f = await setup();
    const { epic, child } = await twoCards(f);
    const stored = await f.run('create_relation', { relations: [{ type: 'related', from: epic.id, to: child.id }] }) as { relations: Array<{ id: string }> };
    const removed = await f.run('delete_relation', { relation_ids: [stored.relations[0]!.id] }) as { relations: unknown[] };
    expect(removed.relations).toHaveLength(1);
    expect(f.store.snapshot().relations).toEqual([]);
    await expect(f.run('delete_relation', { relation_ids: ['ghost'] })).rejects.toMatchObject({ code: 'RELATION_NOT_FOUND' });
    await expect(f.run('delete_relation', { relation_ids: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('card reads through tools', () => {
  it('lists every board of a Hub, without description, with relation references', async () => {
    const f = await setup();
    const second = await f.store.addBoard('Second board');
    const onFirst = await f.store.createTask({ projectId: f.project.id, title: 'First board card', description: 'hidden body' });
    const onSecond = await f.store.createTask({ projectId: f.project.id, boardId: second.id, title: 'Second board card', description: '' });
    await f.store.createRelations([{ type: 'related', from: onFirst.id, to: onSecond.id }]);

    const hubScope = await f.run('list_cards', { hub_id: f.hub.id }) as Array<Record<string, unknown>>;
    expect(hubScope.map(card => card.id).sort()).toEqual([onFirst.id, onSecond.id].sort());
    expect(hubScope.every(card => card.description === undefined)).toBe(true);
    const first = hubScope.find(card => card.id === onFirst.id)!;
    expect(first.relations).toEqual([{ id: expect.any(String), type: 'related', direction: 'symmetric', otherTaskId: onSecond.id }]);
    // A card with no conversation has no native fact to be unsure about.
    expect(first.activity).toMatchObject({ available: true, running: false });

    const boardScope = await f.run('list_cards', { board_id: f.board.id }) as Array<Record<string, unknown>>;
    expect(boardScope.map(card => card.id)).toEqual([onFirst.id]);

    const searched = await f.run('list_cards', { board_id: f.board.id, query: 'hidden body' }) as Array<Record<string, unknown>>;
    expect(searched.map(card => card.id)).toEqual([onFirst.id]);

    await expect(f.run('list_cards', { hub_id: 'missing', board_id: f.board.id })).rejects.toMatchObject({ code: 'HUB_NOT_FOUND' });
  });

  it('reads several cards in one call and reports the identifiers that name no task', async () => {
    const f = await setup();
    const { epic, child } = await twoCards(f);
    const value = await f.run('get_cards', { task_ids: [child.id, 'ghost', epic.id, child.id] }) as { cards: Array<Record<string, unknown> & { id: string }>; missing: string[]; truncated: boolean };
    expect(value.cards.map(card => card.id)).toEqual([child.id, epic.id]);
    expect(value.missing).toEqual(['ghost']);
    expect(value.truncated).toBe(false);
    expect(value.cards[0]!.description).toBeUndefined();
    expect(value.cards[0]!.history).toBeUndefined();
    expect(value.cards[0]!.deterministic).toBeUndefined();
    await expect(f.run('get_cards', { task_ids: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const dropped = await f.run('get_cards', { task_ids: [epic.id, ...Array.from({ length: 101 }, (_value, index) => 'ghost-' + index)] }) as { cards: Array<{ id: string }>; truncated: boolean; dropped: string[] };
    expect(dropped.truncated).toBe(true);
    expect(dropped.dropped).toHaveLength(2);
    expect(dropped.cards.map(card => card.id)).toEqual([epic.id]);
  });

  it('reads one card with its description, relations, activity, and epic roll-up', async () => {
    const f = await setup();
    const epic = await f.store.createTask({ projectId: f.project.id, title: 'Epic card', description: '**Epic** body' });
    const child = await f.store.createTask({ projectId: f.project.id, title: 'Child card', description: 'Child body' });
    await f.store.createRelations([{ type: 'epic', from: epic.id, to: child.id }]);
    const value = await f.run('get_card', { task_id: epic.id }) as Record<string, unknown> & { relations: Array<Record<string, unknown>>; epicRollup: { children: Array<Record<string, unknown>>; total: number; truncated: boolean } };
    expect(value.description).toBe('**Epic** body');
    expect(value.relations).toEqual([{ id: expect.any(String), type: 'epic', direction: 'outgoing', otherTaskId: child.id, otherTitle: 'Child card', otherColumnId: 'backlog' }]);
    expect(value.activity).toMatchObject({ available: true, running: false });
    expect(value.epicRollup.total).toBe(1);
    expect(value.epicRollup.truncated).toBe(false);
    expect(value.epicRollup.children[0]).toMatchObject({ id: child.id, title: 'Child card', columnId: 'backlog' });
    expect(value.project).toMatchObject({ id: f.project.id });
    expect(value.board).toMatchObject({ id: f.board.id, name: 'Kanban' });
    expect(value.hub).toMatchObject({ id: f.hub.id, name: 'My Hub' });
  });

  it('omits the roll-up for a card without children and never descends into a nested epic', async () => {
    const f = await setup();
    const top = await f.store.createTask({ projectId: f.project.id, title: 'Top epic', description: '' });
    const middle = await f.store.createTask({ projectId: f.project.id, title: 'Middle epic', description: '' });
    const leaf = await f.store.createTask({ projectId: f.project.id, title: 'Leaf card', description: '' });
    await f.store.createRelations([{ type: 'epic', from: top.id, to: middle.id }, { type: 'epic', from: middle.id, to: leaf.id }]);
    const topCard = await f.run('get_card', { task_id: top.id }) as Record<string, unknown> & { epicRollup: { children: Array<{ id: string }>; total: number } };
    expect(topCard.epicRollup.total).toBe(1);
    expect(topCard.epicRollup.children.map(child => child.id)).toEqual([middle.id]);
    const middleCard = await f.run('get_card', { task_id: middle.id }) as Record<string, unknown> & { epicRollup: { children: Array<{ id: string }>; total: number } };
    expect(middleCard.epicRollup.children.map(child => child.id)).toEqual([leaf.id]);
    const leafCard = await f.run('get_card', { task_id: leaf.id }) as Record<string, unknown>;
    expect(leafCard.epicRollup).toBeUndefined();
  });

  it('truncates a roll-up over the accepted limit and reports the total', async () => {
    const f = await setup();
    const epic = await f.store.createTask({ projectId: f.project.id, title: 'Big epic', description: '' });
    const relations = [];
    for (let index = 0; index < 51; index += 1) {
      const child = await f.store.createTask({ projectId: f.project.id, title: 'Child ' + index, description: '' });
      relations.push({ type: 'epic' as const, from: epic.id, to: child.id });
    }
    await f.store.createRelations(relations);
    const value = await f.run('get_card', { task_id: epic.id }) as { epicRollup: { children: unknown[]; total: number; truncated: boolean } };
    expect(value.epicRollup.children).toHaveLength(50);
    expect(value.epicRollup.total).toBe(51);
    expect(value.epicRollup.truncated).toBe(true);
  });

  it('reads a running conversation through the durable read and reports an unresolved one as unavailable', async () => {
    const f = await setup();
    const task = await f.store.createTask({ projectId: f.project.id, title: 'Busy card', description: '' });
    await f.store.addSession(task.id, 'busy-session');
    f.sessions.busy.add('busy-session');
    // A listing never waits on a cold native read, so the first scan is honest about not knowing.
    const [cold] = await f.run('list_cards', { board_id: f.board.id }) as Array<{ activity: { available: boolean; running: boolean } }>;
    expect(cold!.activity).toMatchObject({ available: false, running: false });
    // The durable read resolves it, and the next listing reports the running turn.
    const card = await f.run('get_card', { task_id: task.id }) as { activity: { available: boolean; running: boolean } };
    expect(card.activity).toMatchObject({ available: true, running: true });
    const [warm] = await f.run('list_cards', { board_id: f.board.id }) as Array<{ activity: { available: boolean; running: boolean } }>;
    expect(warm!.activity).toMatchObject({ available: true, running: true });
  });

  it('ignores a closed conversation', async () => {
    const f = await setup();
    const task = await f.store.createTask({ projectId: f.project.id, title: 'Closed card', description: '' });
    await f.store.addSession(task.id, 'closed-session');
    await f.store.closeSession(task.id, 'closed-session');
    f.sessions.busy.add('closed-session');
    const card = await f.run('get_card', { task_id: task.id }) as { activity: { available: boolean; running: boolean } };
    expect(card.activity).toMatchObject({ available: true, running: false });
  });

  it('reports an unreadable native fact as unavailable through the real host path', async () => {
    const f = await setup();
    const task = await f.store.createTask({ projectId: f.project.id, title: 'Unreadable card', description: '' });
    await f.store.addSession(task.id, 'lost-session');
    f.sessions.facts = async () => { throw new Error('native facts lost'); };
    const card = await f.run('get_card', { task_id: task.id }) as { activity: { available: boolean; running: boolean } };
    expect(card.activity).toMatchObject({ available: false, running: false });
  });

  it('reports activity as unavailable without failing the read when the injected source throws', async () => {
    const unavailable: TaskActivitySource = { activity: async () => { throw new Error('native facts lost'); } };
    const f = await setup({ activity: unavailable });
    await f.store.createTask({ projectId: f.project.id, title: 'Unknown activity', description: '' });
    const [listed] = await f.run('list_cards', { board_id: f.board.id }) as Array<{ activity: { available: boolean; running: boolean } }>;
    expect(listed!.activity).toMatchObject({ available: false, running: false });
  });

  it('uses the injected activity source for a card read', async () => {
    const injected: TaskActivitySource = { activity: async () => ({ available: true, running: true, pending: ['approval'], queuedPrompts: 2, backgroundCount: 1, settledTurns: [{ sessionId: 's', outcome: 'ok' }] }) };
    const f = await setup({ activity: injected });
    const task = await f.store.createTask({ projectId: f.project.id, title: 'Injected', description: '' });
    const value = await f.run('get_card', { task_id: task.id }) as { activity: Record<string, unknown> };
    expect(value.activity).toEqual({ available: true, running: true, pending: ['approval'], queuedPrompts: 2, backgroundCount: 1, settledTurns: [{ sessionId: 's', outcome: 'ok' }] });
  });
});
