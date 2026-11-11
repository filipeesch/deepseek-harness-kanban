import { describe, expect, it, vi } from 'vitest';
import { InterCardMessaging } from '../../src/host/inter-card-messaging.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import { fakeLocatedTask } from './helpers.js';

function setup(options: { hubId?: string; targetOpen?: string[] } = {}) {
  const sender = fakeLocatedTask({ taskId: 'sender', title: 'Sender', open: ['sender-session'] });
  const targets = new Map<string, LocatedTask>([
    ['sender', sender],
    ['target', fakeLocatedTask({ taskId: 'target', title: 'Target', open: options.targetOpen ?? [], ...(options.hubId === undefined ? {} : { hubId: options.hubId }) })],
  ]);
  const delivery = { deliver: vi.fn(async (_sessionId: string, _delivery: unknown) => {}) };
  const prepare = vi.fn(async () => ({ sessionId: 'prepared-session', createdConversation: true, createdWorktree: { path: '/tree', branch: 'target' } }));
  const service = new InterCardMessaging({
    locateBySession: id => id === 'sender-session' ? sender : undefined,
    locate: id => targets.get(id),
    prepare,
    delivery,
  });
  return { service, sender, targets, delivery, prepare, setTarget: (next: LocatedTask) => { targets.set('target', next); } };
}

describe('inter-card messaging service', () => {
  it('delivers to the first open conversation and reports the result', async () => {
    const f = setup({ targetOpen: ['target-session'] });
    const result = await f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'target', body: 'Ship it.', callId: 'call-1' });
    expect(result).toEqual({
      delivered: true,
      requestId: 'task-message:sender-session:call-1',
      senderTaskId: 'sender',
      target: { taskId: 'target', title: 'Target', sessionId: 'target-session' },
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

  it('rejects a message to the sending task', async () => {
    const f = setup();
    await expect(f.service.send({ senderSessionId: 'sender-session', targetTaskId: 'sender', body: 'Hi', callId: 'c' }))
      .rejects.toMatchObject({ code: 'SELF_MESSAGE' });
    expect(f.delivery.deliver).not.toHaveBeenCalled();
  });
});
