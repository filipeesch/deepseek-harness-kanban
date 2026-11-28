import { afterEach, describe, expect, it, vi } from 'vitest';
import { KanbanApp } from '../../src/host/app.js';
import { TURN_ADVANCE_SETTLE_MS } from '../../src/host/turn-advance.js';
import { fixture, taskWithConversation } from './helpers.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { while (active.length > 0) await active.pop()!.close(); });
async function setup(options: Parameters<typeof fixture>[0] = {}) { const f = await fixture(options); active.push(f); return f; }

const CATALOG = { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason' }] }], failures: [] };

const AGENT_FLOW = [
  'name: Agent flow',
  'initial_column: backlog',
  'model:',
  '  provider: deepseek',
  '  model: chat',
  'agents:',
  '  - id: designer',
  '    name: UX Design',
  '    preset: ux',
  '    model:',
  '      provider: deepseek',
  '      model: reason',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: design',
  '    label: Design',
  '    agent: designer',
  '    on_enter_prompt: Design it.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

const turnEnd = (seq: number, kind = 'completed') => ({ type: 'turn/end', seq, data: { turn: 1, reason: { kind } } });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Observe a turn boundary and let the host's settle delay elapse. */
/** Move the card, then run the entry instruction the way the drawer's countdown does. */
async function moveAndRun(f: Awaited<ReturnType<typeof fixture>>, taskId: string, columnId: string, instruction = 'Design it.'): Promise<void> {
  await f.app.command({ type: 'task.move', taskId, columnId });
  await expect.poll(() => f.store.requireTask(taskId).columnId).toBe(columnId);
  const marker = f.store.requireTask(taskId).instructionPending;
  if (marker === undefined) return;
  await f.app.command({ type: 'task.runInstruction', taskId, columnId, expectedEnteredAt: marker.enteredAt, expectedInstruction: instruction });
}

async function endTurn(app: KanbanApp, sessionId: string, seq: number): Promise<void> {
  vi.useFakeTimers();
  try {
    app.observe(sessionId, turnEnd(seq));
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
  } finally {
    vi.useRealTimers();
  }
}

function presetPort(available: Set<string>) {
  return { apply: vi.fn(async (_sessionId: string, presetId: string) => available.has(presetId) ? { applied: true as const } : { applied: false as const, reason: 'unavailable' as const }) };
}
function modelPort(refused: Set<string>) {
  return {
    catalog: vi.fn(async () => CATALOG),
    apply: vi.fn(async (_sessionId: string, selection: { provider: string; model: string }) => refused.has(selection.model)
      ? { applied: false as const, reason: 'unavailable' as const, message: 'The route is not offered.', inUse: { provider: 'deepseek', model: 'chat' } }
      : { applied: true as const }),
  };
}
function deliveryPort() {
  return { deliver: vi.fn(async (_sessionId: string, _delivery: unknown) => {}) };
}

describe('agent conversations', () => {
  it('creates the stage agent conversation with its preset, model and title, and delivers there', async () => {
    const presets = presetPort(new Set(['ux']));
    const models = modelPort(new Set());
    const f = await setup({ presets, models });
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Design work', description: '' });
    await moveAndRun(f, task.id, 'design');
    await expect.poll(() => f.store.requireTask(task.id).instructionPending).toBeUndefined();

    const current = f.store.requireTask(task.id);
    expect(current.columnId).toBe('design');
    expect(current.sessionIds).toHaveLength(2);
    const agentSession = current.sessionIds[1]!;
    expect(current.sessionRoles?.[agentSession]).toEqual({ agent: 'designer' });
    expect(presets.apply).toHaveBeenCalledWith(agentSession, 'ux');
    expect(models.apply).toHaveBeenCalledWith(agentSession, { provider: 'deepseek', model: 'reason' });
    expect(f.sessions.titles.get(agentSession)).toBe('UX Design');
    const delivered = f.sessions.sent.filter(entry => entry.kind === 'stage-instruction');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ id: agentSession });
    expect(delivered[0]!.text).toContain('Design it.');
  });

  it('prepares the first execution in the agent conversation of an agent initial stage', async () => {
    const f = await setup({ presets: presetPort(new Set(['ux'])), models: modelPort(new Set()) });
    await f.store.setWorkflow(AGENT_FLOW.replace('initial_column: backlog', 'initial_column: design'));
    const created = await f.app.createTaskAndStart({ projectId: f.project.id, title: 'Born in design', description: '' }, true);
    await expect.poll(() => f.sessions.sent.filter(entry => entry.kind === 'stage-instruction').length).toBe(1);
    const current = f.store.requireTask(created.task.id);
    expect(current.columnId).toBe('design');
    expect(current.sessionIds).toHaveLength(1);
    expect(current.sessionRoles?.[current.sessionIds[0]!]).toEqual({ agent: 'designer' });
    expect(f.sessions.sent.find(entry => entry.kind === 'stage-instruction')?.id).toBe(current.sessionIds[0]);
  });

  it('holds the entry without a conversation when the agent preset is unavailable, and retries', async () => {
    const available = new Set<string>();
    const presets = presetPort(available);
    const f = await setup({ presets, models: modelPort(new Set()) });
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Held design', description: '' });
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'design' });
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('design');
    const beforeRun = f.store.requireTask(task.id).instructionPending!;
    await expect(f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'design', expectedEnteredAt: beforeRun.enteredAt, expectedInstruction: 'Design it.' }))
      .rejects.toMatchObject({ code: 'AGENT_PRESET_UNAVAILABLE' });
    await expect.poll(() => f.store.requireTask(task.id).instructionPending?.hold).toBeDefined();

    const held = f.store.requireTask(task.id);
    expect(held.columnId).toBe('design');
    expect(held.sessionIds).toHaveLength(1);
    expect(held.instructionPending?.hold).toEqual({ code: 'agent-preset-unavailable', agent: 'designer', preset: 'ux' });
    expect(held.autoMode?.pause).toBeUndefined();
    expect(f.sessions.archived).toHaveLength(1);
    expect(f.sessions.sent.filter(entry => entry.kind === 'stage-instruction')).toHaveLength(0);

    available.add('ux');
    const marker = f.store.requireTask(task.id).instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'design', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Design it.' });
    await expect.poll(() => f.store.requireTask(task.id).instructionPending).toBeUndefined();
    const resolved = f.store.requireTask(task.id);
    expect(resolved.sessionIds).toHaveLength(2);
    expect(f.sessions.sent.filter(entry => entry.kind === 'stage-instruction')).toHaveLength(1);
  });

  it('falls back to the main agent model and reports it on the card and in the conversation', async () => {
    const f = await setup({ presets: presetPort(new Set(['ux'])), models: modelPort(new Set(['reason'])) });
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Model fallback', description: '' });
    await moveAndRun(f, task.id, 'design');
    await expect.poll(() => f.store.requireTask(task.id).instructionPending).toBeUndefined();
    const current = f.store.requireTask(task.id);
    // The fallback is a durable fact of the specialist's binding, not a task field that
    // disappears once the instruction lands, so the card can keep reporting it.
    const bound = current.sessionIds.find(sessionId => current.sessionRoles?.[sessionId]?.agent === 'designer')!;
    expect(current.sessionRoles?.[bound]).toMatchObject({ modelFallback: { requested: { provider: 'deepseek', model: 'reason' } } });
    const delivered = f.sessions.sent.find(entry => entry.kind === 'stage-instruction')!;
    expect(delivered.text).toContain('Model notice');
  });

  it('arms the turn-end advance only from the conversation that owns the agent stage', async () => {
    const f = await setup({ presets: presetPort(new Set(['ux'])), models: modelPort(new Set()) });
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Owner', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    await moveAndRun(f, task.id, 'design');
    await expect.poll(() => f.store.requireTask(task.id).instructionPending).toBeUndefined();
    const current = f.store.requireTask(task.id);
    const mainSession = current.sessionIds[0]!;
    const agentSession = current.sessionIds[1]!;

    await endTurn(f.app, mainSession, 1);
    await delay(40);
    expect(f.store.requireTask(task.id).columnId).toBe('design');

    await endTurn(f.app, agentSession, 2);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('done');
  });

  it('keeps a message held when the instruction reaches its conversation', async () => {
    const delivery = deliveryPort();
    const f = await setup({ presets: presetPort(new Set(['ux'])), models: modelPort(new Set()), taskMessageDelivery: delivery });
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Held message', description: '' });
    const mainSession = f.store.requireTask(task.id).sessionIds[0]!;
    await f.app.holdMessage(task.id, { id: 'held:main:call-1', fromSessionId: mainSession, agent: 'designer', columnId: 'design', body: 'Design result.', at: new Date().toISOString() });
    expect(f.store.requireTask(task.id).heldMessages).toHaveLength(1);

    await moveAndRun(f, task.id, 'design');
    // The message belongs to the first step that carries the instruction, so the separate
    // release path leaves it in the queue for that step to confirm, and the entry stays
    // unresolved until the conversation records the instruction.
    const current = f.store.requireTask(task.id);
    expect(current.sessionIds).toHaveLength(2);
    expect(current.instructionPending?.columnId).toBe('design');
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(current.heldMessages?.map(message => message.id)).toEqual(['held:main:call-1']);

    // The instruction alone does not retire a batch entry: its handoff must be recorded too.
    const agentSession = current.sessionIds.find(sessionId => current.sessionRoles?.[sessionId]?.agent === 'designer')!;
    f.app.observe(agentSession, {
      type: 'user/message', seq: 1, time: Date.now(),
      data: { id: 'message-1', role: 'user', content: [{ type: 'text', text: 'Design it.' }], source: { kind: 'stage-instruction', form: 'notice', summary: 'Stage: DESIGN', requestId: 'request-1', entryId: current.stageEntry!.id, columnId: 'design' } },
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.store.requireTask(task.id).instructionPending?.columnId).toBe('design');
    // The batch admission is the one that retires it once the attempt is complete.
    await f.app.retireInstructionEntry(task.id, current.stageEntry!.id);
    await expect.poll(() => f.store.requireTask(task.id).instructionPending).toBeUndefined();
  });

  it('releases a message held for another conversation after the instruction is admitted', async () => {
    const delivery = deliveryPort();
    const f = await setup({ presets: presetPort(new Set(['ux'])), models: modelPort(new Set()), taskMessageDelivery: delivery });
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Held elsewhere', description: '' });
    const mainSession = f.store.requireTask(task.id).sessionIds[0]!;
    // The message targets the main conversation while the stage runs in the designer's.
    await f.app.holdMessage(task.id, { id: 'held:main:call-3', fromSessionId: mainSession, columnId: 'design', body: 'Main result.', at: new Date().toISOString() });

    await moveAndRun(f, task.id, 'design');
    await expect.poll(() => delivery.deliver.mock.calls.length).toBe(1);
    const [sessionId, raw] = delivery.deliver.mock.calls[0]!;
    expect(sessionId).toBe(mainSession);
    expect((raw as { requestId: string; text: string }).requestId).toBe('held:main:call-3');
    expect((raw as { text: string }).text).toContain('Main result.');
    await expect.poll(() => f.store.requireTask(task.id).heldMessages).toBeUndefined();
  });

  it('finalizes a message its conversation recorded and refuses to requeue the identity', async () => {
    const f = await setup();
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Finalized', description: '' });
    const mainSession = f.store.requireTask(task.id).sessionIds[0]!;
    const held = { id: 'held:main:call-4', fromSessionId: mainSession, columnId: 'design', body: 'Recorded result.', at: new Date().toISOString() };
    await f.app.holdMessage(task.id, held);

    await f.app.finalizeHeldMessages(task.id, [held.id]);
    expect(f.store.requireTask(task.id).heldMessages).toBeUndefined();
    expect(f.store.requireTask(task.id).releasedMessages).toContain(held.id);
    // A replayed tool call with the same identity neither queues nor delivers it again.
    await f.app.holdMessage(task.id, held);
    expect(f.store.requireTask(task.id).heldMessages).toBeUndefined();
  });

  it('discards a held message whose stage a workflow edit removed and records it', async () => {
    const f = await setup();
    await f.store.setWorkflow(AGENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Orphan message', description: '' });
    const mainSession = f.store.requireTask(task.id).sessionIds[0]!;
    await f.app.holdMessage(task.id, { id: 'held:main:call-2', fromSessionId: mainSession, columnId: 'design', body: 'Never delivered.', at: new Date().toISOString() });
    await f.app.boards.update({ boardId: f.board.id, workflowYaml: AGENT_FLOW.replace('  - id: design\n    label: Design\n    agent: designer\n    on_enter_prompt: Design it.\n', ''), revision: false });
    await expect.poll(() => f.store.requireTask(task.id).heldMessages).toBeUndefined();
    const history = f.store.requireTask(task.id).history ?? [];
    expect(history.some(entry => entry.kind === 'held-message' && entry.columnId === 'design')).toBe(true);
  });
});
