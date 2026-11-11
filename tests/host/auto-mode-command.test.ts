import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandSchema } from '../../src/remote.js';
import { AUTO_ADVANCE_SETTLE_MS } from '../../src/host/auto-advance.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { fixture, taskWithConversation } from './helpers.js';

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
  '  - id: done',
  '    label: Done',
  '',
].join('\n');
const turnEnd = (seq: number) => ({ type: 'turn/end', seq, data: { turn: 1, reason: { kind: 'completed' } } });

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { vi.useRealTimers(); for (const f of active.splice(0)) await f.close(); });
async function setup() { const f = await fixture(); active.push(f); return f; }

describe('task.autoMode command', () => {
  it('accepts the wire command and rejects a missing, mistyped, or extra field', () => {
    const enable = { type: 'task.autoMode' as const, taskId: 'task-1', enabled: true };
    expect(CommandSchema.parse(enable)).toEqual(enable);
    expect(CommandSchema.parse({ ...enable, enabled: false })).toMatchObject({ enabled: false });
    expect(() => CommandSchema.parse({ type: 'task.autoMode', taskId: 'task-1' })).toThrow();
    expect(() => CommandSchema.parse({ ...enable, enabled: 'yes' })).toThrow();
    expect(() => CommandSchema.parse({ ...enable, extra: true })).toThrow();
  });

  it('accepts the dismiss wire command and rejects extra fields', () => {
    const dismiss = { type: 'operation.dismiss' as const, taskId: 'task-1' };
    expect(CommandSchema.parse(dismiss)).toEqual(dismiss);
    expect(() => CommandSchema.parse({ ...dismiss, extra: true })).toThrow();
    expect(() => CommandSchema.parse({ type: 'operation.dismiss' })).toThrow();
  });

  it('accepts a wire deletion without the removed bulk flag', () => {
    const deletion = { type: 'task.delete' as const, taskId: 'task-1', confirmed: true, expectedWorktreePath: null };
    expect(CommandSchema.parse(deletion)).toEqual(deletion);
    expect(CommandSchema.parse({ ...deletion, force: true })).toMatchObject({ force: true });
    expect(() => CommandSchema.parse({ ...deletion, requireIdle: true })).toThrow();
  });

  it('arms and disarms without moving the task, sending, or creating a conversation', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Auto task', description: '' });
    const before = { columnId: task.columnId, position: task.position, sessions: f.sessions.dirs.size, sent: f.sessions.sent.length, pending: task.pendingTransition };
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    let current = f.store.requireTask(task.id);
    expect(current.autoMode).toEqual({ enabled: true });
    expect(current.columnId).toBe(before.columnId);
    expect(current.position).toBe(before.position);
    expect(current.pendingTransition).toBeUndefined();
    expect(f.sessions.dirs.size).toBe(before.sessions);
    expect(f.sessions.sent).toHaveLength(before.sent);
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: false });
    current = f.store.requireTask(task.id);
    expect(current.autoMode).toBeUndefined();
    expect(current.columnId).toBe(before.columnId);
    expect(f.sessions.sent).toHaveLength(before.sent);
  });

  it('mutates only the Hub that owns the task', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Owned task', description: '' });
    const other = await f.hubs.createHub('Other');
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true, hubId: other.id });
    expect(f.hubs.requireHub(other.id).tasks).toHaveLength(0);
    expect(f.store.requireTask(task.id).autoMode).toEqual({ enabled: true });
  });
});

describe('task.pause and task.resume commands', () => {
  it('accepts the wire commands and rejects a missing reason or an extra field', () => {
    const pause = { type: 'task.pause' as const, taskId: 'task-1', reason: 'Review the diff' };
    expect(CommandSchema.parse(pause)).toEqual(pause);
    const resume = { type: 'task.resume' as const, taskId: 'task-1' };
    expect(CommandSchema.parse(resume)).toEqual(resume);
    expect(() => CommandSchema.parse({ type: 'task.pause', taskId: 'task-1' })).toThrow();
    expect(() => CommandSchema.parse({ ...resume, extra: true })).toThrow();
  });

  it('records nothing for a task without auto mode', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Idle task', description: '' });
    await f.app.command({ type: 'task.pause', taskId: task.id, reason: 'Review the diff' });
    expect(f.store.requireTask(task.id).autoMode).toBeUndefined();
  });

  it('pauses and resumes without moving, sending, or clearing the routing', async () => {
    const f = await setup();
    await f.store.setWorkflow(BRANCHED_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Pausable', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    await f.app.command({ type: 'task.recordTransition', taskId: task.id, columnId: 'done' });
    const before = { columnId: task.columnId, position: task.position, sessions: f.sessions.dirs.size, sent: f.sessions.sent.length };

    await f.app.command({ type: 'task.pause', taskId: task.id, reason: '  Review the diff  ' });
    let current = f.store.requireTask(task.id);
    expect(current.autoMode).toMatchObject({ enabled: true, hold: { reason: 'Review the diff' } });
    expect(current.columnId).toBe(before.columnId);
    expect(current.position).toBe(before.position);
    expect(current.recordedTransition?.columnId).toBe('done');
    expect(f.sessions.sent).toHaveLength(before.sent);
    expect(f.sessions.dirs.size).toBe(before.sessions);

    await f.app.command({ type: 'task.resume', taskId: task.id });
    current = f.store.requireTask(task.id);
    expect(current.autoMode).toEqual({ enabled: true });
    expect(current.recordedTransition?.columnId).toBe('done');
    expect(current.columnId).toBe(before.columnId);
    expect(f.sessions.sent).toHaveLength(before.sent);
  });

  it('forgets the queued settle so a resume never advances a turn that already ended', async () => {
    for (const resume of [{ type: 'task.resume' as const }, { type: 'task.autoMode' as const, enabled: true }]) {
      const f = await setup();
      await f.store.setWorkflow(SILENT_FLOW);
      const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Queued', description: '' });
      await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
      await f.app.command({ type: 'task.pause', taskId: task.id, reason: 'Review the diff' });

      vi.useFakeTimers();
      try {
        f.app.observe(task.sessionIds[0]!, turnEnd(1));
        await f.app.command({ ...resume, taskId: task.id });
        await vi.advanceTimersByTimeAsync(AUTO_ADVANCE_SETTLE_MS + 25);
      } finally {
        vi.useRealTimers();
      }

      expect(f.store.requireTask(task.id).columnId).toBe('backlog');
      expect(f.store.requireTask(task.id).autoMode).toEqual({ enabled: true });
      expect(f.sessions.sent).toHaveLength(0);
    }
  });

  it('keeps the pause across a reopened Hub document', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Restarted', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    await f.app.command({ type: 'task.pause', taskId: task.id, reason: 'Review the diff' });
    await f.app.close();

    const reopened = await HubRepository.open(f.storage);
    try {
      const stored = reopened.defaultHub().requireTask(task.id);
      expect(stored.autoMode).toMatchObject({ enabled: true, hold: { reason: 'Review the diff' } });
    } finally {
      await reopened.close();
    }
  });

  it('keeps the agent pause when an automatic advance drains', async () => {
    const f = await setup();
    await f.store.setWorkflow(SILENT_FLOW);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Admitted', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    await f.app.command({ type: 'task.pause', taskId: task.id, reason: 'Review the diff' });

    // The state under test is an automatic placement while the pause is recorded:
    // the advance that was already admitted drains and the pause survives it. The
    // seed order only makes that state reachable without racing the drain.
    await f.store.transact(draft => {
      const value = draft.tasks.find(candidate => candidate.id === task.id)!;
      value.pendingTransition = { id: 'auto-admitted', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'waiting', origin: 'auto' };
    });

    await expect.poll(() => f.store.requireTask(task.id).columnId).toBe('plan');
    const current = f.store.requireTask(task.id);
    expect(current.autoMode).toMatchObject({ enabled: true, hold: { reason: 'Review the diff' } });
    expect(current.pendingTransition).toBeUndefined();
  });
});
