import { describe, expect, it, vi } from 'vitest';
import { InterCardMessaging, type InterCardMessagingDeps } from '../../src/host/inter-card-messaging.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import type { TaskActivity } from '../../src/shared/types.js';
import { fakeLocatedTask } from './helpers.js';

function setup(options: { hubId?: string; targetOpen?: string[]; activity?: InterCardMessagingDeps['activity']; agents?: readonly string[]; senderRole?: string } = {}) {
  const sender = fakeLocatedTask({ taskId: 'sender', title: 'Sender', open: ['sender-session'], ...(options.agents === undefined ? {} : { agents: options.agents }), ...(options.senderRole === undefined ? {} : { roles: { 'sender-session': { agent: options.senderRole } } }) });
  const targets = new Map<string, LocatedTask>([
    ['sender', sender],
    ['target', fakeLocatedTask({ taskId: 'target', title: 'Target', open: options.targetOpen ?? [], ...(options.agents === undefined ? {} : { agents: options.agents }), ...(options.hubId === undefined ? {} : { hubId: options.hubId }) })],
  ]);
  const delivery = { deliver: vi.fn(async (_sessionId: string, _delivery: unknown) => {}) };
  const hold = vi.fn(async (_taskId: string, _message: unknown) => {});
  const prepare = vi.fn(async () => ({ sessionId: 'prepared-session', createdConversation: true, createdWorktree: { path: '/tree', branch: 'target' } }));
  const agentConversation = vi.fn(async () => 'agent-session');
  const service = new InterCardMessaging({
    locateBySession: id => id === 'sender-session' ? sender : undefined,
    locate: id => targets.get(id),
    prepare,
    hold,
    agentConversation,
    delivery,
    ...(options.activity === undefined ? {} : { activity: options.activity }),
  });
  return { service, sender, targets, delivery, prepare, hold, agentConversation, setTarget: (next: LocatedTask) => { targets.set('target', next); } };
}

describe('inter-card messaging service', () => {
  it('delivers to the first open conversation and reports the result', async () => {
    const f = setup({ targetOpen: ['target-session'] });
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Ship it.', callId: 'call-1' });
    expect(result).toEqual({
      delivered: true,
      requestId: 'task-message:sender-session:call-1',
      senderTaskId: 'sender',
      target: {
        taskId: 'target', title: 'Target', sessionId: 'target-session', columnId: 'todo',
        activity: { available: false, running: false, pending: [], queuedPrompts: 0, backgroundCount: 0, settledTurns: [] },
      },
      createdConversation: false,
    });
    expect(f.prepare).not.toHaveBeenCalled();
    const [sessionId, raw] = f.delivery.deliver.mock.calls[0]!;
    const sent = raw as { requestId: string; senderSessionId: string; senderTaskId: string; summary: string; text: string };
    expect(sessionId).toBe('target-session');
    expect(sent).toMatchObject({
      requestId: 'task-message:sender-session:call-1',
      senderSessionId: 'sender-session',
      senderTaskId: 'sender',
      summary: 'Task message from Sender',
    });
    expect(sent.text).toContain('Sender');
    expect(sent.text).toContain('sender');
    expect(sent.text).toContain('Hub');
    expect(sent.text).toContain('Board');
    expect(sent.text).toContain('Ship it.');
  });

  it('reports the target stage and activity at delivery', async () => {
    const running: TaskActivity = { available: true, running: true, pending: ['approval'], queuedPrompts: 0, backgroundCount: 0, settledTurns: [] };
    const activity: InterCardMessagingDeps['activity'] = vi.fn(async () => running);
    const f = setup({ targetOpen: ['target-session'], activity });
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Check the build.', callId: 'call-1' });
    expect(result.target).toMatchObject({
      columnId: 'todo',
      activity: { available: true, running: true, pending: ['approval'] },
    });
    // The target's open conversations are the ones read, never the closed ones.
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ sessionIds: ['target-session'] }));
  });

  it('delivers even when the target activity cannot be read', async () => {
    const activity: InterCardMessagingDeps['activity'] = vi.fn(async () => { throw new Error('native facts lost'); });
    const f = setup({ targetOpen: ['target-session'], activity });
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Check the build.', callId: 'call-1' });
    expect(result.delivered).toBe(true);
    expect(f.delivery.deliver).toHaveBeenCalledTimes(1);
    expect(result.target.activity).toMatchObject({ available: false, running: false });
  });

  it('prepares the first conversation and reports the created resources', async () => {
    const f = setup();
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Ship it.', callId: 'call-1' });
    expect(f.prepare).toHaveBeenCalledWith('target');
    expect(result).toMatchObject({
      createdConversation: true,
      createdWorktree: { path: '/tree', branch: 'target' },
      target: { sessionId: 'prepared-session' },
    });
    expect(f.delivery.deliver.mock.calls[0]![0]).toBe('prepared-session');
  });

  it('uses a conversation that appeared while the preparation ran', async () => {
    const f = setup();
    f.prepare.mockImplementation(async () => {
      f.setTarget(fakeLocatedTask({ taskId: 'target', title: 'Target', open: ['concurrent'] }));
      return { sessionId: 'prepared-session', createdConversation: true, createdWorktree: { path: '/tree', branch: 'target' } };
    });
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Ship it.', callId: 'call-1' });
    expect(f.delivery.deliver.mock.calls[0]![0]).toBe('concurrent');
    expect(result).toMatchObject({ createdConversation: false, createdWorktree: { path: '/tree', branch: 'target' } });
  });

  it('derives a stable identity from the sending conversation and the call', async () => {
    const f = setup({ targetOpen: ['target-session'] });
    await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'One', callId: 'call-1' });
    await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'One again', callId: 'call-1' });
    await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Two', callId: 'call-2' });
    const ids = f.delivery.deliver.mock.calls.map(call => (call[1] as { requestId: string }).requestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it('skips a closed conversation and delivers to the next open one', async () => {
    const f = setup();
    const target = fakeLocatedTask({ taskId: 'target', title: 'Target', open: ['open-2'], closed: ['open-1'] });
    target.task.sessionIds = ['open-1', 'open-2'];
    target.task.closedSessionIds = ['open-1'];
    f.setTarget(target);
    await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Ship it.', callId: 'call-1' });
    expect(f.delivery.deliver.mock.calls[0]![0]).toBe('open-2');
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('prepares a conversation when every target conversation is closed', async () => {
    const f = setup();
    const target = fakeLocatedTask({ taskId: 'target', title: 'Target', open: ['closed-1'] });
    target.task.sessionIds = ['closed-1'];
    target.task.closedSessionIds = ['closed-1'];
    f.setTarget(target);
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Ship it.', callId: 'call-1' });
    expect(f.prepare).toHaveBeenCalledWith('target');
    expect(result.createdConversation).toBe(true);
    expect(f.delivery.deliver.mock.calls[0]![0]).toBe('prepared-session');
  });

  it('rejects a sender outside a task conversation', async () => {
    const f = setup();
    await expect(f.service.send({ senderSessionId: 'ordinary-session', targetTaskId: 'target', body: 'Hi', callId: 'c' }))
      .rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
    expect(f.delivery.deliver).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    const f = setup({ targetOpen: ['target-session'] });
    await expect(f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: '   ', callId: 'c' }))
      .rejects.toMatchObject({ code: 'EMPTY_MESSAGE' });
    expect(f.delivery.deliver).not.toHaveBeenCalled();
  });

  it('rejects a missing target', async () => {
    const f = setup();
    await expect(f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'missing', body: 'Hi', callId: 'c' }))
      .rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('rejects a target in another Hub', async () => {
    const f = setup({ hubId: 'other', targetOpen: ['target-session'] });
    await expect(f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Hi', callId: 'c' }))
      .rejects.toMatchObject({ code: 'CROSS_HUB_MESSAGE' });
    expect(f.delivery.deliver).not.toHaveBeenCalled();
  });

  it('delivers a message to the sending task main conversation', async () => {
    const f = setup();
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'sender', body: 'Hi', callId: 'c' });
    expect(result).toMatchObject({ delivered: true, target: { taskId: 'sender', sessionId: 'sender-session' } });
    expect(f.delivery.deliver).toHaveBeenCalledTimes(1);
    const [sessionId, raw] = f.delivery.deliver.mock.calls[0]!;
    expect(sessionId).toBe('sender-session');
    expect((raw as { text: string }).text).toContain('main conversation of this task');
  });

  it('addresses an agent of another task and refuses one it does not declare', async () => {
    const f = setup({ targetOpen: ['target-session'], agents: ['designer'] });
    // A reply to a specialist reaches that specialist's conversation on the other task.
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Hi', agent: 'designer', callId: 'c' });
    expect(result).toMatchObject({ delivered: true, target: { sessionId: 'agent-session' } });
    expect(f.agentConversation).toHaveBeenCalledWith('target', 'designer');
    await expect(f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Hi', agent: 'missing', callId: 'c' }))
      .rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
    // A destination stage still addresses only the sending task.
    await expect(f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Hi', deliverAt: 'todo', callId: 'c' }))
      .rejects.toMatchObject({ code: 'CROSS_TASK_ADDRESS' });
  });

  it('names the sending specialist so the reply reaches the conversation that asked', async () => {
    const f = setup({ targetOpen: ['target-session'], agents: ['designer'], senderRole: 'designer' });
    await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Design is done.', callId: 'c' });
    const sent = f.delivery.deliver.mock.calls[0]![1] as { text: string };
    expect(sent.text).toContain('designer conversation of task');
    expect(sent.text).toContain('agent "designer"');
  });

  it('holds a message for a later stage instead of delivering it now', async () => {
    const f = setup();
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'sender', body: 'Design is ready.', deliverAt: 'todo', callId: 'c' });
    expect(result).toMatchObject({ delivered: false, held: { columnId: 'todo' } });
    expect(f.delivery.deliver).not.toHaveBeenCalled();
    expect(f.hold).toHaveBeenCalledTimes(1);
    expect(f.hold.mock.calls[0]![1]).toMatchObject({ fromSessionId: 'sender-session', columnId: 'todo', body: 'Design is ready.' });
  });

  it('refuses a stage the workflow does not define', async () => {
    const f = setup();
    await expect(f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'sender', body: 'Hi', deliverAt: 'missing', callId: 'c' }))
      .rejects.toMatchObject({ code: 'STAGE_NOT_FOUND' });
  });
});
