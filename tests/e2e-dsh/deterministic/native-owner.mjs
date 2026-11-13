// A test-owned, keyless native provider host. Never load a profile or model.
import { Context } from '@deepseek-ai/cordis';
import NodeRuntime from '@deepseek-ai/dsh-ptc-runtime-node';
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local';
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import Sandbox from '@deepseek-ai/dsh-sandbox-local';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDeterministicRuntime } from '../../../src/host/deterministic/index.ts';

const [kind, directory, action] = process.argv.slice(2);
const ctx = new Context();
await ctx.plugin(LocalSubprocessRuntime);
if (kind.startsWith('guarded-')) {
  await ctx.plugin(Sessions); await ctx.plugin(FileSystem); await ctx.plugin(Sandbox, {}); await ctx.plugin(Projections);
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: directory });
  await ctx.plugin(LocalBashExecutor, { cwd: directory, timeoutMs: 1, maxTimeoutMs: 600000, graceMs: 50 });
  await ctx.plugin(NodeRuntime, {});
  const language = ['guarded-bash', 'guarded-bash-detached'].includes(kind) ? 'bash' : 'typescript';
  const bashDetached = `node -e 'const cp=require("node:child_process");const fs=require("node:fs");const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});child.unref();fs.writeFileSync("detached-pid",String(child.pid));'; child=$(<detached-pid); printf '{"ready":true,"pid":%s,"descendants":[%s],"marker":"%s"}\n' "$$" "$child" "$DSH_DETERMINISTIC_RUN" > worker-ready.json; sleep 60`;
  const code = kind === 'guarded-bash-detached' ? bashDetached : language === 'bash' ? "sleep 60 & child=$!; printf '{\"ready\":true,\"pid\":%s,\"descendants\":[%s],\"marker\":\"%s\"}\\n' \"$$\" \"$child\" \"$DSH_DETERMINISTIC_RUN\" > worker-ready.json; wait \"$child\"" : [
    'const process = (await import("node:process")).default;',
    'const fs = await import("node:fs/promises");',
    ...(['guarded-node-child', 'guarded-detached-child'].includes(kind) ? ['const cp = await import("node:child_process"); const child = cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore", detached:' + (kind === 'guarded-detached-child') + '});'] : []),
    ['guarded-node-child', 'guarded-detached-child'].includes(kind) ? 'await fs.writeFile("worker-ready.json", JSON.stringify({ready:true,pid:process.pid,descendants:[child.pid]}));' : 'await fs.writeFile("worker-ready.json", JSON.stringify({ready:true,pid:process.pid}));',
    ...(kind === 'guarded-nested' ? ['void tools.bash({command:' + JSON.stringify('sleep 60 & child=$!; printf \'{"pid":%s,"child":%s}\\n\' "$$" "$child" > bash-ready.json; wait "$child"') + '});'] : []),
    kind === 'guarded-busy' ? 'while (true) {}' : 'while (true) await new Promise(resolve => setTimeout(resolve, 100));',
  ].join('\n');
  const runtime = createDeterministicRuntime({ context: ctx, privateDirectory: join(directory, 'private') });
  const capture = await runtime.capture({ definition: { language, code, directory: 'task', exits: { passed: 'done' } },
    projectDirectory: directory, taskDirectory: directory, exits: { passed: { columnId: 'done', stageIdentity: 'done-key' } } });
  const scope = { hubId: 'test-hub', boardId: 'test-board', projectId: 'test-project', stageIdentity: 'test-stage' };
  const approvalScope = { hubId: scope.hubId, boardId: scope.boardId, stageIdentity: scope.stageIdentity };
  await runtime.trust.approve(approvalScope, capture.fingerprint);
  const timer = setInterval(() => {
    try { const value = JSON.parse(readFileSync(join(directory, 'worker-ready.json'), 'utf8')); if (kind === 'guarded-nested') { const nested = JSON.parse(readFileSync(join(directory, 'bash-ready.json'), 'utf8')); value.descendants = [nested.pid, nested.child]; } clearInterval(timer); process.stdout.write(JSON.stringify(value) + '\n'); } catch { /* Source has not reached readiness. */ }
  }, 10);
  const cancellation = new AbortController();
  if (action === 'stop') process.once('SIGUSR2', () => cancellation.abort());
  const result = await runtime.execute({ executionId: 'test-execution', taskId: 'test-task', capture, scope, approvalScope,
    input: { startedAt: new Date().toISOString() }, signal: cancellation.signal });
  clearInterval(timer); process.stderr.write(JSON.stringify(result) + '\n');
  if (action === 'stop' && result.kind !== 'aborted') process.exitCode = 1;
} else if (kind === 'bash') {
  await ctx.plugin(LocalBashExecutor, { cwd: directory, timeoutMs: 1, maxTimeoutMs: 600000, graceMs: 50 });
  const handle = await ctx.shell.execute(ctx.shell.resolve({
    command: "printf '{\"ready\":true,\"pid\":%s}\\n' \"$$\"; while :; do sleep 1; done",
    workdir: directory, onExpiry: 'none', stdoutMaxBytes: 4096,
  }));
  const timer = setInterval(() => {
    const delta = handle.readOutput().delta;
    if (delta) process.stdout.write(delta);
  }, 10);
  await handle.result();
  clearInterval(timer);
} else {
  await ctx.plugin(Sessions);
  await ctx.plugin(FileSystem);
  await ctx.plugin(Sandbox, {});
  await ctx.plugin(Projections);
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: directory });
  await ctx.plugin(NodeRuntime, {});
  const program = [
    'const process = (await import("node:process")).default;',
    'await witness.started({ready:true,pid:process.pid});',
    kind === 'busy' ? 'while (true) {}' : 'while (true) await new Promise(resolve => setTimeout(resolve, 100));',
  ].join('\n');
  const result = await ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({
    program, cwd: directory, timeoutMs: null,
    bindings: [{ global: 'witness', functions: { started: async value => { process.stdout.write(JSON.stringify(value) + '\n'); return null; } } }],
  }));
  process.stderr.write(JSON.stringify(result) + '\n');
}
await ctx.fiber.dispose();
