import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_ADVANCE_SETTLE_MS } from '../../src/host/auto-advance.js';
import { fixture, taskWithConversation } from './helpers.js';

const BRANCHED = [
  'name: Branched flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    allowed_transitions: [plan]',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: Plan it.',
  '    allowed_transitions:',
  '      - to: done',
  '        when: The plan approved the task without further work.',
  '      - to: review',
  '        when: The plan needs a review before implementation.',
  '  - id: review',
  '    label: Review',
  '  - id: done',
  '    label: Done',
  '',
].join(String.fromCharCode(10));

const SINGLE_FLOW = BRANCHED.replace(
  '    allowed_transitions:\n      - to: done\n        when: The plan approved the task without further work.\n      - to: review\n        when: The plan needs a review before implementation.',
  '    allowed_transitions: [review]',
);

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }

/** The briefing lines of one admitted message, or an empty string. */
function briefingOf(text: string): string {
  const at = text.indexOf('Workflow transitions from ');
  return at < 0 ? '' : text.slice(at);
}

describe('transition briefing on every send path', () => {
  it('includes the briefing in the card run action and the timed stage instruction', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Run', description: '' });
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan' });
    const entered = f.store.requireTask(task.id);
    // The timed instruction sends through the same command as the card run action.
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'plan', expectedEnteredAt: entered.instructionPending!.enteredAt, expectedInstruction: 'Plan it.' });
    expect(f.sessions.sent).toHaveLength(1);
    const briefing = briefingOf(f.sessions.sent[0]!.text);
    expect(briefing).toContain('- Done — The plan approved the task without further work.');
    expect(briefing).toContain('- Review — The plan needs a review before implementation.');
  });

  it('includes the briefing in a confirmed transition dispatch', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Confirmed', description: '' });
    await f.store.transact(draft => {
      const value = draft.tasks[0]!;
      value.instructionPending = { columnId: 'plan', enteredAt: 1 };
      value.pendingTransition = { id: 'legacy-run', fromColumnId: 'backlog', columnId: 'plan', mode: 'run', sessionId: task.sessionIds[0]!, text: 'Plan it.', status: 'waiting' };
    });
    await f.app.command({ type: 'operation.retry', taskId: task.id });
    expect(f.sessions.sent).toHaveLength(1);
    expect(briefingOf(f.sessions.sent[0]!.text)).toContain('- Done — The plan approved the task without further work.');
  });

  it('includes the briefing in an automatic advance', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Auto', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    vi.useFakeTimers();
    try {
      f.app.observe(task.sessionIds[0]!, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
      await vi.advanceTimersByTimeAsync(AUTO_ADVANCE_SETTLE_MS + 25);
    } finally { vi.useRealTimers(); }
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await expect.poll(() => f.sessions.sent.length).toBe(1);
    expect(briefingOf(f.sessions.sent[0]!.text)).toContain('- Done — The plan approved the task without further work.');
  });

  it('sends the instruction alone when the destination configures one target', async () => {
    const f = await setup();
    await f.store.setWorkflow(SINGLE_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Single', description: '' });
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan' });
    const entered = f.store.requireTask(task.id);
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'plan', expectedEnteredAt: entered.instructionPending!.enteredAt, expectedInstruction: 'Plan it.' });
    expect(f.sessions.sent).toHaveLength(1);
    expect(f.sessions.sent[0]!.text).toBe('Plan it.');
  });
});
