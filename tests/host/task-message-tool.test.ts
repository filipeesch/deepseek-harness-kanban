import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { InterCardMessaging } from '../../src/host/inter-card-messaging.js';
import { productToolDefinitions } from '../../src/host/tools.js';
import { fakeLocatedTask, fixture } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

function execution(id = 'task-session', callId = 'call-1'): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id }, callId, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}

function tool(tools: ToolDefinition[], name: string): ToolDefinition {
  const definition = tools.find(candidate => candidate.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

function messaging(input: { targetOpen?: string[]; hubId?: string } = {}) {
  const sender = fakeLocatedTask({ taskId: 'sender', title: 'Sender', open: ['task-session'] });
  const target = fakeLocatedTask({ taskId: 'target', title: 'Target', open: input.targetOpen ?? ['target-session'], ...(input.hubId === undefined ? {} : { hubId: input.hubId }) });
  const delivery = { deliver: vi.fn(async (_sessionId: string, _delivery: unknown) => {}) };
  const service = new InterCardMessaging({
    locateBySession: id => id === 'task-session' ? sender : undefined,
    locate: id => id === 'target' ? target : id === 'sender' ? sender : undefined,
    prepare: async () => ({ sessionId: 'prepared-session', createdConversation: true }),
    delivery,
  });
  return { service, delivery };
}

describe('send_task_message tool', () => {
  it('is registered only when messaging is composed', async () => {
    const f = await setup();
    expect(productToolDefinitions(f.app).some(definition => definition.name === 'send_task_message')).toBe(false);
    const { service } = messaging();
    expect(tool(productToolDefinitions(f.app, f.app.boards, service), 'send_task_message').name).toBe('send_task_message');
  });

  it('exposes exactly the target task and body arguments', async () => {
    const f = await setup();
    const { service } = messaging();
    const definition = tool(productToolDefinitions(f.app, f.app.boards, service), 'send_task_message');
    const schema = definition.parameters as unknown as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties).sort()).toEqual(['message', 'task_id']);
    expect([...schema.required].sort()).toEqual(['message', 'task_id']);
    expect(schema.properties.task_id).toMatchObject({ type: 'string' });
    expect(schema.properties.message).toMatchObject({ type: 'string' });
    expect(definition.description).toContain('explicitly requests');
    expect(definition.description).toContain('reply');
  });

  it('requires an owning native conversation', async () => {
    const f = await setup();
    const { service } = messaging();
    const definition = tool(productToolDefinitions(f.app, f.app.boards, service), 'send_task_message');
    await expect(definition.execute({ task_id: 'target', message: 'Hi' }, { ...execution(), agent: undefined } as unknown as ToolRunContext))
      .rejects.toMatchObject({ code: 'MISSING_SESSION' });
  });

  it('rejects a sender outside a task conversation', async () => {
    const f = await setup();
    const { service, delivery } = messaging();
    const definition = tool(productToolDefinitions(f.app, f.app.boards, service), 'send_task_message');
    await expect(definition.execute({ task_id: 'target', message: 'Hi' }, execution('ordinary-session')))
      .rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('rejects a subagent session', async () => {
    const f = await setup();
    const { service } = messaging();
    const definition = tool(productToolDefinitions(f.app, f.app.boards, service), 'send_task_message');
    await expect(definition.execute({ task_id: 'target', message: 'Hi' }, execution('subagent-session')))
      .rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
  });

  it('rejects the sending task, a cross-Hub target, and an empty body', async () => {
    const f = await setup();
    const { service } = messaging();
    const definition = tool(productToolDefinitions(f.app, f.app.boards, service), 'send_task_message');
    await expect(definition.execute({ task_id: 'sender', message: 'Hi' }, execution())).rejects.toMatchObject({ code: 'SELF_MESSAGE' });
    const crossHub = messaging({ hubId: 'other' });
    const crossHubDefinition = tool(productToolDefinitions(f.app, f.app.boards, crossHub.service), 'send_task_message');
    await expect(crossHubDefinition.execute({ task_id: 'target', message: 'Hi' }, execution())).rejects.toMatchObject({ code: 'CROSS_HUB_MESSAGE' });
    await expect(definition.execute({ task_id: 'target', message: '   ' }, execution())).rejects.toMatchObject({ code: 'EMPTY_MESSAGE' });
  });

  it('delegates an accepted call with the sender, target, body, and call identity', async () => {
    const f = await setup();
    const { service, delivery } = messaging();
    const definition = tool(productToolDefinitions(f.app, f.app.boards, service), 'send_task_message');
    const result = await definition.execute({ task_id: 'target', message: 'Ship it.' }, execution('task-session', 'call-9'));
    expect(result).toMatchObject({
      delivered: true,
      requestId: 'task-message:task-session:call-9',
      senderTaskId: 'sender',
      target: { taskId: 'target', title: 'Target', sessionId: 'target-session' },
    });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    const [sessionId, raw] = delivery.deliver.mock.calls[0]!;
    const sent = raw as { requestId: string; senderSessionId: string; senderTaskId: string };
    expect(sessionId).toBe('target-session');
    expect(sent).toMatchObject({ requestId: 'task-message:task-session:call-9', senderSessionId: 'task-session', senderTaskId: 'sender' });
  });
});
