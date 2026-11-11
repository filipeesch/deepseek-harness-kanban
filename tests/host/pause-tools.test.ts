import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { PAUSE_REASON_LIMIT } from '../../src/domain/auto-mode-hold.js';
import { fixture, taskWithConversation } from './helpers.js';

const BRANCHED_WORKFLOW = [
  'name: Branch',
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
].join(String.fromCharCode(10));

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });

async function setup() {
  const f = await fixture();
  active.push(f);
  await f.store.saveBoardWorkflow(f.board.id, BRANCHED_WORKFLOW);
  const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Pausable', description: '' });
  await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
  const tools = productToolDefinitions(f.app);
  const exec = () => ({ signal: new AbortController().signal, agent: { id: task.sessionIds[0]! }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext);
  const ordinary = () => ({ ...exec(), agent: { id: 'ordinary-session' } } as unknown as ToolRunContext);
  const named = (name: string): ToolDefinition => {
    const definition = tools.find(value => value.name === name);
    if (!definition) throw new Error('Missing test tool ' + name);
    return definition;
  };
  return { ...f, task, tools, exec, ordinary, named };
}

describe('task pause tools', () => {
  it('pauses the calling task and reports the pause in effect', async () => {
    const f = await setup();
    const view = await f.named('pause_task').execute({ reason: '  Review the diff  ' }, f.exec()) as Record<string, unknown>;
    expect(view).toMatchObject({ taskId: f.task.id, stage: { columnId: 'backlog' }, autoModeEnabled: true, paused: true, pause: { reason: 'Review the diff' } });
    expect(view.note).toBeUndefined();
    expect(f.app.hubs.requireTask(f.task.id).task.autoMode).toMatchObject({ enabled: true, hold: { reason: 'Review the diff' } });
  });

  it('rejects a blank or oversized reason instead of recording one', async () => {
    const f = await setup();
    await expect(f.named('pause_task').execute({ reason: '   ' }, f.exec())).rejects.toMatchObject({ code: 'PAUSE_REASON_REQUIRED' });
    await expect(f.named('pause_task').execute({ reason: 'x'.repeat(PAUSE_REASON_LIMIT + 1) }, f.exec())).rejects.toMatchObject({ code: 'PAUSE_REASON_TOO_LONG' });
    expect(f.app.hubs.requireTask(f.task.id).task.autoMode).toEqual({ enabled: true });
  });

  it('reports a task that does not advance instead of pausing it', async () => {
    const f = await setup();
    await f.app.command({ type: 'task.autoMode', taskId: f.task.id, enabled: false });
    const view = await f.named('pause_task').execute({ reason: 'Review the diff' }, f.exec()) as Record<string, unknown>;
    expect(view).toMatchObject({ autoModeEnabled: false, paused: false });
    expect(String(view.note)).toContain('does not advance');
    expect(f.app.hubs.requireTask(f.task.id).task.autoMode).toBeUndefined();
  });

  it('reports a resume of a task that is not paused without changing it', async () => {
    const f = await setup();
    const before = f.app.hubs.requireTask(f.task.id).task;
    const view = await f.named('resume_task').execute({}, f.exec()) as Record<string, unknown>;
    expect(view).toMatchObject({ paused: false, autoModeEnabled: true });
    expect(view.note).toBe('The task was not paused, so nothing changed.');
    const after = f.app.hubs.requireTask(f.task.id).task;
    expect(after.autoMode).toEqual({ enabled: true });
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('resolves another task by identifier and leaves the calling task alone', async () => {
    const f = await setup();
    const other = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Other', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: other.id, enabled: true });

    const paused = await f.named('pause_task').execute({ task_id: other.id, reason: 'Review the other diff' }, f.exec()) as Record<string, unknown>;
    expect(paused).toMatchObject({ taskId: other.id, paused: true, pause: { reason: 'Review the other diff' } });
    expect(f.app.hubs.requireTask(f.task.id).task.autoMode).toEqual({ enabled: true });
    expect(f.app.hubs.requireTask(other.id).task.autoMode).toMatchObject({ enabled: true, hold: { reason: 'Review the other diff' } });

    const resumed = await f.named('resume_task').execute({ task_id: other.id }, f.ordinary()) as Record<string, unknown>;
    expect(resumed).toMatchObject({ taskId: other.id, paused: false });
    expect(f.app.hubs.requireTask(other.id).task.autoMode).toEqual({ enabled: true });
    expect(f.app.hubs.requireTask(f.task.id).task.autoMode).toEqual({ enabled: true });
  });

  it('requires a task scope outside a task conversation', async () => {
    const f = await setup();
    await expect(f.named('pause_task').execute({ reason: 'Review the diff' }, f.ordinary())).rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
    await expect(f.named('resume_task').execute({}, f.ordinary())).rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
  });

  it('never moves the task, sends a message, or clears the routing', async () => {
    const f = await setup();
    await f.app.command({ type: 'task.recordTransition', taskId: f.task.id, columnId: 'done', reason: 'The review approved the work.' });
    const before = { columnId: f.task.columnId, position: f.task.position, sent: f.sessions.sent.length, sessions: f.sessions.dirs.size };

    await f.named('pause_task').execute({ reason: 'Review the diff' }, f.exec());
    const paused = f.app.hubs.requireTask(f.task.id).task;
    expect(paused.columnId).toBe(before.columnId);
    expect(paused.position).toBe(before.position);
    expect(paused.recordedTransition).toMatchObject({ columnId: 'done' });

    await f.named('resume_task').execute({}, f.exec());
    const resumed = f.app.hubs.requireTask(f.task.id).task;
    expect(resumed.columnId).toBe(before.columnId);
    expect(resumed.position).toBe(before.position);
    expect(resumed.recordedTransition).toMatchObject({ columnId: 'done' });
    expect(f.sessions.sent).toHaveLength(before.sent);
    expect(f.sessions.dirs.size).toBe(before.sessions);
  });
});
