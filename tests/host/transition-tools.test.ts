import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { transitionTools, type TaskRoutingPort } from '../../src/host/tools/transitions.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import type { Board, HubState, HubTask, Project, Workflow } from '../../src/shared/types.js';
import { fixture, taskWithConversation } from './helpers.js';

const now = '2026-01-01T00:00:00.000Z';

const BRANCHED_WORKFLOW = [
  'name: Branch',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    allowed_transitions:',
  '      - to: done',
  '        when: The task needs no further work.',
  '      - to: plan',
  '        when: The task needs a plan.',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: Plan it.',
  '  - id: done',
  '    label: Done',
  '',
].join(String.fromCharCode(10));

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });

const PARAMETERIZED_WORKFLOW = [
  'name: Parameterized',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    allowed_transitions:',
  '      - to: wait',
  '  - id: wait',
  '    label: Wait',
  '    deterministic:',
  '      language: bash',
  '      code: echo ok',
  '      params:',
  '        - name: pipeline',
  '          description: CI workflow',
  '      exits:',
  '        ok: done',
  '  - id: done',
  '    label: Done',
  '',
].join(String.fromCharCode(10));

async function setup(workflow = BRANCHED_WORKFLOW) {
  const f = await fixture();
  active.push(f);
  await f.store.saveBoardWorkflow(f.board.id, workflow);
  const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Route', description: '' });
  const tools = productToolDefinitions(f.app);
  const exec = (sessionId: string = task.sessionIds[0]!) => ({ signal: new AbortController().signal, agent: { id: sessionId }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext);
  const named = (name: string): ToolDefinition => {
    const definition = tools.find(value => value.name === name);
    if (!definition) throw new Error('Missing test tool ' + name);
    return definition;
  };
  return { ...f, task, tools, exec, named };
}

describe('transition tools', () => {
  it('lists the configured transitions and the default destination', async () => {
    const f = await setup();
    const value = await f.named('list_allowed_transitions').execute({}, f.exec()) as Record<string, unknown>;
    expect(value).toMatchObject({ taskId: f.task.id, stage: { columnId: 'backlog' }, configured: true, defaultColumnId: 'done', recorded: null, armed: false });
    expect(value.targets).toEqual([
      { columnId: 'done', name: 'Done', when: 'The task needs no further work.' },
      { columnId: 'plan', name: 'Plan', when: 'The task needs a plan.' },
    ]);
  });

  it('names the peer request as one trigger and keeps the stage rules', async () => {
    const f = await setup();
    const description = f.named('set_next_transition').description;
    expect(description).toContain('message from another task');
    expect(description).toContain('current stage configures');
    expect(description).toContain('deterministic entry');
    expect(description).toContain('never moves the task');
  });

  it('declares, replaces, and clears the transition without moving the task', async () => {
    const f = await setup();
    const set = f.named('set_next_transition');
    const declared = await set.execute({ column_id: 'plan', reason: ' The work needs a plan. ' }, f.exec()) as Record<string, unknown>;
    expect(declared.recorded).toMatchObject({ columnId: 'plan', fromColumnId: 'backlog', reason: 'The work needs a plan.' });
    expect(declared.armed).toBe(true);
    expect(f.app.hubs.requireTask(f.task.id).task.columnId).toBe('backlog');
    const replaced = await set.execute({ column_id: 'done', reason: 'The work is complete.' }, f.exec()) as Record<string, unknown>;
    expect(replaced.recorded).toMatchObject({ columnId: 'done', reason: 'The work is complete.' });
    const cleared = await set.execute({}, f.exec()) as Record<string, unknown>;
    expect(cleared.recorded).toBeNull();
    expect(cleared.armed).toBe(false);
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toBeUndefined();
    expect(f.sessions.sent).toEqual([]);
  });

  it('rejects a declaration without a usable reason and keeps the previous one', async () => {
    const f = await setup();
    const set = f.named('set_next_transition');
    await set.execute({ column_id: 'plan', reason: 'The work needs a plan.' }, f.exec());
    await expect(set.execute({ column_id: 'done' }, f.exec())).rejects.toThrowError(/requires a reason/);
    await expect(set.execute({ column_id: 'done', reason: '   ' }, f.exec())).rejects.toThrowError(/nonempty/);
    await expect(set.execute({ column_id: 'done', reason: 'a'.repeat(1001) }, f.exec())).rejects.toThrowError(/1000 characters or fewer/);
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toMatchObject({ columnId: 'plan', reason: 'The work needs a plan.' });
    expect(f.app.hubs.requireTask(f.task.id).task.columnId).toBe('backlog');
    expect(f.sessions.sent).toEqual([]);
  });

  it('rejects a target the stage does not configure and keeps the recording', async () => {
    const f = await setup();
    const set = f.named('set_next_transition');
    await set.execute({ column_id: 'plan', reason: 'The work needs a plan.' }, f.exec());
    await expect(set.execute({ column_id: 'backlog', reason: 'Round trip.' }, f.exec())).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toMatchObject({ columnId: 'plan' });
  });

  it('reports a stage that configures no transitions', async () => {
    const f = await setup();
    const listed = await f.named('list_allowed_transitions').execute({ task_id: f.task.id }, f.exec()) as Record<string, unknown>;
    expect(listed.configured).toBe(true);
    await f.app.command({ type: 'task.recordTransition', taskId: f.task.id, columnId: 'plan', reason: 'The work needs a plan.' });
    await f.app.command({ type: 'task.move', taskId: f.task.id, columnId: 'plan' });
    const afterMove = await f.named('list_allowed_transitions').execute({ task_id: f.task.id }, f.exec()) as Record<string, unknown>;
    expect(afterMove).toMatchObject({ stage: { columnId: 'plan' }, configured: false, recorded: null });
    expect(afterMove.targets).toEqual([]);
    await expect(f.named('set_next_transition').execute({ column_id: 'done', reason: 'Done.' }, f.exec()))
      .rejects.toMatchObject({ code: 'TRANSITIONS_NOT_CONFIGURED' });
  });

  it('records only the task that owns the calling conversation', async () => {
    const f = await setup();
    const other = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Other', description: '' });
    await expect(f.named('set_next_transition').execute({ task_id: other.id, column_id: 'plan', reason: 'Route the other task.' }, f.exec()))
      .rejects.toMatchObject({ code: 'TASK_SCOPE_NOT_ACCEPTED' });
    expect(f.app.hubs.requireTask(other.id).task.recordedTransition).toBeUndefined();
    const own = await f.named('set_next_transition').execute({ column_id: 'plan', reason: 'The work needs a plan.' }, f.exec()) as Record<string, unknown>;
    expect(own.taskId).toBe(f.task.id);
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toMatchObject({ columnId: 'plan' });
  });

  it('requires a task conversation for the write and reads another task when asked', async () => {
    const f = await setup();
    const ordinary = f.exec('ordinary-session');
    await expect(f.named('set_next_transition').execute({ column_id: 'plan', reason: 'Nowhere to route.' }, ordinary))
      .rejects.toMatchObject({ code: 'MISSING_TASK_CONTEXT' });
    const explicit = await f.named('list_allowed_transitions').execute({ task_id: f.task.id }, ordinary) as Record<string, unknown>;
    expect(explicit.taskId).toBe(f.task.id);
  });

  it('depends only on the routing port', async () => {
    const workflow: Workflow = {
      name: 'Flow', initialColumnId: 'backlog', groups: [],
      columns: [{ id: 'backlog', name: 'Backlog', allowedTransitions: [{ to: 'plan', when: 'Plan needed.' }] }, { id: 'plan', name: 'Plan' }],
    };
    const board: Board = { id: 'board', name: 'Board', workflowYaml: '', workflow, createdAt: now, updatedAt: now };
    const task: HubTask = {
      id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
      sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: now, updatedAt: now,
    };
    const project: Project = { id: 'project', projectKey: 'project', name: 'Project', projectPath: '/repo' };
    const located = (): LocatedTask => ({ hubId: 'hub', hub: {} as HubState, board, project, task });
    const writes: Array<{ taskId: string; write: unknown }> = [];
    const port: TaskRoutingPort = {
      locator: { bySession: sessionId => sessionId === 's1' ? located() : undefined },
      hubs: { findTask: taskId => taskId === 'task' ? located() : undefined },
      recordTransition: async (taskId, write) => { writes.push({ taskId, write }); return located(); },
    };
    const tools = transitionTools(port);
    const set = tools.find(value => value.name === 'set_next_transition')!;
    const exec = { signal: new AbortController().signal, agent: { id: 's1' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
    const value = await set.execute({ column_id: 'plan', reason: 'The work needs a plan.' }, exec) as Record<string, unknown>;
    expect(value.taskId).toBe('task');
    expect(writes).toEqual([{ taskId: 'task', write: { columnId: 'plan', reason: 'The work needs a plan.' } }]);
    await set.execute({ column_id: 'plan', reason: 'The work needs a plan.', parameters: { pipeline: 'ci' } }, exec);
    expect(writes[1]).toEqual({ taskId: 'task', write: { columnId: 'plan', reason: 'The work needs a plan.', parameters: { pipeline: 'ci' } } });
  });
});

describe('parameterized transition targets', () => {
  it('reports the declared parameters of every target that declares them', async () => {
    const f = await setup(PARAMETERIZED_WORKFLOW);
    const value = await f.named('list_allowed_transitions').execute({}, f.exec()) as Record<string, unknown>;
    expect(value.targets).toEqual([{ columnId: 'wait', name: 'Wait', parameters: [{ name: 'pipeline', description: 'CI workflow' }] }]);
  });

  it('records every declared value and echoes the recorded set', async () => {
    const f = await setup(PARAMETERIZED_WORKFLOW);
    const value = await f.named('set_next_transition').execute({ column_id: 'wait', reason: 'Monitor the CI workflow.', parameters: { pipeline: 'ci-main' } }, f.exec()) as Record<string, unknown>;
    expect(value.recorded).toMatchObject({ columnId: 'wait', fromColumnId: 'backlog', parameters: { pipeline: 'ci-main' } });
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toMatchObject({ parameters: { pipeline: 'ci-main' } });
    expect(f.app.hubs.requireTask(f.task.id).task.columnId).toBe('backlog');
  });

  it('rejects a missing, unknown, empty, or undeclared value set and keeps the recording', async () => {
    const f = await setup(PARAMETERIZED_WORKFLOW);
    const set = f.named('set_next_transition');
    await set.execute({ column_id: 'wait', reason: 'Monitor.', parameters: { pipeline: 'ci-main' } }, f.exec());
    await expect(set.execute({ column_id: 'wait', reason: 'Monitor.', parameters: {} }, f.exec())).rejects.toThrow(/Missing required parameter: pipeline/);
    await expect(set.execute({ column_id: 'wait', reason: 'Monitor.', parameters: { pipeline: 'ci', app: 'checkout' } }, f.exec())).rejects.toThrow(/Undeclared parameter: app/);
    await expect(set.execute({ column_id: 'wait', reason: 'Monitor.', parameters: { pipeline: '' } }, f.exec())).rejects.toThrow(/Missing required parameter: pipeline/);
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toMatchObject({ parameters: { pipeline: 'ci-main' } });
    expect(f.app.hubs.requireTask(f.task.id).task.columnId).toBe('backlog');
  });

  it('rejects any value set for a target that declares none', async () => {
    const f = await setup();
    await expect(f.named('set_next_transition').execute({ column_id: 'done', reason: 'Done.', parameters: { pipeline: 'ci' } }, f.exec()))
      .rejects.toThrow(/declares no parameters/);
    await expect(f.named('set_next_transition').execute({ column_id: 'done', reason: 'Done.', parameters: {} }, f.exec()))
      .rejects.toThrow(/declares no parameters/);
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toBeUndefined();
  });

  it('rejects parameters without a destination and keeps the recording', async () => {
    const f = await setup(PARAMETERIZED_WORKFLOW);
    const set = f.named('set_next_transition');
    await set.execute({ column_id: 'wait', reason: 'Monitor.', parameters: { pipeline: 'ci-main' } }, f.exec());
    await expect(set.execute({ parameters: { pipeline: 'ci-other' } }, f.exec())).rejects.toThrow(/Parameters require a destination stage/);
    expect(f.app.hubs.requireTask(f.task.id).task.recordedTransition).toMatchObject({ columnId: 'wait', parameters: { pipeline: 'ci-main' } });
  });
});
