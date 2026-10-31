import { afterEach, describe, expect, it } from 'vitest';
import { CommandSchema } from '../../src/remote.js';
import { fixture, taskWithConversation } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
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

  it('is preserved by a move, an edit, a snapshot, and session observation', async () => {
    const f = await setup();
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Preserved task', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan' });
    expect(f.store.requireTask(task.id).columnId).toBe('plan');
    expect(f.store.requireTask(task.id).autoMode).toEqual({ enabled: true });
    await f.app.command({ type: 'task.edit', taskId: task.id, title: 'Renamed' });
    await f.app.snapshot();
    f.app.observe(task.sessionIds[0]!, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
    const current = f.store.requireTask(task.id);
    expect(current.title).toBe('Renamed');
    expect(current.autoMode?.enabled).toBe(true);
  });
});
