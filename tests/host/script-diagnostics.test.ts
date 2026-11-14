import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions, WORKFLOW_DESIGN_TOOLS } from '../../src/host/tools.js';
import { fixture } from './helpers.js';

const AT = '2026-11-13T10:00:00.000Z';
type Fixture = Awaited<ReturnType<typeof fixture>>;
type F = Fixture & { tools: ToolDefinition[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

async function setup(): Promise<F> {
  const f = await fixture();
  const value: F = { ...f, tools: productToolDefinitions(f.app) };
  active.push(value);
  return value;
}

function execution(id = 'ordinary-session'): ToolRunContext {
  return { signal: new AbortController().signal, agent: { id }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
}

function named(tools: ToolDefinition[], name: string): ToolDefinition {
  const definition = tools.find(candidate => candidate.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

/** Seed one entry-bound scripted execution exactly as the supervisor would have left it. */
async function read(f: F, args: Record<string, unknown>, id = 'ordinary-session'): Promise<any> {
  return named(f.tools, 'get_script_execution').execute(args, execution(id));
}

async function seedExecution(f: F, taskId: string, overrides: { hold?: boolean; destinationIdentity?: string } = {}): Promise<void> {
  await f.store.transact(draft => {
    const board = draft.boards.find(value => value.id === draft.tasks.find(task => task.id === taskId)!.boardId)!;
    board.localStageIdentities = { in_review: 'stage-review' };
    const task = draft.tasks.find(value => value.id === taskId)!;
    task.columnId = 'in_progress';
    task.stageEntry = { id: 'entry-1', columnId: 'in_progress', stageIdentity: 'stage-run', enteredAt: AT };
    task.history = [{ kind: 'deterministic-execution', at: AT, executionId: 'exec-0', columnId: 'in_progress', outcome: 'stopped' }];
    task.deterministic = {
      entryId: 'entry-1', executionId: 'exec-1', stageIdentity: 'stage-run',
      definition: { language: 'bash', code: 'echo hi', directory: 'task', params: [{ name: 'pipeline' }], exits: { passed: 'in_review' } },
      parameters: { pipeline: 'ci-main' },
      phase: 'result-ready', startedAt: AT, attempt: 1, restartCount: 0,
      capture: {
        sourceRef: 'source-1', fingerprint: 'fp-1', language: 'bash', directory: 'task', executionDirectory: f.projectPath,
        source: { kind: 'inline' }, env: [], params: ['pipeline'],
        exits: { passed: { columnId: 'in_review', stageIdentity: overrides.destinationIdentity ?? 'stage-review' } },
      },
      result: { id: 'result-1', exit: 'passed', message: 'CI passed', at: AT, target: { columnId: 'in_review', stageIdentity: overrides.destinationIdentity ?? 'stage-review' }, deliveryStatus: 'pending' },
      ...(overrides.hold === false ? {} : { hold: { code: 'conversation-active' as const, at: AT } }),
    };
  });
}

describe('script execution read', () => {
  it('is declared in the workflow design tool set', async () => {
    expect(WORKFLOW_DESIGN_TOOLS).toContain('get_script_execution');
    const f = await setup();
    expect(f.tools.map(tool => tool.name)).toContain('get_script_execution');
  });

  it('reports a task that holds no scripted execution', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Plain card', description: '' });
    const value = await read(f, { task_id: task.id });
    expect(value).toMatchObject({ taskId: task.id, available: false, execution: null });
  });

  it('keeps the stored phase when the host cannot run scripts', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Unavailable host', description: '' });
    await seedExecution(f, task.id);
    const value = await read(f, { task_id: task.id });
    expect(value.available).toBe(false);
    expect(value.execution.phase).toBe('result-ready');
    expect(value.execution.error).toBeUndefined();
  });

  it('reports the hold, the saved result, the destination, and the entry values', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Held result', description: '' });
    await seedExecution(f, task.id);
    const value = await read(f, { task_id: task.id });
    expect(value.execution).toMatchObject({
      phase: 'result-ready', attempt: 1, restartCount: 0, owned: true,
      declaredParameters: ['pipeline'], missingParameters: [], parameters: { pipeline: 'ci-main' },
      result: { exit: 'passed', message: 'CI passed', deliveryStatus: 'pending', destination: { columnId: 'in_review', stageName: 'In Review', resolved: true } },
      hold: { code: 'conversation-active' },
    });
    expect(value.execution.hold.action).toContain('turn ends');
    expect(value.history).toEqual([{ kind: 'execution', outcome: 'stopped', columnId: 'in_progress', at: AT }]);
  });

  it('reports a destination whose captured stage identity was replaced', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Stale destination', description: '' });
    await seedExecution(f, task.id, { destinationIdentity: 'stage-recreated', hold: false });
    const value = await read(f, { task_id: task.id });
    expect(value.execution.result.destination).toMatchObject({ columnId: 'in_review', resolved: false });
    expect(value.execution.hold).toBeUndefined();
  });

  it('reads without recording a history row, a revision, or a message', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Read only', description: '' });
    await seedExecution(f, task.id);
    const before = { revision: f.store.snapshot().revision, history: JSON.stringify(f.store.snapshot().tasks.find(value => value.id === task.id)!.history), sent: f.sessions.sent.length };
    await read(f, { task_id: task.id });
    const after = { revision: f.store.snapshot().revision, history: JSON.stringify(f.store.snapshot().tasks.find(value => value.id === task.id)!.history), sent: f.sessions.sent.length };
    expect(after).toEqual(before);
  });

  it('resolves the task from the conversation that owns it', async () => {
    const f = await setup();
    const task = await f.app.createTask({ projectId: f.project.id, title: 'Owned', description: '' });
    await seedExecution(f, task.id);
    const sessionId = 'owned-session';
    await f.store.transact(draft => { draft.tasks.find(value => value.id === task.id)!.sessionIds = [sessionId]; });
    const value = await read(f, {}, sessionId);
    expect(value.taskId).toBe(task.id);
  });
});
