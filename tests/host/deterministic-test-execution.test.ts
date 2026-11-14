import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeterministicRuntime } from '../../src/host/deterministic/index.js';
import type { DeterministicDefinition } from '../../src/shared/deterministic.js';
import type { TestProgramRequest } from '../../src/host/deterministic/ports.js';

let directory = '';
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'dsh-kanban-test-script-')); });
afterAll(async () => { if (directory.startsWith(path.join(tmpdir(), 'dsh-kanban-test-script-'))) await rm(directory, { recursive: true, force: true }); });

interface RunSpec { bindings: Array<{ global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }> }
/** A PTC runtime that invokes the program's own bindings, so the simulated shell is exercised. */
function fakeRuntime(command: string, answer: (facts: { exitCode: number }) => { exit: string; message: string }) {
  return {
    language: 'typescript', isolation: 'process', programFormat: 'function-body', retainsState: false, sandboxMode: undefined,
    resolve: (spec: unknown) => spec,
    run: async (spec: RunSpec) => {
      const tools = spec.bindings.find(binding => binding.global === 'tools')!;
      const facts = await tools.functions.bash!({ command }) as { exitCode: number };
      return { value: answer(facts), logs: ['program log'] };
    },
  };
}

const definition: DeterministicDefinition = { language: 'typescript', code: 'return 1', directory: 'task', params: [{ name: 'pipeline' }], exits: { passed: 'done', error: 'todo' } };
const request = (overrides: Partial<TestProgramRequest> = {}): TestProgramRequest => ({
  definition, code: 'return 1', input: { params: { pipeline: 'ci-main' } } as never,
  directory, responses: [{ match: 'ci', exitCode: 0, stdout: 'green' }], signal: new AbortController().signal,
  ...overrides,
});
function runtime(command: string, answer: (facts: { exitCode: number }) => { exit: string; message: string } = () => ({ exit: 'passed', message: 'done' })) {
  return createDeterministicRuntime({
    context: { ptcRuntime: fakeRuntime(command, answer) },
    privateDirectory: directory,
    policy: { directory: async value => value, source: async (_value, _directory) => ({ path: _value, code: '' }), execution: async () => ({ mode: 'danger-full-access', workspaceRoot: directory }) as never },
  });
}

describe('isolated script test execution', () => {
  it('resolves a declared answer, records the call, and parses the completion', async () => {
    const outcome = await runtime('ci status').test!(request());
    expect(outcome).toMatchObject({ kind: 'completed', completion: { exit: 'passed', message: 'done' }, calls: [{ command: 'ci status', matched: 'ci', exitCode: 0 }], diagnostics: ['program log'] });
  });

  it('reports a command no response covers without reaching a shell', async () => {
    const outcome = await runtime('deploy now').test!(request());
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'TEST_BASH_UNCOVERED' }, calls: [{ command: 'deploy now', matched: null }] });
  });

  it('falls back to the declared default answer', async () => {
    const outcome = await runtime('anything else').test!(request({ responses: [], defaultResponse: { match: '', exitCode: 2, stderr: 'boom' } }));
    expect(outcome).toMatchObject({ kind: 'completed', calls: [{ command: 'anything else', matched: '', exitCode: 2 }] });
  });

  it('rejects a completion whose exit the stage does not map', async () => {
    const outcome = await runtime('ci status', () => ({ exit: 'unknown', message: 'x' })).test!(request());
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'UNMAPPED_EXIT' } });
  });

  it('refuses a provider that is not a fresh isolated function-body runtime', async () => {
    const base = fakeRuntime('ci status', () => ({ exit: 'passed', message: 'done' }));
    const retained = { ...base, retainsState: true };
    const runtime = createDeterministicRuntime({
      context: { ptcRuntime: retained },
      privateDirectory: directory,
      policy: { directory: async value => value, source: async (_value, _directory) => ({ path: _value, code: '' }), execution: async () => ({ mode: 'danger-full-access', workspaceRoot: directory }) as never },
    });
    const outcome = await runtime.test!(request());
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'TYPESCRIPT_FORMAT_UNSUPPORTED' } });
  });

  it('refuses a Bash program, which is the shell script itself', async () => {
    const outcome = await runtime('ci status').test!(request({ definition: { ...definition, language: 'bash' } }));
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'TEST_LANGUAGE_UNSUPPORTED' } });
  });
});
