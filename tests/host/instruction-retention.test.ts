import { afterEach, describe, expect, it } from 'vitest';
import { fixture, taskWithConversation } from './helpers.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { while (active.length > 0) await active.pop()!.close(); });

const REVIEW_FLOW = [
  'name: Review flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: review',
  '    label: Review',
  '    on_enter_prompt: Review it.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

async function setup(options: Parameters<typeof fixture>[0] = {}) { const f = await fixture(options); active.push(f); return f; }

/** Move one task into the instructed review stage and admit its instruction. */
async function enterReview(f: Awaited<ReturnType<typeof fixture>>, taskId: string): Promise<void> {
  await f.app.command({ type: 'task.move', taskId, columnId: 'review' });
  await expect.poll(() => f.store.requireTask(taskId).columnId).toBe('review');
  const marker = f.store.requireTask(taskId).instructionPending!;
  await f.app.command({ type: 'task.runInstruction', taskId, columnId: 'review', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Review it.' });
}

/** One durable record of a stage instruction for the given entry. */
function acceptedInstruction(entryId: string, seq = 1): unknown {
  return {
    type: 'user/message', seq, time: Date.now(),
    data: { id: 'message-' + seq, role: 'user', content: [{ type: 'text', text: 'Review it.' }], source: { kind: 'stage-instruction', form: 'notice', summary: 'Stage: Review', requestId: 'stage-instruction:task:' + entryId, entryId, columnId: 'review' } },
  };
}

/** One durable record of a held handoff. */
function recordedHandoff(id: string, seq = 2): unknown {
  return {
    type: 'user/message', seq, time: Date.now(),
    data: { id: 'message-' + seq, role: 'user', content: [{ type: 'text', text: 'Held result.' }], source: { kind: 'task-message', form: 'notice', summary: 'Task message', requestId: id, senderTaskId: 'task', senderSessionId: 'session' } },
  };
}

describe('stage instruction retention', () => {
  it('keeps a batch entry unresolved until the batch admission retires it', async () => {
    const f = await setup();
    await f.store.setWorkflow(REVIEW_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Batch entry', description: '' });
    const main = task.sessionIds[0]!;
    await f.app.holdMessage(task.id, { id: 'held:main:call-1', fromSessionId: main, columnId: 'review', body: 'Review result.', at: new Date().toISOString() });

    await enterReview(f, task.id);
    const retained = f.store.requireTask(task.id);
    expect(retained.instructionPending?.columnId).toBe('review');
    const entryId = retained.stageEntry!.id;

    // A record of another entry, or of this entry alone, does not retire a batch entry:
    // its handoff still has to be durably recorded.
    f.app.observe(main, acceptedInstruction('a-different-entry'));
    f.app.observe(main, acceptedInstruction(entryId, 2));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.store.requireTask(task.id).instructionPending).toBeDefined();

    // The batch admission retires it once the attempt is complete.
    await f.app.retireInstructionEntry(task.id, entryId);
    await expect.poll(() => f.store.requireTask(task.id).instructionPending).toBeUndefined();
  });

  it('keeps a user prompt from retiring a batch entry', async () => {
    const f = await setup();
    await f.store.setWorkflow(REVIEW_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Prompted entry', description: '' });
    const main = task.sessionIds[0]!;
    await f.app.holdMessage(task.id, { id: 'held:main:call-5', fromSessionId: main, columnId: 'review', body: 'Review result.', at: new Date().toISOString() });
    await enterReview(f, task.id);
    expect(f.store.requireTask(task.id).instructionPending?.columnId).toBe('review');

    f.app.observe(main, { type: 'user/message', seq: 3, time: Date.now(), data: { id: 'prompt', role: 'user', content: [{ type: 'text', text: 'A person typed.' }], source: { kind: 'user' } } });
    await new Promise(resolve => setTimeout(resolve, 20));
    // The prompt does not satisfy the entry while its handoff waits for the instruction.
    expect(f.store.requireTask(task.id).instructionPending?.columnId).toBe('review');
  });

  it('resolves the entry at admission when no handoff rides its first step', async () => {
    const f = await setup();
    await f.store.setWorkflow(REVIEW_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Other stage', description: '' });
    const main = task.sessionIds[0]!;
    // The message waits for another stage, so this entry does not own its acceptance.
    await f.app.holdMessage(task.id, { id: 'held:main:call-2', fromSessionId: main, columnId: 'done', body: 'Later result.', at: new Date().toISOString() });

    await enterReview(f, task.id);
    expect(f.store.requireTask(task.id).instructionPending).toBeUndefined();
    expect(f.store.requireTask(task.id).heldMessages?.map(message => message.id)).toEqual(['held:main:call-2']);
  });

  it('retires at startup only when the instruction and every handoff are recorded', async () => {
    let events: readonly unknown[] = [];
    const f = await setup({ history: async () => events });
    await f.store.setWorkflow(REVIEW_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Recovered entry', description: '' });
    const main = task.sessionIds[0]!;
    await f.app.holdMessage(task.id, { id: 'held:main:call-3', fromSessionId: main, columnId: 'review', body: 'Recovered result.', at: new Date().toISOString() });
    await enterReview(f, task.id);
    const entryId = f.store.requireTask(task.id).stageEntry!.id;
    expect(f.store.requireTask(task.id).instructionPending).toBeDefined();

    // The instruction was recorded, but its handoff was not: the entry stays actionable.
    events = [acceptedInstruction(entryId)];
    await f.app.initialize();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(f.store.requireTask(task.id).instructionPending?.columnId).toBe('review');

    // Once the handoff is also recorded, the reconciliation retires the entry.
    events = [acceptedInstruction(entryId), recordedHandoff('held:main:call-3')];
    await f.app.initialize();
    await expect.poll(() => f.store.requireTask(task.id).instructionPending).toBeUndefined();
    expect(f.store.requireTask(task.id).heldMessages).toBeUndefined();
  });
});
