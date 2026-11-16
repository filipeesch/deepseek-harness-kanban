import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createScriptedRuntime, type ScriptedRuntime } from '../../src/host/scripted/index.js';
import { guardArtifact } from '../support/guard-artifact.js';

/**
 * The ordered program-output contract against a real host build.
 *
 * The released SDK still publishes the earlier per-call list, so the suites that
 * run it exercise the earlier branch. This lane resolves the whole provider graph
 * from an installed checkout, the same way `scripts/e2e-dsh.mjs --checkout` does,
 * and skips with an explicit message when no checkout is configured.
 */
const checkout = process.env.DSH_CHECKOUT;
const available = checkout !== undefined && checkout.length > 0;
if (!available) console.warn('[ordered-output] DSH_CHECKOUT is unset: skipping the real ordered-output lane. Point it at an installed and built DeepSeek Harness checkout to run it.');

/** The packages that publish the provider graph, in resolution order. */
async function load(root: string, name: string): Promise<any> {
  const roots = [join(root, 'apps/cli/package.json'), join(root, 'packages/ptc-runtime/ptc-runtime-node/package.json')];
  for (const from of roots) {
    try {
      const require = createRequire(from);
      return await import(pathToFileURL(require.resolve(name)).href);
    } catch { /* try the next resolution root */ }
  }
  throw new Error('Cannot resolve ' + name + ' from the checkout at ' + root);
}

const scope = { hubId: 'ordered-hub', boardId: 'ordered-board', projectId: 'ordered-project', stageIdentity: 'ordered-stage' };
const approvalScope = { hubId: scope.hubId, boardId: scope.boardId, stageIdentity: scope.stageIdentity };
const exits = { passed: { columnId: 'review', stageIdentity: 'review-key' } };
const definition = {
  language: 'typescript' as const,
  code: "console.log('ordered output'); return { exit: 'passed', message: 'ok' };",
  directory: 'project' as const,
  exits: { passed: 'review' },
};

let root: string;
let ctx: { fiber: { dispose: () => Promise<void> } } | undefined;
let runtime: ScriptedRuntime;
const report = vi.fn();

beforeAll(async () => {
  if (!available) return;
  root = await realpath(await mkdtemp(join(tmpdir(), 'kanban-ordered-output-')));
  await mkdir(join(root, 'project'));
  const { Context } = await load(checkout!, '@deepseek-ai/cordis');
  const NodeRuntime = (await load(checkout!, '@deepseek-ai/dsh-ptc-runtime-node')).default;
  const Subprocess = (await load(checkout!, '@deepseek-ai/dsh-subprocess-local')).default;
  const FileSystem = (await load(checkout!, '@deepseek-ai/dsh-fs-local')).default;
  const Sandbox = (await load(checkout!, '@deepseek-ai/dsh-sandbox-local')).default;
  const SandboxPolicy = (await load(checkout!, '@deepseek-ai/dsh-sandbox-policy')).default;
  const Sessions = (await load(checkout!, '@deepseek-ai/dsh-session')).default;
  const Projections = (await load(checkout!, '@deepseek-ai/dsh-session-projection')).default;
  const { LocalBashExecutor } = await load(checkout!, '@deepseek-ai/dsh-bash-local');
  const context = new Context();
  ctx = context;
  await context.plugin(Subprocess);
  await context.plugin(Sessions);
  await context.plugin(FileSystem);
  await context.plugin(Sandbox, {});
  await context.plugin(Projections);
  await context.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root });
  await context.plugin(NodeRuntime, { timeoutMs: 1, maxTimeoutMs: 600_000, graceMs: 50 });
  await context.plugin(LocalBashExecutor, { cwd: root, timeoutMs: 1, maxTimeoutMs: 600_000, graceMs: 50, maxOutputBytes: 1_000_000 });
  runtime = createScriptedRuntime({ context, privateDirectory: join(root, 'private'), guardPath: await guardArtifact(), report });
});

afterAll(async () => {
  if (ctx !== undefined) await ctx.fiber.dispose();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe.skipIf(!available)('ordered program output against a real host build', () => {
  it('settles a program that returns as completed and reports its ordered text', async () => {
    const capture = await runtime.capture({ definition, projectDirectory: join(root, 'project'), exits });
    await runtime.trust.approve(approvalScope, capture.fingerprint, 'review');
    const outcome = await runtime.execute({ executionId: 'ordered-execution', taskId: 'task', capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    expect(outcome).toMatchObject({ kind: 'completed', completion: { exit: 'passed', message: 'ok' } });
    if (outcome.kind === 'completed') expect(outcome.diagnostics.join('\n')).toContain('ordered output');
    // The earlier-contract report never fires: the host published ordered entries.
    expect(report).not.toHaveBeenCalled();
  });

  it('reports the same ordered text for an isolated test execution', async () => {
    const outcome = await runtime.test!({ definition, code: definition.code, input: {}, directory: join(root, 'project'), responses: [], signal: new AbortController().signal });
    expect(outcome).toMatchObject({ kind: 'completed', calls: [] });
    if (outcome.kind === 'completed') expect(outcome.diagnostics.join('\n')).toContain('ordered output');
  });
});
