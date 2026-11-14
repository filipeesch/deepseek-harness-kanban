import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { fixture } from './helpers.js';
import type { DeterministicRuntime, TestProgramRequest } from '../../src/host/deterministic/ports.js';

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

async function run(f: F, name: string, args: Record<string, unknown>): Promise<any> {
  return named(f.tools, name).execute(args, execution());
}

const SCRIPTED = [
  'name: Scripted',
  'initial_column: todo',
  'columns:',
  '  - id: todo',
  '    label: Todo',
  '  - id: check',
  '    label: Check',
  '    deterministic:',
  '      language: typescript',
  '      code: |',
  '        return { exit: input.params.pipeline ? "passed" : "error", message: "checked" }',
  '      params:',
  '        - name: pipeline',
  '      exits: {passed: done, error: todo}',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

/** A deterministic runtime that answers the plan and the test without running code. */
function fakeRuntime(seen: TestProgramRequest[]): DeterministicRuntime {
  return {
    capture: vi.fn(async () => { throw new Error('capture must not run'); }),
    plan: vi.fn(async () => ({ content: { language: 'typescript', directory: 'task', executionDirectory: '/repos/project', source: { kind: 'inline' }, env: [], params: ['pipeline'], exits: {} } as any, code: 'return { exit: "passed", message: "checked" }', fingerprint: 'fp' })),
    loadCapture: vi.fn(async () => ''),
    normalizeCapture: vi.fn(async capture => capture),
    releaseCapture: vi.fn(),
    collectSources: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    reclaim: vi.fn(async () => {}),
    execute: vi.fn(async () => { throw new Error('a test must not run the real program'); }),
    test: vi.fn(async (request: TestProgramRequest) => {
      seen.push(request);
      return { kind: 'completed' as const, completion: { exit: 'passed', message: 'checked' }, calls: [{ command: 'ci status', matched: 'ci', exitCode: 0 }], diagnostics: [] };
    }),
    trust: { isApproved: async () => false, approve: vi.fn(async () => {}) },
    variables: { status: async () => [], set: async () => {}, remove: async () => {}, resolve: async () => ({}) },
  };
}

describe('validate_workflow', () => {
  it('reviews a document without a board and reports its digest and sizes', async () => {
    const f = await setup();
    const value = await run(f, 'validate_workflow', { yaml: SCRIPTED });
    expect(value.valid).toBe(true);
    expect(value.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(value.sizes).toEqual([
      { stage: 'check', sourceBytes: expect.any(Number) },
    ]);
  });

  it('reports a parse problem with its position and nothing else', async () => {
    const f = await setup();
    const value = await run(f, 'validate_workflow', { yaml: 'columns:\n  - id: [broken' });
    expect(value.valid).toBe(false);
    expect(value.problems[0].line).toBeGreaterThan(0);
    expect(value.warnings).toEqual([]);
  });

  it('reports the graph warnings the document would produce', async () => {
    const f = await setup();
    const value = await run(f, 'validate_workflow', { yaml: 'initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\n    allowed_transitions: []\n  - id: extra\n    label: Extra\n' });
    expect(value.warnings).toContainEqual({ kind: 'unreachable-stage', stage: 'extra' });
  });
});

describe('test_script', () => {
  it('runs the authored program with the supplied values and a simulated shell', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Scripted', workflow_yaml: SCRIPTED })).id;
    const seen: TestProgramRequest[] = [];
    const runtime = fakeRuntime(seen);
    f.app.attachDeterministicRuntime(runtime);
    const value = await run(f, 'test_script', {
      board_id: boardId, stage_id: 'check', params: { pipeline: 'ci-main' },
      responses: [{ match: 'ci', exit_code: 0, stdout: 'green' }],
    });
    expect(value.outcome).toMatchObject({ kind: 'completed', completion: { exit: 'passed' }, calls: [{ command: 'ci status', matched: 'ci' }] });
    expect(value.destination).toEqual({ columnId: 'done', stageName: 'Done' });
    expect(value.parameters).toEqual({ pipeline: 'ci-main' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.responses).toEqual([{ match: 'ci', exitCode: 0, stdout: 'green' }]);
    const input = seen[0]!.input as { params: Record<string, string>; task: { id: string } };
    expect(input.params).toEqual({ pipeline: 'ci-main' });
    expect(input.task.id).toBe('test');
    // A test run never captures a version and never asks for approval.
    expect(runtime.capture).not.toHaveBeenCalled();
    expect(runtime.trust.approve).not.toHaveBeenCalled();
  });

  it('accepts an omitted params argument for a stage that declares none', async () => {
    const f = await setup();
    const noParams = SCRIPTED.replace('      params:\n        - name: pipeline\n', '');
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'No params', workflow_yaml: noParams })).id;
    f.app.attachDeterministicRuntime(fakeRuntime([]));
    const value = await run(f, 'test_script', { board_id: boardId, stage_id: 'check' });
    expect(value.parameters).toEqual({});
    expect(value.outcome.kind).toBe('completed');
  });

  it('rejects a value the stage does not declare', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Scripted', workflow_yaml: SCRIPTED })).id;
    await expect(run(f, 'test_script', { board_id: boardId, stage_id: 'check', params: { other: 'x' } })).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
  });

  it('rejects a stage that authors no program', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Scripted', workflow_yaml: SCRIPTED })).id;
    await expect(run(f, 'test_script', { board_id: boardId, stage_id: 'todo', params: {} })).rejects.toMatchObject({ code: 'DETERMINISTIC_CONFIGURATION_REQUIRED' });
  });

  it('reports a host that cannot test a program', async () => {
    const f = await setup();
    const boardId = (await run(f, 'create_board', { hub_id: f.hub.id, name: 'Scripted', workflow_yaml: SCRIPTED })).id;
    await expect(run(f, 'test_script', { board_id: boardId, stage_id: 'check', params: { pipeline: 'x' } })).rejects.toMatchObject({ code: 'DETERMINISTIC_UNAVAILABLE' });
  });
});
