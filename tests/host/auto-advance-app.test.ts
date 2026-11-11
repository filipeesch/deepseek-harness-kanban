import { afterEach, describe, expect, it, vi } from 'vitest';
import { KanbanApp } from '../../src/host/app.js';
import { TURN_ADVANCE_SETTLE_MS } from '../../src/host/turn-advance.js';
import type { ConversationFacts } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';
import { call, human, result } from '../questions/fixtures.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import { fixture, taskWithConversation } from './helpers.js';

const FLOW = [
  'name: Auto flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: Plan it.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');
const SILENT_FLOW = [
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
const BRANCHED_FLOW = [
  'name: Branched flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    allowed_transitions: [plan, done]',
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
].join('\n');
const REMOVED_DESTINATION_FLOW = [
  'name: Removed destination',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    allowed_transitions: [plan]',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: Plan it.',
  '    allowed_transitions: [review]',
  '  - id: review',
  '    label: Review',
  '',
].join('\n');
const CASCADE_FLOW = [
  'name: Cascade flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: plan',
  '    label: Plan',
  '  - id: review',
  '    label: Review',
  '    on_enter_prompt: Review it.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { vi.useRealTimers(); for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }

const turnEnd = (seq: number, kind = 'completed') => ({ type: 'turn/end', seq, data: { turn: 1, reason: { kind } } });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Observe a turn boundary and let the host's settle delay elapse. */
async function endTurn(app: KanbanApp, sessionId: string, seq: number, kind = 'completed'): Promise<void> {
  vi.useFakeTimers();
  try {
    app.observe(sessionId, turnEnd(seq, kind));
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
  } finally {
    vi.useRealTimers();
  }
}

async function arm(app: KanbanApp, taskId: string): Promise<void> {
  await app.command({ type: 'task.autoMode', taskId, enabled: true });
}

const CHAIN_FLOW = [
  'name: Instructed chain',
  'initial_column: plan',
  'columns:',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: |',
  '      Plan the automatic advance.',
  '  - id: review',
  '    label: Review',
  '    on_enter_prompt: |',
  '      Review the automatic advance.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

const userPrompt = (seq: number) => ({ type: 'user/message', seq, time: Date.now(), data: { source: { kind: 'user' }, text: 'Review when you can.' } });

describe('automatic advance', () => {
  it('moves to the instructed destination, sends once, and clears the entry marker', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Auto advance', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    await endTurn(f.app, sessionId, 1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    const current = f.store.requireTask(task.id);
    expect(current.instructionPending).toBeUndefined();
    expect(current.autoMode).toEqual({ enabled: true });
    expect(f.sessions.sent).toHaveLength(1);
    expect(f.sessions.sent[0]).toMatchObject({ id: sessionId, text: 'Plan it.' });
    expect(f.sessions.dirs.size).toBe(1);
  });

  it('does not advance a turn that ended before a user move resumed the pause', async () => {
    const f = await setup();
    await f.store.setWorkflow(SILENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Moved while paused', description: '' });
    await arm(f.app, task.id);
    await f.app.command({ type: 'task.pause', taskId: task.id, reason: 'Review the diff' });

    // The completed turn is queued for the settle; moving the card resumes the task
    // before that timer fires, which must not admit the already-ended turn.
    f.app.observe(task.sessionIds[0]!, turnEnd(1));
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: task.columnId });
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.hold).toBeUndefined();
    await delay(TURN_ADVANCE_SETTLE_MS + 200);

    const current = f.store.requireTask(task.id);
    expect(current.columnId).toBe('backlog');
    expect(current.autoMode).toEqual({ enabled: true });
    expect(f.sessions.sent).toHaveLength(0);
  });

  it('does not resume the pause when the user sends a prompt', async () => {
    const f = await setup();
    await f.store.setWorkflow(SILENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Prompted', description: '' });
    await arm(f.app, task.id);
    await f.app.command({ type: 'task.pause', taskId: task.id, reason: 'Review the diff' });
    const sessionId = task.sessionIds[0]!;

    f.app.observe(sessionId, userPrompt(1));
    expect(f.store.requireTask(task.id).autoMode).toMatchObject({ enabled: true, hold: { reason: 'Review the diff' } });

    await endTurn(f.app, sessionId, 2);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(task.id).autoMode?.hold?.reason).toBe('Review the diff');
    expect(f.sessions.sent).toHaveLength(0);
  });

  it('records a failing turn beside the agent pause without replacing its reason', async () => {
    const f = await setup();
    await f.store.setWorkflow(SILENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Failing while paused', description: '' });
    await arm(f.app, task.id);
    await f.app.command({ type: 'task.pause', taskId: task.id, reason: 'Review the diff' });

    await endTurn(f.app, task.sessionIds[0]!, 1, 'error');

    const current = f.store.requireTask(task.id);
    expect(current.autoMode).toMatchObject({ enabled: true, hold: { reason: 'Review the diff' }, pause: { reason: 'turn-error' } });
    expect(current.columnId).toBe('backlog');
    expect(f.sessions.sent).toHaveLength(0);
  });

  it('advances after a play action that started the first execution', async () => {
    const f = await setup();
    await f.store.setWorkflow(CHAIN_FLOW);
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Play then advance', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    const instruction = f.store.snapshot().workflow.columns.find(column => column.id === 'plan')!.onEnterPrompt!;
    const marker = f.store.requireTask(task.id).instructionPending!;

    await f.app.command({ type: 'task.prepareFirstExecution', taskId: task.id, columnId: 'plan', expectedEnteredAt: marker.enteredAt });
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'plan', expectedEnteredAt: marker.enteredAt, expectedInstruction: instruction });
    const sessionId = f.store.requireTask(task.id).sessionIds[0]!;
    expect(f.sessions.sent).toHaveLength(1);

    await endTurn(f.app, sessionId, 1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('review');
    await expect.poll(() => f.sessions.sent.length).toBe(2);
  });

  it('sends the transition briefing with the destination instruction', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Briefed', description: '' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await expect.poll(() => f.sessions.sent.length).toBe(1);
    const text = f.sessions.sent[0]!.text;
    expect(text.startsWith('Plan it.\n\nWorkflow transitions from Plan:')).toBe(true);
    expect(text).toContain('- Done — The plan approved the task without further work.');
    expect(text).toContain('- Review — The plan needs a review before implementation.');
    expect(text).toContain('set_next_transition');
  });

  it('advances to the recorded destination instead of the first configured target', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Routed', description: '' });
    await arm(f.app, task.id);
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'done', reason: 'The review approved the work.' });
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('done');
    expect(f.store.requireTask(task.id).recordedTransition).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('pauses with transition-stale when the recorded transition stops resolving', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Stale', description: '' });
    await arm(f.app, task.id);
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'done', reason: 'The review approved the work.' });
    await f.store.setWorkflow('name: Narrowed\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n    allowed_transitions: [plan]\n  - id: plan\n    label: Plan\n  - id: done\n    label: Done\n');
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('transition-stale');
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
  });

  it('pauses with transition-stale when the workflow removes the recorded destination stage', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Removed destination', description: '' });
    await arm(f.app, task.id);
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'done', reason: 'The review approved the work.' });
    // The save itself must succeed; the dangling recording is the stale state.
    await f.store.setWorkflow(REMOVED_DESTINATION_FLOW);
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('transition-stale');
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
  });

  it('cascades over an uninstructed stage to the next instructed stage', async () => {
    const f = await setup();
    await f.store.setWorkflow(CASCADE_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Cascade', description: '' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('review');
    await expect.poll(() => f.sessions.sent.length).toBe(1);
    expect(f.sessions.sent.map(message => message.text)).toEqual(['Review it.']);
  });

  it('moves to the last reachable stage without sending when no stage is instructed', async () => {
    const f = await setup();
    await f.store.setWorkflow(SILENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Silent', description: '' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('done');
    expect(f.sessions.sent).toEqual([]);
    expect(f.store.requireTask(task.id).instructionPending).toBeUndefined();
  });

  it('creates exactly one conversation when the ending conversation is closed before the advance', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Closed target', description: '' });
    const original = task.sessionIds[0]!;
    await arm(f.app, task.id);
    vi.useFakeTimers();
    try {
      f.app.observe(original, turnEnd(1));
      await f.app.command({ type: 'conversation.close', taskId: task.id, sessionId: original });
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
    } finally { vi.useRealTimers(); }
    await expect.poll(() => f.sessions.sent.length, { timeout: 3_000 }).toBe(1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    const current = f.store.requireTask(task.id);
    expect(current.sessionIds).toHaveLength(2);
    expect(current.pendingTransition).toBeUndefined();
    expect(f.sessions.sent[0]!.id).toBe(current.sessionIds[1]);
  });

  it('does not advance twice for a duplicated event', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Duplicate', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    vi.useFakeTimers();
    try {
      f.app.observe(sessionId, turnEnd(9));
      f.app.observe(sessionId, turnEnd(9));
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
    } finally { vi.useRealTimers(); }
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await delay(50);
    expect(f.store.requireTask(task.id).columnId).toBe('plan');
    expect(f.sessions.sent).toHaveLength(1);
  });
});

describe('automatic advance pauses', () => {
  it('records the pause for an unsuccessful turn and does not move', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Failed turn', description: '' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1, 'error');
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('turn-error');
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
  });

  it('keeps the pause across a snapshot and clears it on the next advance', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Resume', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    await endTurn(f.app, sessionId, 1, 'blocked');
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('turn-blocked');
    await f.app.snapshot();
    expect(f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('turn-blocked');
    await endTurn(f.app, sessionId, 2);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    expect(f.store.requireTask(task.id).autoMode?.pause).toBeUndefined();
  });

  it('keeps a recorded pause across a restart', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Paused restart', description: '' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1, 'error');
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('turn-error');
    await f.app.close();
    const restarted = new KanbanApp(f.hubs, f.sessions, f.git, { probe: f.probe }, f.workspaces);
    try {
      await restarted.initialize();
      expect(f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('turn-error');
      expect(f.store.requireTask(task.id).columnId).toBe('backlog');
      expect(f.sessions.sent).toEqual([]);
    } finally {
      await restarted.close();
    }
  });

  it('clears the pause on a manual move and keeps auto mode enabled', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Manual', description: '' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1, 'aborted');
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('turn-aborted');
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan' });
    const current = f.store.requireTask(task.id);
    expect(current.autoMode?.pause).toBeUndefined();
    expect(current.autoMode?.enabled).toBe(true);
    expect(current.columnId).toBe('plan');
  });

  it('clears the pause when auto mode is disabled', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Disabled', description: '' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1, 'max-tokens');
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('turn-max-tokens');
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: false });
    expect(f.store.requireTask(task.id).autoMode).toBeUndefined();
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
  });
});


  it('dismisses a failed automatic advance and restores the card play path', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Dismiss failed', description: '' });
    await arm(f.app, task.id);
    f.sessions.failSend = true;
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition?.status).toBe('failed');
    await f.app.command({ type: 'operation.dismiss', taskId: task.id });
    const current = f.store.requireTask(task.id);
    expect(current.pendingTransition).toBeUndefined();
    expect(current.columnId).toBe('plan');
    expect(current.instructionPending?.columnId).toBe('plan');
    expect(current.autoMode?.enabled).toBe(true);
    f.sessions.failSend = false;
    const marker = current.instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'plan', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Plan it.' });
    expect(f.sessions.sent.map(message => message.text)).toEqual(['Plan it.']);
    expect(f.store.requireTask(task.id).instructionPending).toBeUndefined();
  });

  it('lets a manual stage instruction recover a failed automatic advance', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Play recovery', description: '' });
    await arm(f.app, task.id);
    f.sessions.failSend = true;
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition?.status).toBe('failed');
    f.sessions.failSend = false;
    const marker = f.store.requireTask(task.id).instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'plan', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Plan it.' });
    const current = f.store.requireTask(task.id);
    expect(f.sessions.sent.map(message => message.text)).toEqual(['Plan it.']);
    expect(current.columnId).toBe('plan');
    expect(current.pendingTransition).toBeUndefined();
    expect(current.instructionPending).toBeUndefined();
    expect(current.autoMode?.enabled).toBe(true);
  });

  it('rejects dismissing a transition that is not a failed automatic advance', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Not auto', description: '' });
    await f.store.transact(draft => {
      const value = draft.tasks.find(candidate => candidate.id === task.id)!;
      value.pendingTransition = { id: 'user-failed', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'failed' };
    });
    await expect(f.app.command({ type: 'operation.dismiss', taskId: task.id })).rejects.toMatchObject({ code: 'INVALID_TARGET' });
  });

describe('automatic advance gates', () => {
  it('waits until every conversation of the task is idle', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Concurrent', description: '' });
    const first = task.sessionIds[0]!;
    const second = await f.app.createConversation(task.id);
    await arm(f.app, task.id);
    f.sessions.busy.add(second);
    await endTurn(f.app, first, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    f.sessions.busy.delete(second);
    await endTurn(f.app, second, 2);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await expect.poll(() => f.sessions.sent.length).toBe(1);
    expect(f.sessions.sent.map(message => message.id)).toEqual([first]);
  });

  it('skips a task with an unresolved stage entry without pausing', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Unresolved entry', description: '' });
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan' });
    await arm(f.app, task.id);
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('plan');
    expect(f.store.requireTask(task.id).autoMode?.pause).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('does not replay a turn that ended while the host was not observing', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'No catch-up', description: '' });
    await arm(f.app, task.id);
    await f.app.close();
    f.sessions.settled.set(task.sessionIds[0]!, { seq: 3, outcome: 'ok' });
    const restarted = new KanbanApp(f.hubs, f.sessions, f.git, { probe: f.probe }, f.workspaces);
    try {
      await restarted.initialize();
      await delay(100);
      expect(f.store.requireTask(task.id).columnId).toBe('backlog');
      expect(f.sessions.sent).toEqual([]);
    } finally {
      await restarted.close();
    }
  });

  it('keeps a failed automatic send failed, does not retry it, and recovers through an explicit retry', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Failed send', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    f.sessions.failSend = true;
    await endTurn(f.app, sessionId, 1);
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition?.status).toBe('failed');
    const failed = f.store.requireTask(task.id);
    expect(failed.columnId).toBe('plan');
    expect(failed.instructionPending?.columnId).toBe('plan');
    expect(failed.autoMode).toEqual({ enabled: true });
    expect(f.sessions.sent).toEqual([]);
    f.sessions.failSend = false;
    await delay(200);
    expect(f.store.requireTask(task.id).pendingTransition?.status).toBe('failed');
    expect(f.sessions.sent).toEqual([]);
    await f.app.command({ type: 'operation.retry', taskId: task.id });
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    expect(f.sessions.sent.map(message => message.text)).toEqual(['Plan it.']);
    expect(f.store.requireTask(task.id).columnId).toBe('plan');
    expect(f.store.requireTask(task.id).instructionPending).toBeUndefined();
  });

  it('does not retract an admitted advance when auto mode is disabled', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Disable admitted', description: '' });
    const sessionId = task.sessionIds[0]!;
    await f.store.transact(draft => {
      const value = draft.tasks.find(candidate => candidate.id === task.id)!;
      value.pendingTransition = { id: 'auto-disable', fromColumnId: 'backlog', columnId: 'plan', mode: 'run', text: 'Plan it.', sessionId, status: 'waiting', origin: 'auto' };
    });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: false });
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await expect.poll(() => f.sessions.sent.length).toBe(1);
    expect(f.store.requireTask(task.id).autoMode).toBeUndefined();
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
  });

  it('dispatches an already persisted automatic advance on restart', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Restart', description: '' });
    const sessionId = task.sessionIds[0]!;
    await f.app.close();
    await f.store.transact(draft => {
      const value = draft.tasks.find(candidate => candidate.id === task.id)!;
      value.pendingTransition = { id: 'auto-restart', fromColumnId: 'backlog', columnId: 'plan', mode: 'run', text: 'Plan it.', sessionId, status: 'waiting', origin: 'auto' };
    });
    const restarted = new KanbanApp(f.hubs, f.sessions, f.git, { probe: f.probe }, f.workspaces);
    try {
      await restarted.initialize();
      await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
      await expect.poll(() => f.store.requireTask(task.id).pendingTransition).toBeUndefined();
      expect(f.sessions.sent.map(message => message.requestId)).toEqual(['auto-restart']);
      expect(f.store.requireTask(task.id).instructionPending).toBeUndefined();
    } finally {
      await restarted.close();
    }
  });
});


  it('does not advance when the task moved while the settle gate was reading facts', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Moved in gate', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    let release!: (facts: ConversationFacts) => void;
    f.sessions.facts = () => new Promise<ConversationFacts>(resolve => { release = resolve; });
    vi.useFakeTimers();
    try {
      f.app.observe(sessionId, turnEnd(1));
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
      await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.columnId = 'done'; });
      release({ running: false, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null });
      for (let microtask = 0; microtask < 20; microtask += 1) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(25);
    } finally { vi.useRealTimers(); }
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('done');
    expect(f.sessions.sent).toEqual([]);
  });

  it('pauses with an admission failure when the destination disappears during the gate', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Destination removed', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    let release!: (facts: ConversationFacts) => void;
    f.sessions.facts = () => new Promise<ConversationFacts>(resolve => { release = resolve; });
    vi.useFakeTimers();
    try {
      f.app.observe(sessionId, turnEnd(1));
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
      await f.store.setWorkflow(SILENT_FLOW);
      release({ running: false, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null });
      for (let microtask = 0; microtask < 20; microtask += 1) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(25);
    } finally { vi.useRealTimers(); }
    await expect.poll(() => f.store.requireTask(task.id).autoMode?.pause?.reason).toBe('advance-failed');
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
  });

  it('waits while another conversation has a pending decision question', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Pending question', description: '' });
    const first = task.sessionIds[0]!;
    const second = await f.app.createConversation(task.id);
    await arm(f.app, task.id);
    f.app.observe(second, call(1, 1, 'decision-a'));
    f.app.observe(second, result(2, 1, 'decision-a'));
    expect(f.app.questions.pending(second)).toBe(true);
    await endTurn(f.app, first, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
    expect(f.store.requireTask(task.id).autoMode?.pause).toBeUndefined();
  });

  it('holds the ending conversation for each kind of pending user work', async () => {
    const kinds: Array<{ name: string; mark: (f: Awaited<ReturnType<typeof setup>>, sessionId: string) => void }> = [
      { name: 'a queued prompt', mark: (f, sessionId) => f.sessions.queued.add(sessionId) },
      { name: 'a pending approval', mark: (f, sessionId) => f.sessions.approvals.add(sessionId) },
      { name: 'an unanswered native question', mark: (f, sessionId) => f.sessions.awaiting.add(sessionId) },
    ];
    for (const kind of kinds) {
      const f = await setup();
      await f.store.setWorkflow(FLOW);
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Held by ' + kind.name, description: '' });
      await arm(f.app, task.id);
      const sessionId = task.sessionIds[0]!;
      kind.mark(f, sessionId);
      await endTurn(f.app, sessionId, 1);
      await delay(100);
      expect(f.store.requireTask(task.id).columnId).toBe('backlog');
      expect(f.store.requireTask(task.id).autoMode?.pause).toBeUndefined();
      expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
      expect(f.sessions.sent).toEqual([]);
      f.sessions.queued.delete(sessionId); f.sessions.approvals.delete(sessionId); f.sessions.awaiting.delete(sessionId);
      await endTurn(f.app, sessionId, 2);
      await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    }
  });

  it('holds while a closed conversation still owes the user input', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Closed pending', description: '' });
    const first = task.sessionIds[0]!;
    const second = await f.app.createConversation(task.id);
    await arm(f.app, task.id);
    f.sessions.queued.add(second);
    await f.app.command({ type: 'conversation.close', taskId: task.id, sessionId: second });
    await endTurn(f.app, first, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('advances only on a completed turn after the pending work is consumed', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Consumed then turn', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    f.app.observe(sessionId, call(1, 1, 'c1'));
    f.app.observe(sessionId, result(2, 1, 'c1'));
    await endTurn(f.app, sessionId, 3);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    // Consuming the round without a completed turn does not move the card.
    f.app.observe(sessionId, human(4));
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    await endTurn(f.app, sessionId, 5);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
  });

  it('holds for an open question round in a closed conversation', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Closed round', description: '' });
    const first = task.sessionIds[0]!;
    const second = await f.app.createConversation(task.id);
    f.app.observe(second, call(1, 1, 'closed-1'));
    f.app.observe(second, result(2, 1, 'closed-1'));
    await f.app.command({ type: 'conversation.close', taskId: task.id, sessionId: second });
    await arm(f.app, task.id);
    await endTurn(f.app, first, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('clears the derived pending state after a dismissal without a conversation event', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Dismissed hold', description: '' });
    const sessionId = task.sessionIds[0]!;
    f.app.observe(sessionId, call(1, 1, 'c1'));
    f.app.observe(sessionId, result(2, 1, 'c1'));
    const rounds = await f.app.rounds(sessionId);
    await delay(80);
    expect((await f.app.snapshot({refreshSessionIds:[sessionId]})).conversations[sessionId]?.pending.kinds).toEqual(['decision-question']);
    // Prepared already, so only the dismissal itself can re-project the derived state.
    await f.app.dismissQuestions(sessionId, rounds[0]!.id);
    await delay(80);
    expect((await f.app.snapshot({refreshSessionIds:[sessionId]})).conversations[sessionId]?.pending.kinds).toEqual([]);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
  });

  it('re-validates pending user work during the admission', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Late pending', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    const idle = { running: false, background: [], pending: pendingUserWork([]), settledTurn: null };
    let reads = 0;
    const original = f.sessions.facts.bind(f.sessions);
    // The idle conversation has no active facts, so the reconcile tick starts no read.
    // The advance settle is the first read and the admission re-check is the second;
    // only the admission sees the queued prompt, so the assertion is about the re-check.
    f.sessions.facts = async (id: string) => {
      if (id !== sessionId) return original(id);
      reads += 1;
      return reads <= 1 ? idle : { ...idle, pending: pendingUserWork(['queued-prompt'], 1) };
    };
    await endTurn(f.app, sessionId, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    expect(f.store.requireTask(task.id).autoMode?.pause).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('does not advance for a turn that ended before auto mode was re-enabled', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Re-enabled', description: '' });
    await arm(f.app, task.id);
    const sessionId = task.sessionIds[0]!;
    vi.useFakeTimers();
    try {
      f.app.observe(sessionId, turnEnd(1));
      await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: false });
      await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25);
    } finally { vi.useRealTimers(); }
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
    expect(f.store.requireTask(task.id).autoMode?.enabled).toBe(true);
  });

describe('automatic advance disposal', () => {
  it('ignores turn boundaries after the app closes', async () => {
    const f = await setup();
    await f.store.setWorkflow(FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Closed host', description: '' });
    await arm(f.app, task.id);
    await f.app.close();
    f.app.observe(task.sessionIds[0]!, turnEnd(1));
    await delay(50);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
  });
});

describe('declared transition advance', () => {
  const DECLARED_FLOW = [
    'name: Declared flow',
    'initial_column: backlog',
    'columns:',
    '  - id: backlog',
    '    label: Backlog',
    '    allowed_transitions:',
    '      - to: plan',
    '        when: The task needs a plan.',
    '      - to: done',
    '        when: The task needs no further work.',
    '  - id: plan',
    '    label: Plan',
    '    on_enter_prompt: Plan it.',
    '  - id: done',
    '    label: Done',
    '',
  ].join('\n');

  it('advances without auto mode and delivers the declared reason after the instruction', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared', description: '' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'plan', reason: 'The bug needs a plan before code.' });
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await expect.poll(() => f.sessions.sent.length).toBe(1);
    const current = f.store.requireTask(task.id);
    expect(current.autoMode).toBeUndefined();
    expect(current.recordedTransition).toBeUndefined();
    expect(f.sessions.sent[0]!.text).toBe('Plan it.\n\nTransition reason (from Backlog):\nThe bug needs a plan before code.');
  });

  it('records no pause and keeps the declaration when the turn does not complete', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared failed', description: '' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'plan', reason: 'The bug needs a plan before code.' });
    await endTurn(f.app, task.sessionIds[0]!, 1, 'error');
    await delay(100);
    const current = f.store.requireTask(task.id);
    expect(current.columnId).toBe('backlog');
    expect(current.autoMode).toBeUndefined();
    expect(current.recordedTransition).toMatchObject({ columnId: 'plan', reason: 'The bug needs a plan before code.' });
    expect(f.sessions.sent).toEqual([]);
    // The preserved declaration is what the next completed turn acts on.
    await endTurn(f.app, task.sessionIds[0]!, 2);
    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    await expect.poll(() => f.sessions.sent.length).toBe(1);
  });

  it('does not advance on a declaration that stopped resolving and records no pause', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared stale', description: '' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'done', reason: 'The task is finished.' });
    await f.store.setWorkflow([
      'name: Narrowed', 'initial_column: backlog', 'columns:',
      '  - id: backlog', '    label: Backlog', '    allowed_transitions: [plan]',
      '  - id: plan', '    label: Plan', '    on_enter_prompt: Plan it.',
      '  - id: done', '    label: Done', '',
    ].join('\n'));
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await delay(100);
    const current = f.store.requireTask(task.id);
    expect(current.columnId).toBe('backlog');
    expect(current.autoMode).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('holds a declared advance while the task owes the user input', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared held', description: '' });
    const sessionId = task.sessionIds[0]!;
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'plan', reason: 'The bug needs a plan before code.' });
    f.sessions.queued.add(sessionId);
    await endTurn(f.app, sessionId, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('does not advance when the declaration is cleared before the turn ends', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared cleared', description: '' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'plan', reason: 'The bug needs a plan before code.' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id });
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await delay(100);
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(task.id).recordedTransition).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('keeps the declared reason on a failed advance and recovers it through the play action', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared failed send', description: '' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'plan', reason: 'The bug needs a plan before code.' });
    f.sessions.failSend = true;
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition?.status).toBe('failed');
    const failed = f.store.requireTask(task.id);
    expect(failed.columnId).toBe('plan');
    expect(failed.pendingTransition).toMatchObject({ origin: 'agent', reason: 'The bug needs a plan before code.' });
    const failedId = failed.pendingTransition!.id;
    f.sessions.failSend = false;
    const marker = failed.instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'plan', expectedInstruction: 'Plan it.', expectedEnteredAt: marker.enteredAt });
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    const sent = f.sessions.sent.at(-1)!;
    // The manual retry delivers the same justification and replays the identity the
    // failed admission owned, so a delivery that did land is never sent twice.
    expect(sent.text).toBe('Plan it.\n\nTransition reason (from Backlog):\nThe bug needs a plan before code.');
    expect(sent.requestId).toBe(failedId);
  });

  it('replays the failed identity without sending the instruction twice', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared landed', description: '' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'plan', reason: 'The bug needs a plan before code.' });
    f.sessions.failSend = true;
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition?.status).toBe('failed');
    const failed = f.store.requireTask(task.id).pendingTransition!;
    f.sessions.failSend = false;
    // The admission landed but its post-delivery write did not; the replay must
    // recognise the identity instead of delivering the instruction again.
    await f.sessions.deliverStageInstruction(task.sessionIds[0]!, {
      requestId: failed.id, text: 'Plan it.', summary: 'Stage: Plan',
    });
    const marker = f.store.requireTask(task.id).instructionPending!;
    await f.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'plan', expectedInstruction: 'Plan it.', expectedEnteredAt: marker.enteredAt });
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    expect(f.sessions.sent.filter(message => message.requestId === failed.id)).toHaveLength(1);
  });

  it('dismisses a failed declared advance without moving the task again', async () => {
    const f = await setup();
    await f.store.setWorkflow(DECLARED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Declared failed dismiss', description: '' });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'plan', reason: 'The bug needs a plan before code.' });
    f.sessions.failSend = true;
    await endTurn(f.app, task.sessionIds[0]!, 1);
    await expect.poll(() => f.store.requireTask(task.id).pendingTransition?.status).toBe('failed');
    await f.app.command({ type: 'operation.dismiss', taskId: task.id });
    const current = f.store.requireTask(task.id);
    expect(current.pendingTransition).toBeUndefined();
    expect(current.columnId).toBe('plan');
    expect(current.instructionPending?.columnId).toBe('plan');
    f.sessions.failSend = false;
  });
});

