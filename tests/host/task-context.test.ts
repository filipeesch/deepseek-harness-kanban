import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { buildTaskContextText, registerTaskContextInjection } from '../../src/host/task-context.js';
import type { BoardState, Task } from '../../src/shared/types.js';

const task: Task = {
  id: 'task-1', projectId: 'project', title: 'Alpha task', description: 'Task details', columnId: 'plan', position: 0,
  sessionIds: ['session-1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
  createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z',
};
const state = {
  schemaVersion: 2, revision: 1, workflowYaml: '',
  workflow: { name: 'Delivery', initialColumnId: 'backlog', columns: [{ id: 'backlog', name: 'Backlog' }, { id: 'plan', name: 'Plan' }], groups: [] },
  projects: [], tasks: [task], notes: [],
} as BoardState;
const store = { snapshot: () => state };
const userMessage = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
const enter = (messages: ReturnType<typeof userMessage>[]) => async () => ({ kind: 'enter' as const, messages });

function setup(options: { events?: readonly unknown[]; inspect?: (id: string) => Promise<{ events: readonly unknown[] }> } = {}) {
  const ctx = new Context();
  let events = options.events ?? [];
  const inspect = vi.fn(options.inspect ?? (async () => ({ events })));
  const report = vi.fn();
  const dispose = registerTaskContextInjection(ctx, store, { inspect, report });
  const signal = new AbortController().signal;
  const step = (agent: Agent, messages: ReturnType<typeof userMessage>[]) => ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1, signal, messages }, enter(messages));
  return { ctx, inspect, report, dispose, step, setEvents: (next: readonly unknown[]) => { events = next; }, agent: { id: SessionId('session-1') } as Agent };
}

describe('task context injection', () => {
  it('builds the task envelope with the first-contact stage', () => {
    const text = buildTaskContextText(task, 'Plan');
    expect(text).toContain('Alpha task (task-1)');
    expect(text).toContain('Task details');
    expect(text).toContain('Workflow stage at first contact: Plan');
  });

  it('prepends the context on the first step with messages and marks the agent checked', async () => {
    const f = setup();
    const first = await f.step(f.agent, [userMessage('Hello')]);
    expect(first.kind).toBe('enter');
    if (first.kind !== 'enter') throw new Error('expected enter');
    expect(first.messages).toHaveLength(2);
    expect(first.messages[0]!.role).toBe('user');
    expect(first.messages[0]!.source).toMatchObject({ kind: 'kanban-task' });
    expect((first.messages[0]!.content[0] as { text: string }).text).toContain('Workflow stage at first contact: Plan');
    expect(first.messages[1]!.content).toEqual([{ type: 'text', text: 'Hello' }]);

    f.setEvents([{ type: 'user/message' }]);
    const second = await f.step(f.agent, [userMessage('Again')]);
    if (second.kind !== 'enter') throw new Error('expected enter');
    expect(second.messages).toHaveLength(1);
    const third = await f.step(f.agent, [userMessage('Again')]);
    if (third.kind !== 'enter') throw new Error('expected enter');
    expect(third.messages).toHaveLength(1);
    expect(f.inspect).toHaveBeenCalledTimes(2);
    f.dispose();
  });

  it('does not inspect or inject an aborted first step', async () => {
    const f = setup();
    const controller = new AbortController(); controller.abort();
    const result = await f.ctx.waterfall('agent/pre-step', { agent: f.agent, turn: 1, step: 1, signal: controller.signal, messages: [userMessage('Hello')] }, enter([userMessage('Hello')]));
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    expect(f.inspect).not.toHaveBeenCalled();
    f.dispose();
  });

  it('leaves an empty step unchanged and injects on the next step with messages', async () => {
    const f = setup();
    const empty = await f.step(f.agent, []);
    if (empty.kind !== 'enter') throw new Error('expected enter');
    expect(empty.messages).toHaveLength(0);
    expect(f.inspect).not.toHaveBeenCalled();

    const next = await f.step(f.agent, [userMessage('Hello')]);
    if (next.kind !== 'enter') throw new Error('expected enter');
    expect(next.messages).toHaveLength(2);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    f.dispose();
  });

  it('does not inject when the history already has a user message', async () => {
    const f = setup({ events: [{ type: 'user/message' }] });
    const result = await f.step(f.agent, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    f.dispose();
  });

  it('does not inspect or change a step for an unrelated agent', async () => {
    const f = setup();
    const other = { id: SessionId('other-session') } as Agent;
    const result = await f.step(other, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(1);
    expect(f.inspect).not.toHaveBeenCalled();
    f.dispose();
  });

  it('returns a rejected decision unchanged without inspecting history', async () => {
    const ctx = new Context();
    const inspect = vi.fn(async () => ({ events: [] }));
    const dispose = registerTaskContextInjection(ctx, store, { inspect });
    const agent = { id: SessionId('session-1') } as Agent;
    const decision = await ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1, signal: new AbortController().signal, messages: [userMessage('Hello')] }, async () => ({ kind: 'reject' as const }));
    expect(decision).toEqual({ kind: 'reject' });
    expect(inspect).not.toHaveBeenCalled();
    dispose();
  });

  it('retries after an inspection failure and injects on the next step', async () => {
    let fail = true;
    const f = setup({ inspect: async () => { if (fail) throw new Error('history unavailable'); return { events: [] }; } });
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
    expect(f.inspect).toHaveBeenCalledTimes(2);
    f.dispose();
  });

  it('re-evaluates the same agent after a clear', async () => {
    const f = setup();
    await f.step(f.agent, [userMessage('Hello')]);
    await f.ctx.serial('agent/created', { agent: f.agent, source: 'clear' });
    const result = await f.step(f.agent, [userMessage('Hello')]);
    if (result.kind !== 'enter') throw new Error('expected enter');
    expect(result.messages).toHaveLength(2);
    expect(f.inspect).toHaveBeenCalledTimes(2);
    f.dispose();
  });
});
