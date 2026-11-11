import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createTaskMessageDelivery } from '../../src/host/task-message-delivery.js';
import type { TaskMessageDelivery } from '../../src/shared/task-message.js';

const delivery: TaskMessageDelivery = {
  requestId: 'task-message:session-1:call-1',
  senderSessionId: 'session-1',
  senderTaskId: 'task-1',
  text: 'Message from task "Prepare release" (task-1).',
  summary: 'Task message from Prepare release',
};
const agent = { id: 'target-session' } as unknown as Agent;

function recorded(requestId: string): unknown {
  return { type: 'user/message', data: { id: 'message-1', source: { kind: 'task-message', form: 'notice', summary: 'Task message', requestId } } };
}

function spliced(requestId: string, outcome: 'canceled' | undefined = 'canceled'): unknown {
  return {
    type: 'agent/inbox/spliced',
    data: {
      target: 'next-step', start: 0,
      inserted: [{ id: 'message-1', role: 'user', content: [{ type: 'text', text: 'Message' }], source: { kind: 'task-message', form: 'notice', summary: 'Task message', requestId } }],
      ...(outcome === undefined ? {} : { outcome }),
    },
  };
}

function deps(overrides: Partial<Parameters<typeof createTaskMessageDelivery>[0]> = {}) {
  return {
    resolveAgent: vi.fn(async () => agent),
    pending: () => false,
    events: async () => [],
    steer: vi.fn(),
    ...overrides,
  };
}

describe('task message delivery', () => {
  it('steers the resolved target once', async () => {
    const options = deps();
    const port = createTaskMessageDelivery(options);
    await port.deliver('target-session', delivery);
    expect(options.resolveAgent).toHaveBeenCalledWith('target-session');
    expect(options.steer).toHaveBeenCalledTimes(1);
    expect(options.steer).toHaveBeenCalledWith(agent, expect.objectContaining({ source: expect.objectContaining({ kind: 'task-message' }) }));
  });

  it('joins a repeated delivery identity instead of steering twice', async () => {
    const options = deps();
    const port = createTaskMessageDelivery(options);
    await port.deliver('target-session', delivery);
    await port.deliver('target-session', delivery);
    expect(options.steer).toHaveBeenCalledTimes(1);
  });

  it('skips an identity the resolved inbox already holds without reading history', async () => {
    const events = vi.fn(async () => []);
    const options = deps({ pending: () => true, events });
    const port = createTaskMessageDelivery(options);
    await port.deliver('target-session', delivery);
    expect(options.steer).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it('skips an identity the durable log already records', async () => {
    const options = deps({ events: async () => [recorded(delivery.requestId)] });
    const port = createTaskMessageDelivery(options);
    await port.deliver('target-session', delivery);
    expect(options.steer).not.toHaveBeenCalled();
  });

  it('skips an identity a canceled steering admission already recorded', async () => {
    const options = deps({ events: async () => [spliced(delivery.requestId, 'canceled')] });
    const port = createTaskMessageDelivery(options);
    await port.deliver('target-session', delivery);
    expect(options.steer).not.toHaveBeenCalled();
  });

  it('keeps a fresh adapter from redelivering after a restart with only the canceled insertion', async () => {
    let events: unknown[] = [];
    const first = deps({ events: async () => events });
    await createTaskMessageDelivery(first).deliver('target-session', delivery);
    // The host admitted the steering, then canceled it before model admission;
    // only the durable inbox insertion remains.
    events = [spliced(delivery.requestId)];
    const second = deps({ events: async () => events });
    await createTaskMessageDelivery(second).deliver('target-session', delivery);
    expect(first.steer).toHaveBeenCalledTimes(1);
    expect(second.steer).not.toHaveBeenCalled();
  });

  it('delivers when the inbox admission belongs to another identity', async () => {
    const options = deps({ events: async () => [spliced('task-message:session-1:other')] });
    const port = createTaskMessageDelivery(options);
    await port.deliver('target-session', delivery);
    expect(options.steer).toHaveBeenCalledTimes(1);
  });

  it('delivers a different identity again', async () => {
    const options = deps({ events: async () => [recorded('task-message:session-1:other')] });
    const port = createTaskMessageDelivery(options);
    await port.deliver('target-session', delivery);
    expect(options.steer).toHaveBeenCalledTimes(1);
  });

  it('reports a failed steer and allows a later retry', async () => {
    let attempts = 0;
    const options = deps({ steer: () => { attempts += 1; if (attempts === 1) throw new Error('admission failed'); } });
    const port = createTaskMessageDelivery(options);
    await expect(port.deliver('target-session', delivery)).rejects.toThrow('admission failed');
    await port.deliver('target-session', delivery);
    expect(attempts).toBe(2);
  });

  it('propagates an unresolvable target without steering', async () => {
    const options = deps({ resolveAgent: async () => { throw new Error('missing session'); } });
    const port = createTaskMessageDelivery(options);
    await expect(port.deliver('target-session', delivery)).rejects.toThrow('missing session');
    expect(options.steer).not.toHaveBeenCalled();
  });
});
