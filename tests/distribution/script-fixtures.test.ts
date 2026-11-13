import { readFile, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import Sandbox from '@deepseek-ai/dsh-sandbox-local';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
import NodeRuntime from '@deepseek-ai/dsh-ptc-runtime-node';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createDeterministicRuntime } from '../../src/host/deterministic/index.js';
import { guardArtifact } from '../support/guard-artifact.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const fixture = fileURLToPath(new URL('../e2e-dsh/deterministic/', import.meta.url));
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'kanban-doc-fixture-'));
  const ctx = new Context();
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  await ctx.plugin(Sessions); await ctx.plugin(FileSystem); await ctx.plugin(Subprocess);
  await ctx.plugin(Sandbox, {}); await ctx.plugin(Projections);
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root });
  await ctx.plugin(LocalBashExecutor, { cwd: root, timeoutMs: 1, maxTimeoutMs: 600000, graceMs: 50 });
  await ctx.plugin(NodeRuntime, {});
  await copyFile(join(fixture, 'fake-ci.cjs'), join(root, 'fake-ci.cjs'));
  return { root, runtime: createDeterministicRuntime({ context: ctx, privateDirectory: join(root, 'private'), guardPath: await guardArtifact() }) };
}

describe('documented deterministic examples', () => {
  it('keeps the TypeScript example byte-identical to its executable fixture', async () => {
    const guide = await readFile(new URL('../../docs/deterministic-steps.md', import.meta.url), 'utf8');
    const script = await readFile(join(fixture, 'wait-ci.ts'), 'utf8');
    expect(guide).toContain(script.trimEnd());
    const workflow = parseWorkflow(await readFile(join(fixture, 'workflow.yaml'), 'utf8'));
    expect(workflow.columns[0]!.deterministic).toMatchObject({ language: 'typescript', file: 'wait-ci.ts', exits: { passed: 'review', rejected: 'fix', error: 'repair' } });
  });

  it.each(['bash', 'typescript'] as const)('executes the actual %s example through public native providers', async language => {
    const { root, runtime } = await setup();
    const file = language === 'bash' ? 'wait-ci.sh' : 'wait-ci.ts';
    await copyFile(join(fixture, file), join(root, file));
    const scope = { hubId: 'fixture-hub', boardId: 'fixture-board', projectId: 'fixture-project', stageIdentity: 'fixture-stage' };
    const approvalScope = { hubId: scope.hubId, boardId: scope.boardId, stageIdentity: scope.stageIdentity };
    const exits = { passed: { columnId: 'review', stageIdentity: 'review-key' }, rejected: { columnId: 'fix', stageIdentity: 'fix-key' }, error: { columnId: 'repair', stageIdentity: 'repair-key' } };
    const capture = await runtime.capture({ definition: { language, file, directory: 'task', params: [{ name: 'pipeline' }], exits: { passed: 'review', rejected: 'fix', error: 'repair' } },
      exits, projectDirectory: root, taskDirectory: root });
    await runtime.trust.approve(approvalScope, capture.fingerprint);
    for (const state of ['passed', 'rejected']) {
      await writeFile(join(root, '.fake-ci-state'), state);
      const result = await runtime.execute({ executionId: language + '-' + state, taskId: language, scope, approvalScope, capture,
        input: { startedAt: new Date().toISOString(), params: { pipeline: 'local-ci' } }, signal: new AbortController().signal });
      expect(result).toMatchObject({ kind: 'completed', completion: { exit: state, message: state === 'passed' ? 'Local CI passed.' : 'Local CI rejected the change.' } });
    }
    await writeFile(join(root, '.fake-ci-state'), 'broken');
    const failed = await runtime.execute({ executionId: language + '-broken', taskId: language, scope, approvalScope, capture,
      input: { startedAt: new Date().toISOString(), params: { pipeline: 'local-ci' } }, signal: new AbortController().signal });
    expect(failed.kind).toBe('failed');
  });
});
