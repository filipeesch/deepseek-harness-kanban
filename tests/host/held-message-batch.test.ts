import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { composeHeldMessageDelivery } from '../../src/host/held-message-delivery.js';
import { registerHeldMessageBatch, type HeldMessageBatchPorts } from '../../src/host/held-message-batch.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import { createStageInstructionMessage } from '../../src/host/stage-message.js';
import { createStageNoticeMessage } from '../../src/host/stage-notice.js';
import { createTaskMessage } from '../../src/host/task-message.js';
import type { HeldMessage, HubTask, Workflow } from '../../src/shared/types.js';

const at = '2026-11-01T00:00:00.000Z';
const disposers: Array<() => void> = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

const workflow: Workflow = {
  name: 'Flow', initialColumnId: 'todo',
  columns: [{ id: 'todo', name: 'TODO' }, { id: 'review', name: 'Review' }, { id: 'done', name: 'DONE' }, { id: 'wait', name: 'Wait' }],
  groups: [],
};

function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task', boardId: 'board', projectId: 'project', title: 'Prepare release', description: '',
    columnId: 'review', position: 0, sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/isolated',
    worktree: null, operation: null, createdAt: at, updatedAt: at,
    stageEntry: { id: 'entry', columnId: 'review', stageIdentity: 'review', enteredAt: at },
    ...overrides,
  };
}

const held = (id: string, extra: Partial<HeldMessage> = {}): HeldMessage => ({ id, fromSessionId: 'sender', columnId: 'review', body: 'Body of ' + id, at, ...extra });

function instruction(entryId = 'entry', columnId = 'review'): UserMessage {
  return createStageInstructionMessage({ requestId: 'stage-instruction:task:' + entryId, text: 'Review it.', summary: 'Stage: REVIEW', entryId, columnId });
}

/** The durable record of an instruction, as the conversation log holds it. */
function instructionRecord(entryId = 'entry', columnId = 'review'): unknown {
  return { type: 'user/message', data: { id: 'instruction-message', role: 'user', content: [{ type: 'text', text: 'Review it.' }], source: { kind: 'stage-instruction', form: 'notice', summary: 'Stage: REVIEW', requestId: 'stage-instruction:task:' + entryId, entryId, columnId } } };
}

/** One durable user-message record. */
function logged(message: UserMessage): unknown {
  return { type: 'user/message', data: message };
}

function fixture(value: HubTask = task(), overrides: Partial<HeldMessageBatchPorts> = {}) {
  const ctx = new Context();
  const logs = new Map<string, readonly unknown[]>();
  const pending = new Map<string, readonly unknown[]>();
  const locateBySession = (sessionId: string): LocatedTask | undefined => {
    if (!value.sessionIds.includes(sessionId)) return undefined;
    return { task: value, board: { workflow } } as unknown as LocatedTask;
  };
  const events = vi.fn(async (sessionId: string) => logs.get(sessionId) ?? []);
  const pendingOf = vi.fn((agent: Agent) => pending.get(String(agent.id)) ?? []);
  const release = vi.fn(async (_taskId: string, ids: readonly string[]) => {
    value.heldMessages = (value.heldMessages ?? []).filter(message => !ids.includes(message.id));
  });
  const releaseOthers = vi.fn(async () => {});
  const retireEntry = vi.fn(async () => {});
  const checkpoint = vi.fn(async () => true);
  const report = vi.fn();
  const ports: HeldMessageBatchPorts = { locateBySession, events, pending: pendingOf, release, releaseOthers, retireEntry, checkpoint, report, ...overrides };
  const batch = registerHeldMessageBatch(ctx, ports);
  disposers.push(() => batch.dispose());
  const prepare = (sessionId = 's1', taskId = 'task', columnId = 'review', instructionId = 'stage-instruction:task:entry') => batch.prepare(taskId, columnId, sessionId, instructionId);
  const step = (sessionId = 's1', input: UserMessage[] = [instruction()], controller = new AbortController(), turn = 1) =>
    ctx.waterfall('agent/pre-step', {
      agent: { id: SessionId(sessionId) } as Agent, turn, step: 1,
      modelSelection: { provider: 'fixture', model: 'fixture' }, signal: controller.signal, messages: input,
    }, async () => ({ kind: 'enter' as const, messages: input }));
  const messagesOf = (value_: unknown): UserMessage[] => {
    const decision = value_ as { kind: string; messages: UserMessage[] };
    return decision.messages;
  };
  const kindsOf = (value_: unknown) => messagesOf(value_).map(message => message.source.kind);
  const receipt = (sessionId: string, message: UserMessage) => {
    const event = { type: 'user/message', data: message };
    logs.set(sessionId, [...(logs.get(sessionId) ?? []), event]);
    ctx.emit('session/event', { id: SessionId(sessionId) } as never, event as never);
  };
  const instructionReceipt = (sessionId = 's1', entryId = 'entry') => {
    const event = instructionRecord(entryId);
    logs.set(sessionId, [...(logs.get(sessionId) ?? []), event]);
    ctx.emit('session/event', { id: SessionId(sessionId) } as never, event as never);
  };
  const turnEnd = (sessionId = 's1', turn = 1) => ctx.emit('session/event', { id: SessionId(sessionId) } as never, { type: 'turn/end', data: { turn, reason: { kind: 'ok' } } } as never);
  const claim = (sessionId: string, message: UserMessage, turn: number) =>
    ctx.emit('agent/inbox/claimed', { agent: { id: SessionId(sessionId) } as Agent, message, turn } as never);
  const discard = (sessionId: string, message: UserMessage) =>
    ctx.emit('agent/inbox/discarded', { agent: { id: SessionId(sessionId) } as Agent, message } as never);
  const created = async (sessionId = 's1', source = 'resume') =>
    ctx.serial('agent/created', { agent: { id: SessionId(sessionId) } as Agent, source } as never);
  const kindOf = (value_: unknown) => (value_ as { kind: string }).kind;
  return { ctx, task: value, logs, pending, events, pendingOf, release, releaseOthers, retireEntry, checkpoint, report, batch, prepare, step, messagesOf, kindsOf, kindOf, receipt, instructionReceipt, turnEnd, claim, discard, created };
}

describe('held message batch admission', () => {
  it('injects exactly the prepared handoffs after the instruction, in queue order', async () => {
    const first = held('held:sender:1');
    const second = held('held:sender:2');
    const f = fixture(task({ heldMessages: [first, second] }));
    expect(await f.prepare()).toBe('deliver');
    const input = [instruction()];
    const output = f.messagesOf(await f.step('s1', input));

    expect(output).toHaveLength(3);
    expect(output[0]!.source).toMatchObject({ kind: 'stage-instruction' });
    expect(output[1]!.source).toMatchObject({ kind: 'task-message', requestId: first.id, senderSessionId: 'sender', senderTaskId: 'task' });
    expect(output[2]!.source).toMatchObject({ kind: 'task-message', requestId: second.id });
    expect(output[1]!.content).toEqual([{ type: 'text', text: expect.stringContaining('Body of held:sender:1') }]);
    // The step's own messages are never edited, and selection consumes nothing.
    expect(input).toHaveLength(1);
    expect(input[0]!.source).toMatchObject({ kind: 'stage-instruction' });
    expect(f.task.heldMessages).toEqual([first, second]);
  });

  it('places the batch immediately after the instruction among the existing step messages', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    await f.prepare();
    const steered = createUserMessage({ content: [{ type: 'text', text: 'Steered first' }], source: { kind: 'user' } });
    const notice = createStageNoticeMessage(workflow, 'review', 'entry')!;
    expect(f.kindsOf(await f.step('s1', [steered, instruction(), notice]))).toEqual(['user', 'stage-instruction', 'task-message', 'stage-notice']);
  });

  it('leaves a step without an instruction alone', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    await f.prepare();
    const input = [createUserMessage({ content: [{ type: 'text', text: 'Continue' }], source: { kind: 'user' } })];
    expect(f.messagesOf(await f.step('s1', input))).toEqual(input);
    expect(f.release).not.toHaveBeenCalled();
  });

  it('ignores a superseded stage entry and consumes the preparation', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    await f.prepare();
    f.task.stageEntry = { id: 'entry-2', columnId: 'review', stageIdentity: 'review', enteredAt: at };
    const input = [instruction('entry')];
    expect(f.messagesOf(await f.step('s1', input))).toEqual(input);
    expect(f.release).not.toHaveBeenCalled();
  });

  it('prepares only the messages addressed to the instruction conversation', async () => {
    const main = held('held:sender:main');
    const agent = held('held:sender:agent', { agent: 'designer' });
    const otherStage = held('held:sender:other', { columnId: 'wait' });
    const f = fixture(task({ heldMessages: [main, agent, otherStage], sessionIds: ['s1', 's2'], sessionRoles: { s2: { agent: 'designer' } } }));
    await f.prepare('s1');
    expect(f.kindsOf(await f.step('s1', [instruction()]))).toEqual(['stage-instruction', 'task-message']);
    f.task.heldMessages = [main, agent, otherStage];
    await f.prepare('s2');
    const agentOutput = f.messagesOf(await f.step('s2', [instruction()]));
    expect(agentOutput.map(message => (message.source as { requestId?: string }).requestId)).toEqual(['stage-instruction:task:entry', agent.id]);
  });

  it('fails preparation before any wake when the history cannot be read', async () => {
    const message = held('held:sender:1');
    let fail = true;
    const events = vi.fn(async () => {
      if (fail) { fail = false; throw new Error('Session history is unreadable.'); }
      return [];
    });
    const f = fixture(task({ heldMessages: [message] }), { events });
    await expect(f.prepare()).rejects.toThrow('Session history is unreadable.');
    expect(f.task.heldMessages).toEqual([message]);
    // Nothing was prepared, so the retry's own preparation and step carry the handoff.
    expect(await f.prepare()).toBe('deliver');
    expect(f.kindsOf(await f.step('s1'))).toEqual(['stage-instruction', 'task-message']);
  });

  it('fails preparation when a recorded match cannot be proven durable', async () => {
    const recorded = held('held:sender:recorded');
    const checkpoint = vi.fn(async () => false);
    const f = fixture(task({ heldMessages: [recorded] }), { checkpoint });
    f.logs.set('s1', [logged(createTaskMessage(composeHeldMessageDelivery(f.task, workflow, recorded)))]);
    await expect(f.prepare()).rejects.toThrow('cannot confirm durable storage');
    expect(f.release).not.toHaveBeenCalled();
    expect(f.task.heldMessages).toEqual([recorded]);
  });

  it('reports the entry as already accepted when the log records its instruction', async () => {
    const recorded = held('held:sender:recorded');
    const remainder = held('held:sender:remainder');
    const f = fixture(task({ heldMessages: [recorded, remainder] }));
    f.logs.set('s1', [
      instructionRecord(),
      logged(createTaskMessage(composeHeldMessageDelivery(f.task, workflow, recorded))),
    ]);
    expect(await f.prepare()).toBe('accepted');
    await vi.waitFor(() => expect(f.release).toHaveBeenCalledWith('task', [recorded.id]));
    // The unrecorded remainder has no new first step; the admission releases it separately.
    expect(f.task.heldMessages?.map(message => message.id)).toEqual([remainder.id]);
  });

  it('refuses a concurrent retry for the same entry until the attempt settles', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    expect(await f.prepare()).toBe('deliver');
    await expect(f.prepare()).rejects.toThrow('already being delivered');
  });

  it('finalizes a message the durable log already records instead of injecting it again', async () => {
    const recorded = held('held:sender:recorded');
    const unrecorded = held('held:sender:new');
    const f = fixture(task({ heldMessages: [recorded, unrecorded] }));
    f.logs.set('s1', [logged(createTaskMessage(composeHeldMessageDelivery(f.task, workflow, recorded)))]);
    expect(await f.prepare()).toBe('deliver');
    const output = f.messagesOf(await f.step('s1'));
    expect(output.map(message => (message.source as { requestId?: string }).requestId)).toEqual(['stage-instruction:task:entry', unrecorded.id]);
    await vi.waitFor(() => expect(f.release).toHaveBeenCalledWith('task', [recorded.id]));
    expect(f.checkpoint).toHaveBeenCalled();
  });

  it('does not treat a canceled inbox insertion as acceptance', async () => {
    const message = held('held:sender:1');
    const f = fixture(task({ heldMessages: [message] }));
    f.logs.set('s1', [{ type: 'agent/inbox/spliced', data: { inserted: [createTaskMessage(composeHeldMessageDelivery(f.task, workflow, message))], outcome: 'canceled' } }]);
    expect(await f.prepare()).toBe('deliver');
    expect(f.kindsOf(await f.step('s1'))).toEqual(['stage-instruction', 'task-message']);
    expect(f.release).not.toHaveBeenCalled();
  });

  it('skips an identity the conversation already has pending', async () => {
    const pendingMessage = held('held:sender:pending');
    const f = fixture(task({ heldMessages: [pendingMessage] }));
    f.pending.set('s1', [createTaskMessage(composeHeldMessageDelivery(f.task, workflow, pendingMessage))]);
    await f.prepare();
    expect(f.messagesOf(await f.step('s1'))).toHaveLength(1);
  });

  it('retires the entry only after the instruction and every handoff are durably recorded', async () => {
    const message = held('held:sender:1');
    const f = fixture(task({ heldMessages: [message] }));
    await f.prepare();
    const output = f.messagesOf(await f.step('s1'));
    f.instructionReceipt();
    expect(f.retireEntry).not.toHaveBeenCalled();
    f.receipt('s1', output[1]!);
    await vi.waitFor(() => expect(f.release).toHaveBeenCalledWith('task', [message.id]));
    await vi.waitFor(() => expect(f.retireEntry).toHaveBeenCalledWith('task', 'entry'));
  });

  it('keeps the entry actionable when the durability checkpoint does not confirm', async () => {
    const message = held('held:sender:1');
    const checkpoint = vi.fn(async () => false);
    const f = fixture(task({ heldMessages: [message] }), { checkpoint });
    await f.prepare();
    const output = f.messagesOf(await f.step('s1'));
    f.instructionReceipt();
    f.receipt('s1', output[1]!);
    await vi.waitFor(() => expect(f.report).toHaveBeenCalled());
    expect(f.release).not.toHaveBeenCalled();
    expect(f.retireEntry).not.toHaveBeenCalled();
    expect(f.task.heldMessages).toEqual([message]);
  });

  it('coalesces identities published while one checkpoint-and-release pass is in flight', async () => {
    const first = held('held:sender:1');
    const second = held('held:sender:2');
    const f = fixture(task({ heldMessages: [first, second] }));
    await f.prepare();
    const output = f.messagesOf(await f.step('s1'));
    let open!: () => void;
    const gate = new Promise<void>(ready => { open = ready; });
    f.checkpoint.mockImplementationOnce(async () => { await gate; return true; });
    f.instructionReceipt();
    f.receipt('s1', output[1]!);
    f.receipt('s1', output[2]!);
    f.turnEnd();
    open();
    await vi.waitFor(() => expect(f.task.heldMessages ?? []).toEqual([]));
    const released = f.release.mock.calls.flatMap(call => call[1]);
    expect(released.sort()).toEqual([first.id, second.id].sort());
    await vi.waitFor(() => expect(f.retireEntry).toHaveBeenCalledTimes(1));
  });

  it('does not retire an entry whose turn closed before the batch was recorded', async () => {
    const message = held('held:sender:1');
    const f = fixture(task({ heldMessages: [message] }));
    const queued = instruction();
    await f.prepare();
    f.claim('s1', queued, 1);
    expect(f.messagesOf(await f.step('s1', [queued], undefined, 1))).toHaveLength(2);
    f.instructionReceipt();
    // The owning turn closed without the handoff append.
    f.turnEnd('s1', 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.retireEntry).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalled();
    // A retry sees the recorded instruction and recovers the remainder separately; the
    // admission sends nothing, so no new instruction step follows.
    expect(await f.prepare()).toBe('accepted');
    expect(f.task.heldMessages).toEqual([message]);
  });

  it('retries an interrupted local release at the next preparation or turn', async () => {
    const message = held('held:sender:1');
    const value = task({ heldMessages: [message] });
    const release = vi.fn()
      .mockRejectedValueOnce(new Error('Store temporarily unavailable'))
      .mockImplementation(async (_taskId: string, ids: readonly string[]) => {
        value.heldMessages = (value.heldMessages ?? []).filter(entry => !ids.includes(entry.id));
      });
    const f = fixture(value, { release });
    await f.prepare();
    const output = f.messagesOf(await f.step('s1'));
    f.instructionReceipt();
    f.receipt('s1', output[1]!);
    await vi.waitFor(() => expect(f.report).toHaveBeenCalled());
    expect(value.heldMessages).toEqual([message]);
    f.turnEnd();
    await vi.waitFor(() => expect(value.heldMessages ?? []).toEqual([]));
    expect(release.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('releases a prepared message whose recipient changed to the separate path', async () => {
    const message = held('held:sender:main');
    const f = fixture(task({ heldMessages: [message] }));
    await f.prepare();
    // Another unbound conversation becomes the task's main conversation before the step.
    f.task.sessionIds = ['s0', 's1'];
    const output = f.messagesOf(await f.step('s1'));
    expect(output.map(message => message.source.kind)).toEqual(['stage-instruction']);
    await vi.waitFor(() => expect(f.releaseOthers).toHaveBeenCalledWith('task', 'review', 's1'));
  });

  it('keeps a queued preparation when an earlier turn ends', async () => {
    const hold = held('held:sender:queued');
    const f = fixture(task({ heldMessages: [hold] }));
    expect(await f.prepare()).toBe('deliver');
    const queued = instruction();
    f.pending.set('s1', [queued]);
    // An unrelated earlier turn ends while the exact instruction is still queued.
    f.turnEnd('s1', 1);
    await new Promise(resolve => setTimeout(resolve, 5));
    f.pending.delete('s1');
    f.claim('s1', queued, 2);
    const output = f.messagesOf(await f.step('s1', [queued], undefined, 2));
    expect(output.map(message => message.source.kind)).toEqual(['stage-instruction', 'task-message']);
    expect(f.task.heldMessages).toEqual([hold]);
  });

  it('clears an unaccepted attempt only when its own turn ends', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    await f.prepare();
    const queued = instruction();
    f.claim('s1', queued, 3);
    f.turnEnd('s1', 3);
    // The retry action is usable again: the attempt is no longer in flight.
    expect(await f.prepare()).toBe('deliver');
    expect(f.kindsOf(await f.step('s1'))).toEqual(['stage-instruction', 'task-message']);
  });

  it('matches the exact instruction identity for claim and discard', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    await f.prepare();
    const foreign = createStageInstructionMessage({ requestId: 'a-different-request', text: 'Review it.', summary: 'Stage: REVIEW', entryId: 'entry', columnId: 'review' });
    f.claim('s1', foreign, 4);
    f.turnEnd('s1', 4);
    // The foreign claim and its turn do not release this attempt.
    await expect(f.prepare()).rejects.toThrow('already being delivered');
    // The exact instruction's discard does release it.
    f.discard('s1', instruction());
    expect(await f.prepare()).toBe('deliver');
  });

  it('rebuilds the batch at the first step of a restored instruction', async () => {
    const hold = held('held:sender:restored');
    // No admission, no preparation map: the restored instruction is claimed directly.
    const f = fixture(task({ heldMessages: [hold] }));
    const output = f.messagesOf(await f.step('s1', [instruction()]));
    expect(output.map(message => message.source.kind)).toEqual(['stage-instruction', 'task-message']);
    expect(f.release).not.toHaveBeenCalled();
  });

  it('rebuilds the preparation on native resume without waking the conversation', async () => {
    const hold = held('held:sender:restored');
    const f = fixture(task({ heldMessages: [hold] }));
    const queued = instruction();
    f.pending.set('s1', [queued]);
    await f.created('s1');
    // The rebuilt plan carries the instruction's exact identity and needs no delivery.
    expect(f.kindsOf(await f.step('s1', [queued]))).toEqual(['stage-instruction', 'task-message']);
  });

  it('preserves unrelated input and withholds only the instruction when reconciliation fails', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }), { events: async () => { throw new Error('Session history is unreadable.'); } });
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'A person typed this.' }], source: { kind: 'user' } });
    const decision = await f.step('s1', [prompt, instruction()]);
    expect(f.kindOf(decision)).toBe('enter');
    expect(f.messagesOf(decision)).toEqual([prompt]);
    expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('withheld the review stage instruction') }));
    expect(f.task.heldMessages).toHaveLength(1);
    // Nothing else remains, so no context-only request is issued.
    const alone = await f.step('s1', [instruction()]);
    expect(f.kindOf(alone)).toBe('reject');
  });

  it('includes an eligible handoff committed after preparation', async () => {
    const first = held('held:sender:first');
    const second = held('held:other:second');
    const f = fixture(task({ heldMessages: [first] }));
    expect(await f.prepare()).toBe('deliver');
    // A prior step must never receive the batch.
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'A person typed this.' }], source: { kind: 'user' } });
    expect(f.messagesOf(await f.step('s1', [prompt], undefined, 1))).toEqual([prompt]);
    // The other conversation commits its hold after preparation but before the step.
    f.task.heldMessages!.push(second);
    const queued = instruction();
    f.claim('s1', queued, 2);
    const output = f.messagesOf(await f.step('s1', [queued], undefined, 2));
    const requestIdentity = (message: UserMessage) => (message.source as { requestId?: string }).requestId;
    expect(output.map(requestIdentity)).toEqual([requestIdentity(queued), first.id, second.id]);
    // Each identity leaves the queue only after its own record is durably accepted.
    f.instructionReceipt();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.release.mock.calls).toEqual([]);
    const firstReceipt = createTaskMessage(composeHeldMessageDelivery(f.task, workflow, first));
    f.receipt('s1', firstReceipt);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.release.mock.calls.flatMap(call => call[1])).toEqual([first.id]);
    expect(f.task.heldMessages).toEqual([second]);
    const secondReceipt = createTaskMessage(composeHeldMessageDelivery(f.task, workflow, second));
    f.receipt('s1', secondReceipt);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.release.mock.calls.flatMap(call => call[1])).toEqual([first.id, second.id]);
    expect(f.task.heldMessages).toEqual([]);
  });

  it('starts no step for generated context alone after withholding the instruction', async () => {
    let unavailable = true;
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }), { events: async () => { if (unavailable) throw new Error('history unavailable'); return []; } });
    const runtime = createUserMessage({ content: [{ type: 'text', text: 'Host-generated context' }], source: { kind: 'runtime-context' } as never });
    const decision = await f.step('s1', [instruction(), runtime]);
    expect(f.kindOf(decision)).toBe('reject');
    expect(f.report).toHaveBeenCalled();
    // A later retry still carries the same held identity exactly once.
    unavailable = false;
    const retried = f.messagesOf(await f.step('s1', [instruction()], undefined, 2));
    expect(retried.map(message => message.source.kind)).toEqual(['stage-instruction', 'task-message']);
    expect(retried[1]!.source).toMatchObject({ requestId: 'held:sender:1' });
  });

  it('releases the armed preparation when native delivery fails', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    expect(await f.prepare()).toBe('deliver');
    f.batch.abandon('task', 'review', 's1');
    expect(await f.prepare()).toBe('deliver');
  });

  it('rebuilds preparation for the new entry when the entry changed during the history read', async () => {
    let resolve!: (value: readonly unknown[]) => void;
    const gate = new Promise<readonly unknown[]>(ready => { resolve = ready; });
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }), { events: () => gate });
    const pending = f.prepare();
    await Promise.resolve();
    f.task.stageEntry = { id: 'entry-2', columnId: 'review', stageIdentity: 'review', enteredAt: at };
    resolve([]);
    expect(await pending).toBe('deliver');
    expect(f.release).not.toHaveBeenCalled();
    // The invariant still holds at the new entry's instruction step.
    expect(f.kindsOf(await f.step('s1', [instruction('entry-2')]))).toEqual(['stage-instruction', 'task-message']);
  });

  it('prepares nothing when the entry changed during the durability checkpoint', async () => {
    const recorded = held('held:sender:recorded');
    const unrecorded = held('held:sender:new');
    let open!: () => void;
    const gate = new Promise<void>(ready => { open = ready; });
    const checkpoint = vi.fn(async () => { await gate; return true; });
    const f = fixture(task({ heldMessages: [recorded, unrecorded] }), { checkpoint });
    f.logs.set('s1', [logged(createTaskMessage(composeHeldMessageDelivery(f.task, workflow, recorded)))]);
    const pending = f.prepare();
    await Promise.resolve();
    f.task.stageEntry = { id: 'entry-2', columnId: 'review', stageIdentity: 'review', enteredAt: at };
    open();
    expect(await pending).toBe('deliver');
    expect(f.release).not.toHaveBeenCalled();
    // The new entry's step reconciles: only the unrecorded handoff rides it.
    const output = f.messagesOf(await f.step('s1', [instruction('entry-2')]));
    expect(output.map(message => (message.source as { requestId?: string }).requestId)).toEqual(['stage-instruction:task:entry-2', unrecorded.id]);
  });

  it('returns the step unchanged when it is aborted after preparation', async () => {
    const f = fixture(task({ heldMessages: [held('held:sender:1')] }));
    const queued = instruction();
    await f.prepare();
    f.claim('s1', queued, 1);
    const controller = new AbortController();
    controller.abort();
    expect(f.messagesOf(await f.step('s1', [queued], controller, 1))).toHaveLength(1);
    // The owning turn closes, so the attempt is no longer in flight.
    f.turnEnd('s1', 1);
    await f.prepare();
    expect(f.kindsOf(await f.step('s1'))).toEqual(['stage-instruction', 'task-message']);
  });
});
