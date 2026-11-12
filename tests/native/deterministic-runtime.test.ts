import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import NodeRuntime from '@deepseek-ai/dsh-ptc-runtime-node';
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local';
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import Sandbox from '@deepseek-ai/dsh-sandbox-local';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeterministicRuntime, type DeterministicRuntime } from '../../src/host/deterministic/index.js';

let root: string;
let ctx: Context;
let runtime: DeterministicRuntime;
let originalEnvironment: { HOME?: string; DSH_HOME?: string };
const scope = { hubId: 'synthetic-hub', boardId: 'synthetic-board', projectId: 'synthetic-project', stageIdentity: 'synthetic-stage' };
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'kanban-native-runtime-')));
  originalEnvironment = { HOME: process.env.HOME, DSH_HOME: process.env.DSH_HOME };
  await mkdir(join(root, 'home')); process.env.HOME = join(root, 'home'); process.env.DSH_HOME = join(root, 'home', '.dsh');
  ctx = new Context();
  await ctx.plugin(LocalSubprocessRuntime);
  await ctx.plugin(Sessions);
  await ctx.plugin(FileSystem);
  await ctx.plugin(Sandbox, {});
  await ctx.plugin(Projections);
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root });
  await ctx.plugin(NodeRuntime, { timeoutMs: 1, maxTimeoutMs: 600000, graceMs: 50 });
  await ctx.plugin(LocalBashExecutor, { cwd: root, timeoutMs: 1, maxTimeoutMs: 600000, graceMs: 50, maxOutputBytes: 1 });
  runtime = createDeterministicRuntime({ context: ctx, privateDirectory: join(root, 'private') });
});
afterEach(async () => {
  try { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
  finally {
    for (const name of ['HOME', 'DSH_HOME'] as const) {
      if (originalEnvironment[name] === undefined) delete process.env[name]; else process.env[name] = originalEnvironment[name];
    }
  }
});
async function run(language: 'bash' | 'typescript', code: string, signal = new AbortController().signal) {
  const capture = await runtime.capture({ definition: { language, code, directory: 'project', exits: { passed: 'review' } }, projectDirectory: root, exits: { passed: { columnId: 'review', stageIdentity: 'stable-review' } } });
  await runtime.trust.approve(scope, capture.fingerprint);
  const outcome = await runtime.execute({ executionId: 'run-' + capture.sourceRef, taskId: 'task', capture, input: { title: 'untrusted $(no-execution)', startedAt: '2020-01-01T00:00:00Z' }, scope, signal });
  if (outcome.kind === 'failed') throw new Error(JSON.stringify(outcome.diagnostic));
  return outcome;
}
describe('actual native deterministic ABI without profiles or models', () => {
  it('runs a long-lived standalone Bash loop beyond a one millisecond provider default', async () => {
    expect(await run('bash', "for value in 1 2 3; do sleep 0.01; done; printf '{\"exit\":\"passed\",\"message\":\"Bash finished\"}\\n'")).toMatchObject({ kind: 'completed', completion: { message: 'Bash finished' } });
  });
  it('uses a fresh function body, top-level await/return, and handles nested nonzero exit facts', async () => {
    const result = await run('typescript', 'const process = (await import("node:process")).default; if (!process.pid) throw new Error("missing pid"); const facts = await tools.bash({ command: "sleep 0.02; exit 7" }); if (facts.exitCode !== 7) throw new Error("wrong status"); await new Promise(resolve => setTimeout(resolve, 10)); return { exit: "passed", message: input.title };');
    expect(result).toMatchObject({ kind: 'completed', completion: { exit: 'passed', message: 'untrusted $(no-execution)' } });
  });
  it('aborts and drains unawaited Bash when a function returns', async () => {
    expect(await run('typescript', 'void tools.bash({ command: "sleep 10000" }); return { exit: "passed", message: "done" };')).toMatchObject({ kind: 'completed' });
  });
  it('returns nested deadline facts without failing the TypeScript program', async () => {
    expect(await run('typescript', 'const facts = await tools.bash({ command: "sleep 10000", timeoutMs: 150 }); if (!facts.timedOut) throw new Error("deadline was not a kill"); return { exit: "passed", message: "handled timeout" };')).toMatchObject({ kind: 'completed' });
  });
  it('keeps raw stderr out of provider spill files even with a one-byte provider cap', async () => {
    const results: Array<{ stdout: { spillPath?: string }; stderr: { spillPath?: string } }> = [];
    const original = ctx.shell.execute.bind(ctx.shell);
    const spy = vi.spyOn(ctx.shell, 'execute').mockImplementation(async spec => {
      const handle = await original(spec); const result = handle.result.bind(handle);
      handle.result = async () => { const output = await result(); results.push(output); return output; };
      return handle;
    });
    try {
      const result = await run('bash', `printf synthetic-secret-to-stderr >&2; printf '%s\\n' '{"exit":"passed","message":"done"}'`);
      expect(result.kind).toBe('completed'); expect(results).toHaveLength(1);
      expect(results[0]!.stdout.spillPath).toBeUndefined(); expect(results[0]!.stderr.spillPath).toBeUndefined();
    } finally { spy.mockRestore(); }
  });
  it('bounds shell output inside the guarded process before native spill collection', async () => {
    const capture = await runtime.capture({ definition: { language: 'bash', code: 'yes synthetic-secret | head -c 100000', directory: 'project', exits: { passed: 'review' } }, projectDirectory: root, exits: { passed: { columnId: 'review', stageIdentity: 'stable-review' } } });
    await runtime.trust.approve(scope, capture.fingerprint);
    const outcome = await runtime.execute({ executionId: 'overflow-test', taskId: 'task', capture, input: {}, scope, signal: new AbortController().signal });
    expect(outcome.kind).toBe('failed');
    // The provider's test-owned temporary directory must not contain a raw spill.
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(root)).filter(name => name.startsWith('dsh-subprocess-'))).toEqual([]);
  });
  it('cancels a standalone Bash tree during explicit Stop or orderly shutdown', async () => {
    const controller = new AbortController();
    const result = run('bash', 'sleep 10000 & wait', controller.signal);
    const timer = setTimeout(() => controller.abort(), 250);
    try { expect(await result).toEqual({ kind: 'aborted' }); } finally { clearTimeout(timer); }
  });
  it('drains a TypeScript loop while a nested Bash command is sleeping', async () => {
    const controller = new AbortController();
    const work = run('typescript', 'while (true) await tools.bash({command:"sleep 2"});', controller.signal);
    await new Promise(resolve => setTimeout(resolve, 500)); controller.abort();
    expect(await work).toMatchObject({ kind: 'aborted' });
  });

  it('passes declared parameter values to both languages as structured data', async () => {
    const exits = { passed: { columnId: 'review', stageIdentity: 'stable-review' } };
    const typescript = await runtime.capture({ definition: { language: 'typescript', code: 'return { exit: "passed", message: input.params.pipeline + ":" + input.params.app };', directory: 'project', params: [{ name: 'pipeline' }, { name: 'app' }], exits: { passed: 'review' } }, projectDirectory: root, exits });
    await runtime.trust.approve(scope, typescript.fingerprint);
    expect(await runtime.execute({ executionId: 'params-typescript', taskId: 'task', capture: typescript, input: { params: { pipeline: 'ci-main', app: 'checkout $(no-exec)' } }, scope, signal: new AbortController().signal }))
      .toMatchObject({ kind: 'completed', completion: { message: 'ci-main:checkout $(no-exec)' } });
    const bashCode = `node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=JSON.parse(s);process.stdout.write(JSON.stringify({exit:"passed",message:i.params.app}))})'`;
    const bash = await runtime.capture({ definition: { language: 'bash', code: bashCode, directory: 'project', params: [{ name: 'app' }], exits: { passed: 'review' } }, projectDirectory: root, exits });
    await runtime.trust.approve(scope, bash.fingerprint);
    expect(await runtime.execute({ executionId: 'params-bash', taskId: 'task', capture: bash, input: { params: { app: 'checkout' } }, scope, signal: new AbortController().signal }))
      .toMatchObject({ kind: 'completed', completion: { message: 'checkout' } });
  });

  it('hard-aborts an active native TypeScript busy loop', async () => {
    const controller = new AbortController();
    const result = run('typescript', 'while (true) {}', controller.signal);
    const timer = setTimeout(() => controller.abort(), 250);
    try { expect(await result).toEqual({ kind: 'aborted' }); } finally { clearTimeout(timer); }
  });
});
