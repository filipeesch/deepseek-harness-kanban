// The host unit lane has no native driver, so the turn a cross-card message would
// start is represented by observing its boundary. Delivery goes through the real
// InterCardMessaging path; the native start semantics remain covered by the host
// runtime and by the messages and declared-transition end-to-end lanes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KanbanApp } from '../../src/host/app.js';
import { InterCardMessaging } from '../../src/host/inter-card-messaging.js';
import { TURN_ADVANCE_SETTLE_MS } from '../../src/host/turn-advance.js';
import type { TaskMessageDelivery } from '../../src/shared/task-message.js';
import { fixture, taskWithConversation } from './helpers.js';

/**
 * The stage that receives the request configures exactly one transition, so a
 * declaration can move the task without auto mode and without an instruction
 * that would start another turn.
 */
const PEER_FLOW = [
  'name: Peer flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    allowed_transitions: [plan]',
  '  - id: plan',
  '    label: Plan',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

const BLOCKED_FLOW = [
  'name: Silent flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: plan',
  '    label: Plan',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Delivered = { sessionId: string; delivery: TaskMessageDelivery };

let active: Fixture[] = [];
afterEach(async () => { vi.useRealTimers(); for (const f of active.splice(0)) await f.close(); });
async function setup(): Promise<Fixture> { const f = await fixture(); active.push(f); return f; }

const turnEnd = (seq: number) => ({ type: 'turn/end', seq, data: { turn: 1, reason: { kind: 'completed' } } });

/** The messaging policy over the fixture's task locator and a recording delivery port. */
function messaging(f: Fixture, delivered: Delivered[]): InterCardMessaging {
  return new InterCardMessaging({
    locateBySession: sessionId => f.app.locator.bySession(sessionId),
    locate: taskId => f.app.locator.byTask(taskId),
    prepare: async () => { throw new Error('the composition test always has an open conversation'); },
    delivery: { deliver: async (sessionId, delivery) => { delivered.push({ sessionId, delivery }); } },
  });
}

/** Observe a completed turn and let the host's settle delay elapse. */
async function endTurn(app: KanbanApp, sessionId: string, seq: number): Promise<void> {
  vi.useFakeTimers();
  try {
    app.observe(sessionId, turnEnd(seq));
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
  } finally {
    vi.useRealTimers();
  }
}

async function peerTasks(f: Fixture) {
  const sender = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Coordinator', description: '' });
  const target = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Reviewer', description: '' });
  return { sender, target };
}

async function requestTransition(f: Fixture, service: InterCardMessaging, senderTaskId: string, targetTaskId: string) {
  const senderSessionId = f.store.requireTask(senderTaskId).sessionIds[0]!;
  return service.send({
    senderSessionId,
    targetTaskId,
    body: 'Please declare the transition to plan with the reason "The coordinator finished its stage."',
    callId: 'call-1',
  });
}

describe('a peer-requested declared advance', () => {
  it('moves the receiving task at the end of the turn the message started', async () => {
    const f = await setup();
    await f.store.setWorkflow(PEER_FLOW);
    const { sender, target } = await peerTasks(f);
    const delivered: Delivered[] = [];
    const service = messaging(f, delivered);

    const before = f.store.requireTask(target.id);
    const senderBefore = f.store.requireTask(sender.id);
    const result = await requestTransition(f, service, sender.id, target.id);
    expect(result.delivered).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.sessionId).toBe(target.sessionIds[0]);
    // Delivery alone moves neither the receiving nor the sending card.
    const deliveredTask = f.store.requireTask(target.id);
    expect(deliveredTask.columnId).toBe(before.columnId);
    expect(deliveredTask.position).toBe(before.position);
    const deliveredSender = f.store.requireTask(sender.id);
    expect(deliveredSender.columnId).toBe(senderBefore.columnId);
    expect(deliveredSender.position).toBe(senderBefore.position);

    // The receiving conversation declares during the turn that message started.
    await f.app.recordTransition(target.id, { columnId: 'plan', reason: 'The coordinator asked for the next stage.' });
    expect(f.store.requireTask(target.id).columnId).toBe(before.columnId);

    await endTurn(f.app, target.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(target.id).columnId).toBe('plan');
    expect(f.store.requireTask(target.id).autoMode).toBeUndefined();
    expect(f.store.requireTask(target.id).recordedTransition).toBeUndefined();
    // The message itself moved nothing: the sending task stays where it was.
    const finalSender = f.store.requireTask(sender.id);
    expect(finalSender.columnId).toBe(senderBefore.columnId);
    expect(finalSender.position).toBe(senderBefore.position);
  });

  it('moves nothing when the message-started turn ends without a declaration', async () => {
    const f = await setup();
    await f.store.setWorkflow(PEER_FLOW);
    const { sender, target } = await peerTasks(f);
    const delivered: Delivered[] = [];
    const service = messaging(f, delivered);

    const before = f.store.requireTask(target.id);
    const senderBefore = f.store.requireTask(sender.id);
    const result = await requestTransition(f, service, sender.id, target.id);
    expect(result.delivered).toBe(true);
    expect(delivered).toHaveLength(1);
    const deliveredTask = f.store.requireTask(target.id);
    expect(deliveredTask.columnId).toBe(before.columnId);
    expect(deliveredTask.position).toBe(before.position);

    await endTurn(f.app, target.sessionIds[0]!, 1);
    const after = f.store.requireTask(target.id);
    expect(after.columnId).toBe(before.columnId);
    expect(after.position).toBe(before.position);
    expect(after.pendingTransition).toBeUndefined();
    const senderAfter = f.store.requireTask(sender.id);
    expect(senderAfter.columnId).toBe(senderBefore.columnId);
    expect(senderAfter.position).toBe(senderBefore.position);
  });

  it('rejects the declaration when the receiving stage configures no transition', async () => {
    const f = await setup();
    await f.store.setWorkflow(BLOCKED_FLOW);
    const { sender, target } = await peerTasks(f);
    const delivered: Delivered[] = [];
    const service = messaging(f, delivered);

    const result = await requestTransition(f, service, sender.id, target.id);
    expect(result.delivered).toBe(true);

    // The message is delivered under the ordinary rules; the failure belongs to
    // the receiving task, which cannot declare a target its stage does not offer.
    await expect(f.app.recordTransition(target.id, { columnId: 'plan', reason: 'Requested by the coordinator.' }))
      .rejects.toMatchObject({ code: 'TRANSITIONS_NOT_CONFIGURED' });
    await endTurn(f.app, target.sessionIds[0]!, 1);
    expect(f.store.requireTask(target.id).columnId).toBe('backlog');
  });
});
