import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { buildTaskContextText, createTaskContextMessage, FIRST_CONTACT_LABEL, registerTaskContextInjection } from '../../src/host/task-context.js';
import { WORKFLOW_MAP_BUDGET } from '../../src/host/workflow-map.js';
import type { Board, ConversationFacts, HubSharingView, HubState, HubTask } from '../../src/shared/types.js';

const task: HubTask = {
  id: 'task-1', boardId: 'board', projectId: 'project', title: 'Alpha task', description: 'Task details', columnId: 'plan', position: 0,
  sessionIds: ['session-1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
  createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z',
};
const workflow = { name: 'Delivery', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }, { id: 'plan', name: 'Plan' }], groups: [] };
const board: Board = { id: 'board', name: 'Delivery board', workflowYaml: '', workflow, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' };
const project = { id: 'project', name: 'Project', projectKey: 'project', projectPath: '/repo', gitRootPath: '/repo' };
const hub: HubState = { id: 'hub', name: 'Product Hub', revision: 1, projects: [project], boards: [board], tasks: [task], notes: [], createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' };
const locator = { bySession: (id: string) => id === 'session-1' ? { hubId: 'hub', hub, board, project, task } : undefined };
const userMessage = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
const enter = (messages: ReturnType<typeof userMessage>[]) => async () => ({ kind: 'enter' as const, messages });

function setup(options: { events?: readonly unknown[]; read?: (id: string) => Promise<{ events: readonly unknown[] }>; conversationFacts?: (id: string) => Promise<ConversationFacts>; sharingView?: (id: string) => HubSharingView | undefined } = {}) {
  const ctx = new Context();
  let events = options.events ?? [];
  const read = vi.fn(options.read ?? (async () => ({ events })));
  const report = vi.fn();
  const dispose = registerTaskContextInjection(ctx, locator, { history: { read }, report, conversationFacts: options.conversationFacts, sharingView: options.sharingView });
  const signal = new AbortController().signal;
  const step = (agent: Agent, messages: ReturnType<typeof userMessage>[]) => ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal, messages }, enter(messages));
  return { ctx, read, report, dispose, step, setEvents: (next: readonly unknown[]) => { events = next; }, agent: { id: SessionId('session-1') } as Agent };
}

describe('task context injection', () => {
  it('builds the task envelope with the first-contact stage', () => {
    const text = buildTaskContextText(task, 'Plan', 'Product Hub', board);
    expect(text).toContain('Alpha task (task-1)');
    expect(text).toContain('Task details');
    expect(text).toContain('Hub: Product Hub');
    expect(text).toContain('Board: Delivery board');
    expect(text).toContain('Workflow stage at first contact: Plan');
  });

  it('embeds the workflow map under the first-contact label', () => {
    const text = (createTaskContextMessage({ task, board, hub }).content[0] as { text: string }).text;
    const part = text.slice(text.indexOf(FIRST_CONTACT_LABEL));
    expect(part.startsWith('Workflow first-contact snapshot (not live; use get_workflow_summary for current details):\nWorkflow: Delivery')).toBe(true);
    expect(part).toContain('Task stage: Plan (plan)');
    expect(part).toContain('* plan | Plan | no-instruction | unrestricted');
    expect(part).toContain('  backlog | Backlog | no-instruction | unrestricted');
    expect(Buffer.byteLength(part)).toBeLessThanOrEqual(WORKFLOW_MAP_BUDGET + FIRST_CONTACT_LABEL.length);
  });

  it('identifies a decision gate in the first-contact map', () => {
    const gated = { ...board, workflow: { ...workflow, columns: [
      { id: 'gate', name: 'Gate', decision: { question: 'Proceed?', options: [{ id: 'ship', title: 'Ship it', to: 'plan' }] } },
      { id: 'plan', name: 'Plan' },
    ] } };
    const text = (createTaskContextMessage({ task: { ...task, columnId: 'gate' }, board: gated, hub }).content[0] as { text: string }).text;
    expect(text).toContain('* gate | Gate | decision | decision');
    expect(text).toContain('exits: option ship (Ship it) -> plan');
    expect(text).not.toContain('Proceed?');
  });

  it('records the stage entry the context describes on its durable source', () => {
    const entered = { ...task, stageEntry: { id: 'entry-1', columnId: 'plan', stageIdentity: 'plan', enteredAt: '2026-10-23T00:00:00Z' } };
    expect(createTaskContextMessage({ task: entered, board, hub }).source).toMatchObject({ kind: 'kanban-task', entryId: 'entry-1', columnId: 'plan' });
    expect(createTaskContextMessage({ task, board, hub }).source).toEqual({ kind: 'kanban-task' });
  });

  it('reads pending facts and distinguishes unpublished from unavailable sharing', async () => {
    const facts: ConversationFacts = { running: false, background: [], settledTurn: null, pending: { kinds: ['native-question'], queuedPrompts: 0 } };
    const f = setup({ conversationFacts: async () => facts, sharingView: () => undefined });
    const result = await f.step(f.agent, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    const text = (result.messages[0]!.content[0] as { text: string }).text;
    expect(text).toContain('Auto mode: disabled, not paused, held');
    expect(text).toContain('Sharing: not-published, board not bound');
    f.dispose();
    const failed = setup({ conversationFacts: async () => { throw new Error('facts offline'); }, sharingView: () => { throw new Error('sharing offline'); } });
    const fallback = await failed.step(failed.agent, [userMessage('Hello')]);
    if (fallback.kind !== 'enter') throw new Error('expected enter');
    const fallbackText = (fallback.messages[0]!.content[0] as { text: string }).text;
    expect(fallbackText).toContain('hold unknown');
    expect(fallbackText).toContain('Sharing: unavailable');
    failed.dispose();
    const published = setup({ conversationFacts: async () => ({ ...facts, pending: { kinds: [], queuedPrompts: 0 } }), sharingView: () => ({ status: 'synced', boards: [{ boardId: 'board', bound: true, state: 'clean' }] } as unknown as HubSharingView) });
    const synced = await published.step(published.agent, [userMessage('Hello')]);
    if (synced.kind !== 'enter') throw new Error('expected enter');
    const syncedText = (synced.messages[0]!.content[0] as { text: string }).text;
    expect(syncedText).toContain('not held');
    expect(syncedText).toContain('Sharing: synced, board bound');
    published.dispose();
  });

  it('prepends the context on the first step with messages and marks the agent checked', async () => {
    const f = setup();
    const first = await f.step(f.agent, [userMessage('Hello')]);
    expect(first.kind).toBe('enter');
    if (first.kind !== 'enter') throw new Error('expected enter');
    expect(first.messages).toHaveLength(2);
    expect((first.messages[0]!.content[0] as { text: string }).text).toContain('hold unknown');
    expect((first.messages[0]!.content[0] as { text: string }).text).toContain('Sharing: unavailable');
    expect(first.messages[0]!.role).toBe('user');
    expect(first.messages[0]!.source).toMatchObject({ kind: 'kanban-task' });
    expect((first.messages[0]!.content[0] as { text: string }).text).toContain('Workflow stage at first contact: Plan');
    expect((first.messages[0]!.content[0] as { text: string }).text).toContain('Workflow first-contact snapshot');
    expect(first.messages[1]!.content).toEqual([{ type: 'text', text: 'Hello' }]);

    f.setEvents([{ type: 'user/message' }]);
    const second = await f.step(f.agent, [userMessage('Again')]);
    if (second.kind !== 'enter') throw new Error('expected enter');
    expect(second.messages).toHaveLength(1);
    const third = await f.step(f.agent, [userMessage('Again')]);
    if (third.kind !== 'enter') throw new Error('expected enter');
    expect(third.messages).toHaveLength(1);
    expect(f.read).toHaveBeenCalledTimes(2);
    f.dispose();
  });

  it('does not inspect or inject an aborted first step', async () => {
    const f = setup();
    const controller = new AbortController(); controller.abort();
    const result = await f.ctx.waterfall('agent/pre-step', { agent: f.agent, turn: 1, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal: controller.signal, messages: [userMessage('Hello')] }, enter([userMessage('Hello')]));
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    expect(f.read).not.toHaveBeenCalled();
    f.dispose();
  });

  it('leaves an empty step unchanged and injects on the next step with messages', async () => {
    const f = setup();
    const empty = await f.step(f.agent, []);
    if (empty.kind !== 'enter') throw new Error('expected enter');
    expect(empty.messages).toHaveLength(0);
    expect(f.read).not.toHaveBeenCalled();

    const next = await f.step(f.agent, [userMessage('Hello')]);
    if (next.kind !== 'enter') throw new Error('expected enter');
    expect(next.messages).toHaveLength(2);
    expect(f.read).toHaveBeenCalledTimes(1);
    f.dispose();
  });

  it('does not inject when the history already has a user message', async () => {
    const f = setup({ events: [{ type: 'user/message' }] });
    const result = await f.step(f.agent, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    expect(f.read).toHaveBeenCalledTimes(1);
    f.dispose();
  });

  it('does not inspect or change a step for an unrelated agent', async () => {
    const f = setup();
    const other = { id: SessionId('other-session') } as Agent;
    const result = await f.step(other, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    expect(f.read).not.toHaveBeenCalled();
    f.dispose();
  });

  it('returns a rejected decision unchanged without inspecting history', async () => {
    const ctx = new Context();
    const read = vi.fn(async () => ({ events: [] }));
    const dispose = registerTaskContextInjection(ctx, locator, { history: { read } });
    const agent = { id: SessionId('session-1') } as Agent;
    const decision = await ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal: new AbortController().signal, messages: [userMessage('Hello')] }, async () => ({ kind: 'reject' as const }));
    expect(decision).toEqual({ kind: 'reject' });
    expect(read).not.toHaveBeenCalled();
    dispose();
  });

  it('retries after an inspection failure and injects on the next step', async () => {
    let fail = true;
    const f = setup({ read: async () => { if (fail) throw new Error('history unavailable'); return { events: [] }; } });
    const first = await f.step(f.agent, [userMessage('Hello')]);
    if (first.kind !== 'enter') throw new Error('expected enter');
    expect(first.messages).toHaveLength(1);
    expect(f.report).toHaveBeenCalledOnce();
    fail = false;
    const second = await f.step(f.agent, [userMessage('Hello')]);
    if (second.kind !== 'enter') throw new Error('expected enter');
    expect(second.messages).toHaveLength(2);
    expect(f.report).toHaveBeenCalledOnce();
    f.dispose();
  });

  it('does not inject after the listener is disposed', async () => {
    const f = setup(); f.dispose();
    const result = await f.step(f.agent, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
  });

  it('injects for a new agent even when its first step has no prior history', async () => {
    const f = setup();
    const firstAgent = { id: SessionId('session-1') } as Agent;
    await f.step(firstAgent, [userMessage('Hello')]);
    const resumed = { id: SessionId('session-1') } as Agent;
    const result = await f.step(resumed, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(2);
    expect(f.read).toHaveBeenCalledTimes(2);
    f.dispose();
  });

  it('re-evaluates the same agent after a clear', async () => {
    const f = setup();
    await f.step(f.agent, [userMessage('Hello')]);
    await f.ctx.serial('agent/created', { agent: f.agent, source: 'clear' });
    const result = await f.step(f.agent, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(2);
    expect(f.read).toHaveBeenCalledTimes(2);
    f.dispose();
  });
});
