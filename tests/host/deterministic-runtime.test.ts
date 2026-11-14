import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials';
import type { PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime';
import type { ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell';
import type { CredentialStore } from '../../src/host/sharing/credentials.js';
import { createDeterministicRuntime, type DeterministicPolicyPort, type NativePtcPort, type NativeShellPort } from '../../src/host/deterministic/index.js';
import { createBashRetry } from '../../src/host/deterministic/retry.js';
import { executeCapturedProgram } from '../../src/host/deterministic/executor.js';
import type { NativeLifetime } from '../../src/host/deterministic/lifetime.js';
import type { ExecutionOutcome, ExecuteRequest } from '../../src/host/deterministic/ports.js';
import type { DeterministicCapture } from '../../src/shared/deterministic.js';
import { NativeExecutionOwnership } from '../../src/host/deterministic/ownership.js';
import { createNativeDeterministicPolicy } from '../../src/host/deterministic/native-policy.js';
import { createServer } from 'node:net';
import { askWitness, createNativeLifetime } from '../../src/host/deterministic/lifetime.js';
import { SecretRedactor, parseCompletion } from '../../src/host/deterministic/safety.js';
import { ownedProcesses } from '../../src/host/deterministic/process/index.js';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const scope = { hubId: 'local-hub', boardId: 'board-a', projectId: 'project-a', stageIdentity: 'stable-stage-a' };
const approvalScope = { hubId: scope.hubId, boardId: scope.boardId, stageIdentity: scope.stageIdentity };
const exits = { passed: { columnId: 'review', stageIdentity: 'stable-review' } };
function credentials() {
  const records = new Map<string, CredentialRecord>();
  const store: CredentialStore = {
    async readRecord(key) { return records.get(key); },
    describeRecord: vi.fn(async key => ({ configured: records.has(key), writable: true })),
    async modifyRecord(key, mutate) { const value = await mutate(records.get(key)); if (value) records.set(key, value); return value; },
    async deleteRecord(key) { records.delete(key); },
  };
  return { store, records };
}
function shellResult(patch: Partial<ShellRunResult> = {}): ShellRunResult {
  return { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 10, stdout: { text: '{"exit":"passed","message":"ready"}', truncated: false }, stderr: { text: '', truncated: false }, ...patch };
}
function shell(run = async (_spec: ShellExecSpec) => shellResult()): NativeShellPort {
  return {
    sandboxMode: undefined,
    resolve: vi.fn(request => ({ ...request, command: request.command, workdir: request.workdir!, timeoutMs: request.timeoutMs ?? 10, onExpiry: request.onExpiry ?? 'kill', stdoutMaxBytes: request.stdoutMaxBytes ?? 1024, sandboxPolicy: request.sandboxPolicy })),
    execute: vi.fn(async spec => {
      const result = run(spec).then(value => value.aborted || value.timedOut ? value : { ...value, stdout: { text: JSON.stringify({ stdout: value.stdout.text, stderr: value.stderr.text, overflow: Buffer.byteLength(value.stdout.text) > 32000 || Buffer.byteLength(value.stderr.text) > 3000 }), truncated: value.stdout.truncated || value.stderr.truncated }, stderr: { text: '', truncated: false } });
      return { status: 'running' as const, exitCode: null, signal: null, done: result.then(() => {}, () => {}), observed: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } }, readOutput: () => ({ delta: '', lossy: false }), kill: vi.fn(() => true), result: () => result };
    }),
  };
}
function ptc(run: (spec: PtcRunSpec) => Promise<PtcRunResult>): NativePtcPort {
  return { language: 'typescript', isolation: 'process', programFormat: 'function-body', retainsState: false, sandboxMode: undefined, resolve: vi.fn(request => ({ ...request, cwd: request.cwd!, timeoutMs: request.timeoutMs ?? null })), run: vi.fn(run) };
}
/** A shell whose result is returned untouched, for guard-failure cases. */
function rawShell(run: () => ShellRunResult | Promise<ShellRunResult>): NativeShellPort {
  return {
    sandboxMode: undefined,
    resolve: vi.fn(request => ({ ...request, timeoutMs: request.timeoutMs ?? 10, onExpiry: request.onExpiry ?? 'kill', stdoutMaxBytes: request.stdoutMaxBytes ?? 1024, sandboxPolicy: request.sandboxPolicy })),
    execute: vi.fn(async () => {
      const result = Promise.resolve().then(run);
      return { status: 'running' as const, exitCode: null, signal: null, done: result.then(() => {}, () => {}), observed: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } }, readOutput: () => ({ delta: '', lossy: false }), kill: vi.fn(() => true), result: () => result };
    }),
  };
}
/** A guard that stopped reporting without a result envelope. */
function guardFailure(patch: Partial<ShellRunResult> = {}): ShellRunResult {
  return shellResult({ exitCode: 125, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false }, ...patch });
}
/** A decoded guard result: the envelope the guard writes around the command's own output. */
function envelope(stdout: string, stderr = ''): ShellRunResult {
  return shellResult({ stdout: { text: JSON.stringify({ stdout, stderr, overflow: false }), truncated: false }, stderr: { text: '', truncated: false } });
}
async function fixture(options: { shell?: NativeShellPort; ptc?: NativePtcPort; retry?: { attempts?: number; delaysMs?: readonly number[] } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kanban-runtime-')); roots.push(root);
  const project = join(root, 'project'); const task = join(root, 'task'); await mkdir(project); await mkdir(task);
  const policy: DeterministicPolicyPort = {
    directory: path => realpath(path),
    source: async (path, directory) => ({ path: await realpath(resolve(directory, path)), code: await readFile(resolve(directory, path), 'utf8') }),
    execution: async directory => ({ mode: 'danger-full-access', workspaceRoot: directory }),
  };
  const credential = credentials();
  const context = { credentials: credential.store, shell: options.shell ?? shell(), ptcRuntime: options.ptc };
  const runtime = createDeterministicRuntime({ context, privateDirectory: join(root, 'private'), policy, ...(options.retry === undefined ? {} : { retry: options.retry }) });
  const capture = (language: 'bash' | 'typescript' = 'bash', changes: Record<string, unknown> = {}) => runtime.capture({ definition: { language, code: 'return {exit:"passed",message:"ready"};', directory: 'task', exits: { passed: 'review' }, ...changes }, projectDirectory: project, taskDirectory: task, exits });
  return { root, project, task, policy, runtime, capture, context, credential };
}
async function binding(spec: PtcRunSpec, namespace: string, name: string, args: unknown = null) { return spec.bindings.find(item => item.global === namespace)!.functions[name]!(args); }
describe('deterministic immutable source and scoped local authority', () => {
  it('captures canonical files and recovers reviewed bytes after edits without rereading source', async () => {
    const f = await fixture(); await writeFile(join(f.task, 'wait.ts'), 'return {exit:"passed",message:"old"};\r\n');
    const capture = await f.capture('typescript', { code: undefined, file: 'wait.ts' });
    expect(capture.executionDirectory).toBe(await realpath(f.task)); expect(capture.source.path).toBe(await realpath(join(f.task, 'wait.ts')));
    await writeFile(join(f.task, 'wait.ts'), 'throw new Error("changed");');
    expect(await f.runtime.loadCapture(capture)).toContain('message:"old"');
    const changed = await f.capture('typescript', { code: undefined, file: 'wait.ts' }); expect(changed.fingerprint).not.toBe(capture.fingerprint);
    const project = await f.capture('bash', { directory: 'project' }); expect(project.executionDirectory).toBe(await realpath(f.project));
    await expect(f.runtime.loadCapture({ ...capture, env: ['NEW_TOKEN'] })).rejects.toMatchObject({ code: 'CAPTURE_CORRUPT' });
    await rm(join(f.root, 'private', 'sources', capture.sourceRef + '.json')); await expect(f.runtime.loadCapture(capture)).rejects.toMatchObject({ code: 'CAPTURE_MISSING' });
  });
  it('shares one version for identical relative primary files in different task directories', async () => {
    const f = await fixture();
    const other = join(f.root, 'other-task'); await mkdir(other);
    await writeFile(join(f.task, 'wait.sh'), 'echo same');
    await writeFile(join(other, 'wait.sh'), 'echo same');
    const definition = { language: 'bash' as const, code: undefined, file: 'wait.sh', directory: 'task' as const, exits: { passed: 'review' } };
    const first = await f.runtime.capture({ definition, projectDirectory: f.project, taskDirectory: f.task, exits });
    const second = await f.runtime.capture({ definition, projectDirectory: f.project, taskDirectory: other, exits });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.source.reference).toBe('wait.sh');
    expect(first.source.path).toBe(await realpath(join(f.task, 'wait.sh')));
    expect(first.executionDirectory).not.toBe(second.executionDirectory);
  });
  it('creates distinct versions for different relative primary bytes', async () => {
    const f = await fixture();
    const other = join(f.root, 'other-task'); await mkdir(other);
    await writeFile(join(f.task, 'wait.sh'), 'echo first');
    await writeFile(join(other, 'wait.sh'), 'echo second');
    const definition = { language: 'bash' as const, code: undefined, file: 'wait.sh', directory: 'task' as const, exits: { passed: 'review' } };
    const first = await f.runtime.capture({ definition, projectDirectory: f.project, taskDirectory: f.task, exits });
    const second = await f.runtime.capture({ definition, projectDirectory: f.project, taskDirectory: other, exits });
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(first.source.reference).toBe('wait.sh');
    expect(second.source.reference).toBe('wait.sh');
  });
  it('captures absolute references and does not reread a deleted primary file', async () => {
    const f = await fixture(); const source = join(f.project, 'absolute.sh'); await writeFile(source, 'printf original');
    const capture = await f.capture('bash', { code: undefined, file: source, directory: 'project' });
    expect(capture.source).toEqual({ kind: 'file', path: await realpath(source), reference: source });
    await rm(source); expect(await f.runtime.loadCapture(capture)).toBe('printf original');
    await expect(f.capture('bash', { code: undefined, file: source, directory: 'project' })).rejects.toThrow();
    await writeFile(join(f.root, 'private', 'sources', capture.sourceRef + '.json'), '{corrupt');
    await expect(f.runtime.loadCapture(capture)).rejects.toMatchObject({ code: 'CAPTURE_CORRUPT' });
  });
  it('keeps shared source pins independent until every capture admission settles', async () => {
    const f = await fixture(); const a = await f.capture(); const b = await f.capture(); expect(a.sourceRef).toBe(b.sourceRef);
    f.runtime.releaseSource?.(a.sourceRef); await f.runtime.collectSources([]); expect(await f.runtime.loadCapture(b)).toContain('return');
    f.runtime.releaseSource?.(b.sourceRef); await f.runtime.collectSources([]);
    await expect(f.runtime.loadCapture(b)).rejects.toMatchObject({ code: 'CAPTURE_MISSING' });
  });
  it('binds approval to the exact fingerprint and board/stage scope, never saves implicitly', async () => {
    const f = await fixture(); const capture = await f.capture();
    expect(await f.runtime.trust.isApproved(approvalScope, capture.fingerprint)).toBe(false);
    await f.runtime.trust.approve(approvalScope, capture.fingerprint); expect(await f.runtime.trust.isApproved(approvalScope, capture.fingerprint)).toBe(true);
    expect(await f.runtime.trust.isApproved({ ...approvalScope, boardId: 'other-board' }, capture.fingerprint)).toBe(false);
    expect(await f.runtime.trust.isApproved({ ...approvalScope, stageIdentity: 'reused-name-new-stage' }, capture.fingerprint)).toBe(false);
    // The same executable version in another task directory shares the approval.
    const other = join(f.root, 'other-task'); await mkdir(other);
    const shared = await f.runtime.capture({ definition: { language: 'bash', code: 'return {exit:"passed",message:"ready"};', directory: 'task', exits: { passed: 'review' } }, projectDirectory: f.project, taskDirectory: other, exits });
    expect(shared.executionDirectory).toBe(await realpath(other)); expect(shared.fingerprint).toBe(capture.fingerprint);
    expect(await f.runtime.trust.isApproved(approvalScope, shared.fingerprint)).toBe(true);
    const expanded = await f.capture('bash', { env: ['CI_TOKEN'] }); expect(await f.runtime.trust.isApproved(approvalScope, expanded.fingerprint)).toBe(false);
  });
  it('changes reviewed fingerprints for language, source provenance, directory, and routes', async () => {
    const f = await fixture(); const baseline = await f.capture('bash'); await f.runtime.trust.approve(approvalScope, baseline.fingerprint);
    const code = 'return {exit:"passed",message:"ready"};'; await writeFile(join(f.task, 'same-code.sh'), code);
    const variants = [await f.capture('typescript'), await f.capture('bash', { directory: 'project' }), await f.capture('bash', { code: undefined, file: 'same-code.sh' }),
      await f.runtime.capture({ definition: { language: 'bash', code, directory: 'task', exits: { passed: 'other' } }, projectDirectory: f.project, taskDirectory: f.task, exits: { passed: { columnId: 'other', stageIdentity: 'other-key' } } })];
    for (const variant of variants) { expect(variant.fingerprint).not.toBe(baseline.fingerprint); expect(await f.runtime.trust.isApproved(approvalScope, variant.fingerprint)).toBe(false); }
    expect((await f.capture()).fingerprint).toBe(baseline.fingerprint);
  });
  it('isolates native credential records and exposes masked status only', async () => {
    const f = await fixture(); await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-a');
    expect(await f.runtime.variables.status(scope, ['CI_TOKEN'])).toEqual([{ name: 'CI_TOKEN', configured: true }]);
    expect(await f.runtime.variables.status({ ...scope, projectId: 'other' }, ['CI_TOKEN'])).toEqual([{ name: 'CI_TOKEN', configured: false }]);
    expect(await f.runtime.variables.status({ ...scope, boardId: 'other-board' }, ['CI_TOKEN'])).toEqual([{ name: 'CI_TOKEN', configured: false }]);
    expect(await f.runtime.variables.status({ ...scope, stageIdentity: 'other' }, ['CI_TOKEN'])).toEqual([{ name: 'CI_TOKEN', configured: false }]);
    expect(await f.runtime.variables.resolve(scope, ['CI_TOKEN'])).toEqual({ CI_TOKEN: 'synthetic-a' });
    await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-b'); expect(await f.runtime.variables.resolve(scope, ['CI_TOKEN'])).toEqual({ CI_TOKEN: 'synthetic-b' });
    await f.runtime.variables.remove(scope, 'CI_TOKEN'); await expect(f.runtime.variables.resolve(scope, ['CI_TOKEN'])).rejects.toMatchObject({ code: 'VARIABLE_MISSING' });
    await expect(f.runtime.variables.set(scope, 'DSH_SECRET', 'bad')).rejects.toMatchObject({ code: 'INVALID_VARIABLE' });
  });
});
describe('public native execution boundary', () => {
  it('runs standalone Bash without outer deadline and passes untrusted task text through stdin only', async () => {
    const native = shell(); const f = await fixture({ shell: native }); const capture = await f.capture(); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const text = '$(not-a-command); untrusted text'; const result = await f.runtime.execute({ capture, input: { title: text }, scope, approvalScope, signal: new AbortController().signal });
    expect(result).toMatchObject({ kind: 'completed', completion: { exit: 'passed', message: 'ready' } });
    const spec = vi.mocked(native.execute).mock.calls[0]![0]; expect(spec.onExpiry).toBe('none'); expect(spec.stdin).toBe(JSON.stringify({ title: text })); expect(spec.command).not.toContain(text); expect(spec.env).toEqual({});
  });
  it.each([
    shellResult({ exitCode: 1 }),
    shellResult({ stdout: { text: 'log\n{"exit":"passed","message":"ready"}', truncated: false } }),
    shellResult({ stdout: { text: '{"exit":"passed","message":"ready"} {}', truncated: false } }),
    shellResult({ stdout: { text: '{"exit":"passed","message":"ready","extra":1}', truncated: false } }),
    shellResult({ stdout: { text: '{"exit":"passed","message":"ready"}', truncated: true } }),
    shellResult({ stdout: { text: 'x'.repeat(33000), truncated: false } }),
  ])('rejects invalid standalone output without heuristic final-line parsing', async output => {
    const f = await fixture({ shell: shell(async () => output) }); const capture = await f.capture(); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    expect((await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal })).kind).toBe('failed');
  });
  it('keeps only tools.bash, handles nested nonzero facts, and transfers context without interpolation', async () => {
    let observed: PtcRunSpec | undefined;
    const native = ptc(async spec => {
      observed = spec; expect(await binding(spec, 'stepContext', 'read')).toEqual({ title: 'untrusted task text' });
      const facts = await binding(spec, 'tools', 'bash', { command: 'exit 7', timeoutMs: 123 }) as { exitCode: number };
      return { value: { exit: 'passed', message: 'Handled ' + facts.exitCode }, logs: [] };
    });
    const bash = shell(async () => shellResult({ exitCode: 7 })); const f = await fixture({ shell: bash, ptc: native }); const capture = await f.capture('typescript'); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    expect(await f.runtime.execute({ capture, input: { title: 'untrusted task text' }, scope, approvalScope, signal: new AbortController().signal })).toMatchObject({ kind: 'completed', completion: { message: 'Handled 7' } });
    expect(observed?.timeoutMs).toBe(null); expect(Object.keys(observed!.bindings.find(item => item.global === 'tools')!.functions)).toEqual(['bash']); expect(observed!.program).not.toContain('untrusted');
    expect(vi.mocked(bash.execute).mock.calls[0]![0]).toMatchObject({ timeoutMs: 123, onExpiry: 'kill' });
  });
  it.each(['return', 'throw'])('cancels and drains unawaited nested Bash on TypeScript %s', async ending => {
    const started = deferred(); const drained = deferred(); let childSignal: AbortSignal | undefined;
    const bash = shell(async spec => { childSignal = spec.signal; started.resolve(); await new Promise<void>(resolve => spec.signal!.addEventListener('abort', () => { drained.resolve(); resolve(); }, { once: true })); return shellResult({ aborted: true }); });
    const native = ptc(async spec => { void binding(spec, 'tools', 'bash', { command: 'sleep 99999' }); await started.promise; return ending === 'return' ? { value: { exit: 'passed', message: 'done' }, logs: [] } : { error: { kind: 'exception', message: 'failed' }, logs: [] }; });
    const f = await fixture({ shell: bash, ptc: native }); const capture = await f.capture('typescript'); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const outcome = await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    await drained.promise; expect(childSignal?.aborted).toBe(true); expect(outcome.kind).toBe(ending === 'return' ? 'completed' : 'failed');
  });
  it('passes only currently authorized values to Bash while keeping task input separate', async () => {
    const native = shell(); const f = await fixture({ shell: native });
    await f.runtime.variables.set(scope, 'TOKEN', 'old-synthetic-value'); await f.runtime.variables.set(scope, 'UNUSED', 'not-authorized');
    const capture = await f.capture('bash', { env: ['TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    await f.runtime.variables.set(scope, 'TOKEN', 'new-synthetic-value');
    expect((await f.runtime.execute({ capture, input: { task: 'synthetic' }, scope, approvalScope, signal: new AbortController().signal })).kind).toBe('completed');
    const spec = vi.mocked(native.execute).mock.calls[0]![0]; expect(spec.env).toEqual({ TOKEN: 'new-synthetic-value' });
    expect(spec.stdin).not.toContain('synthetic-value'); expect(JSON.stringify(capture)).not.toContain('synthetic-value');
  });
  it('redacts actual resolved values and refuses unauthorized variable access', async () => {
    const native = ptc(async spec => { const secret = await binding(spec, 'authorizedEnvironment', 'get', 'CI_TOKEN'); await expect(binding(spec, 'authorizedEnvironment', 'get', 'OTHER')).rejects.toMatchObject({ code: 'VARIABLE_UNAUTHORIZED' }); return { value: { exit: 'passed', message: 'result ' + secret }, logs: ['log ' + secret] }; });
    const f = await fixture({ ptc: native }); await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-only-secret'); const capture = await f.capture('typescript', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const result = await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal }); expect(JSON.stringify(result)).not.toContain('synthetic-only-secret'); expect(JSON.stringify(result)).toContain('[REDACTED]');
  });
  it('carries bounded sent values through a completion and redacts a known secret', async () => {
    const output = shellResult({ stdout: { text: JSON.stringify({ exit: 'passed', message: 'ok', params: { pipeline: 'ci-main', token: 'synthetic-only-secret' } }), truncated: false } });
    const f = await fixture({ shell: shell(async () => output) }); await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-only-secret');
    const capture = await f.capture('bash', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const result = await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    expect(result).toMatchObject({ kind: 'completed', completion: { exit: 'passed', message: 'ok', params: { pipeline: 'ci-main', token: '[REDACTED]' } } });
    expect(JSON.stringify(result)).not.toContain('synthetic-only-secret');
  });
  it('carries bounded sent values through a TypeScript completion', async () => {
    const native = ptc(async () => ({ value: { exit: 'passed', message: 'ok', params: { pipeline: 'ci-main', commit: 'abc' } }, logs: [] }));
    const f = await fixture({ ptc: native }); const capture = await f.capture('typescript'); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    expect(await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal })).toMatchObject({ kind: 'completed', completion: { exit: 'passed', message: 'ok', params: { pipeline: 'ci-main', commit: 'abc' } } });
  });
  it('rejects a malformed params map as an invalid completion', async () => {
    const output = shellResult({ stdout: { text: JSON.stringify({ exit: 'passed', message: 'ok', params: { 'bad name': 'x' } }), truncated: false } });
    const f = await fixture({ shell: shell(async () => output) }); const capture = await f.capture('bash'); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    expect(await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal })).toMatchObject({ kind: 'failed', diagnostic: { code: 'INVALID_COMPLETION' } });
  });
  it.each([{ programFormat: 'repl' }, { programFormat: 'script' }, { language: 'python' }, { retainsState: true }, { isolation: 'worker-thread' }])('refuses incompatible TypeScript provider %j', async patch => {
    const native = ptc(async () => ({ logs: [] })); Object.assign(native, patch); const f = await fixture({ ptc: native }); const capture = await f.capture('typescript'); await expect(f.runtime.verify(capture)).rejects.toMatchObject({ code: 'TYPESCRIPT_FORMAT_UNSUPPORTED' }); expect(native.run).not.toHaveBeenCalled();
  });
  it('does not require credentials for an empty authorized set and fails explicitly otherwise', async () => {
    const f = await fixture(); f.context.credentials = undefined as never; const runtime = createDeterministicRuntime({ context: f.context, privateDirectory: join(f.root, 'other-private'), policy: f.policy });
    expect(await runtime.variables.resolve(scope, [])).toEqual({}); await expect(runtime.variables.resolve(scope, ['CI_TOKEN'])).rejects.toMatchObject({ code: 'CREDENTIALS_UNAVAILABLE' });
  });
});
describe('additional fail-closed execution contracts', () => {
  it('collects only unreferenced immutable source blobs and retains a shared reference', async () => {
    const f = await fixture(); const kept = await f.capture(); const orphan = await f.capture('bash', { code: 'echo orphan' });
    await f.runtime.collectSources([kept.sourceRef]);
    expect(await f.runtime.loadCapture(orphan)).toBe('echo orphan');
    const restarted = createDeterministicRuntime({ context: f.context, privateDirectory: join(f.root, 'private'), policy: f.policy });
    await restarted.collectSources([kept.sourceRef]);
    expect(await f.runtime.loadCapture(kept)).toContain('return');
    await expect(f.runtime.loadCapture(orphan)).rejects.toMatchObject({ code: 'CAPTURE_MISSING' });
  });
  it('releases a settled preview pin and removes it without a host restart', async () => {
    const f = await fixture(); const kept = await f.capture(); const preview = await f.capture('bash', { code: 'echo preview only' });
    f.runtime.releaseSource?.(preview.sourceRef);
    await f.runtime.collectSources([kept.sourceRef]);
    await expect(f.runtime.loadCapture(preview)).rejects.toMatchObject({ code: 'CAPTURE_MISSING' });
    expect(await f.runtime.loadCapture(kept)).toContain('return');
  });
  it('re-resolves the native credential provider per operation and never launches for missing values', async () => {
    const f = await fixture(); const capture = await f.capture('bash', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    f.context.credentials = undefined as never;
    expect(await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal })).toMatchObject({ kind: 'failed', diagnostic: { code: 'CREDENTIALS_UNAVAILABLE' } });
    expect(f.context.shell.execute).not.toHaveBeenCalled();
    const replacement = credentials(); f.context.credentials = replacement.store;
    await f.runtime.variables.set(scope, 'CI_TOKEN', 'current-provider-value');
    expect(await f.runtime.variables.resolve(scope, ['CI_TOKEN'])).toEqual({ CI_TOKEN: 'current-provider-value' });
    expect(f.credential.records.size).toBe(0);
  });
  it('redacts native exception and standalone stderr before returning diagnostics', async () => {
    const native = ptc(async () => ({ logs: [], error: { kind: 'exception', message: 'synthetic-secret error' } }));
    const f = await fixture({ ptc: native }); await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-secret');
    const capture = await f.capture('typescript', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const outcome = await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { message: '[REDACTED] error' } });
  });
  it('rejects an unmapped exit, unsupported lifetime, and a provider that widens explicit roots', async () => {
    const f = await fixture({ shell: shell(async () => shellResult({ stdout: { text: '{"exit":"unmapped","message":"bad route"}', truncated: false } })) });
    const capture = await f.capture(); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    expect(await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal })).toMatchObject({ kind: 'failed', diagnostic: { code: 'UNMAPPED_EXIT' } });
    const original = f.context.shell.resolve.bind(f.context.shell);
    f.context.shell.resolve = request => ({ ...original(request), onExpiry: 'kill' });
    await expect(f.runtime.verify(capture)).rejects.toMatchObject({ code: 'BASH_LIFETIME_UNSUPPORTED' });
    f.context.shell.resolve = request => ({ ...original(request), sandboxPolicy: { ...request.sandboxPolicy!, additionalWritableRoots: ['/unreviewed'] } });
    await expect(f.runtime.verify(capture)).rejects.toMatchObject({ code: 'BASH_LIFETIME_UNSUPPORTED' });
  });
  it('does not trust an impostor on a reused witness port or disclose its recovery token', async () => {
    const secret = 'a'.repeat(64); let received = '';
    const server = createServer(socket => { socket.on('data', data => { received += String(data); socket.end(JSON.stringify({ payload: { clean: true }, proof: 'fake' }) + '\n'); }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test endpoint.');
    try { await expect(askWitness({ port: address.port, token: secret }, 'reclaim')).rejects.toThrow(/authentication/); expect(received).not.toContain(secret); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('refuses a concurrent host but safely recovers a host lost before code admission', async () => {
    const f = await fixture(); const ownership = new NativeExecutionOwnership(join(f.root, 'lease'));
    const lifetime = await createNativeLifetime({ register: async () => {}, settled: async () => {}, sweep: async () => {} });
    await ownership.acquire(scope, 'pre-spawn', 'task', lifetime.host);
    await expect(ownership.reclaim('pre-spawn')).rejects.toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' });
    await lifetime.close(); await ownership.reclaim('pre-spawn');
    const release = await ownership.acquire(scope, 'new-run', 'task'); await release();
  });
});
describe('bounded diagnostics, native policy, and exclusive resource ownership', () => {
  it('redacts before truncating and rejects nonconforming completion fields', () => {
    const redactor = new SecretRedactor(); redactor.add({ A: 'synthetic-secret' }); expect(redactor.text('x'.repeat(100) + 'synthetic-secret', 110)).not.toContain('synthetic');
    const overlapping = new SecretRedactor(); overlapping.add({ first: 'A', second: 'E' }); expect(overlapping.text('AE')).toBe('[REDACTED][REDACTED]');
    for (const value of [undefined, {}, { exit: '', message: 'x' }, { exit: 'passed', message: '' }, { exit: 'passed', message: 'x', more: true }]) expect(() => parseCompletion(value)).toThrow();
  });
  it('uses standing policy and selected directory without a session and rejects partial enforcement', async () => {
    const resolvePolicy = vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/base', additionalWritableRoots: ['/extra'] }));
    const confine = vi.fn(async () => ({ enforcement: 'partial' })); const policy = createNativeDeterministicPolicy({ sandboxPolicy: { resolve: resolvePolicy }, sandbox: { confine } });
    await expect(policy.execution('/task')).rejects.toMatchObject({ code: 'POLICY_INCOMPLETE' }); expect(resolvePolicy).toHaveBeenCalledWith(); expect(confine).toHaveBeenCalledWith(['bash', '-c', ':'], { mode: 'workspace-write', workspaceRoot: '/task', additionalWritableRoots: ['/extra'] }, undefined);
  });
  it('finishes the ownership sweep when a force-killed guard can no longer answer', async () => {
    const f = await fixture(); const ownership = new NativeExecutionOwnership(join(f.root, 'lease-fallback'));
    const release = await ownership.acquire(scope, 'dead-guard', 'task');
    const marker = 'a'.repeat(32);
    const dead = createServer(() => {}); await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve));
    const port = (dead.address() as { port: number }).port;
    const closed = new Promise<void>(resolve => dead.close(() => resolve())); await closed;
    await release.register({ port, token: 'b'.repeat(64), marker });
    const { spawn } = await import('node:child_process');
    const env = { ...process.env, DSH_DETERMINISTIC_RUN: marker };
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', env });
    // A process without the token must never be touched by the host sweep.
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', env: { ...process.env } });
    try {
      await expect.poll(() => ownedProcesses(marker).length, { timeout: 5000 }).toBe(1);
      await release();
      expect(ownedProcesses(marker)).toEqual([]);
      const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve));
      await exited;
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(unrelated.exitCode).toBeNull(); expect(unrelated.signalCode).toBeNull();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (unrelated.exitCode === null && unrelated.signalCode === null) unrelated.kill('SIGKILL');
    }
  });
  it('refuses uncertain crash ownership and same-task replacement while unrelated tasks proceed', async () => {
    const f = await fixture(); const first = new NativeExecutionOwnership(join(f.root, 'owners-fixture')); const release = await first.acquire(scope, 'execution-one', 'task-one');
    const restarted = new NativeExecutionOwnership(join(f.root, 'owners-fixture')); await expect(restarted.reclaim('execution-one')).rejects.toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' });
    await expect(restarted.acquire(scope, 'execution-two', 'task-one')).rejects.toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' });
    const releaseOther = await restarted.acquire(scope, 'execution-other', 'task-other'); await releaseOther(); await release(); await restarted.reclaim('execution-one');
  });
});

describe('guarded Bash failure diagnostics and bounded retry', () => {
  function failed(outcome: ExecutionOutcome): { code: string; message: string; details?: Record<string, unknown> } {
    if (outcome.kind !== 'failed') throw new Error('expected a settled failure, got ' + outcome.kind);
    return outcome.diagnostic;
  }
  async function run(f: Awaited<ReturnType<typeof fixture>>, language: 'bash' | 'typescript' = 'bash') {
    const capture = await f.capture(language); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    return f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
  }

  it('repeats a guard that never admitted the command and continues the same execution', async () => {
    let calls = 0;
    const native = rawShell(() => (++calls < 3 ? guardFailure() : envelope('{"exit":"passed","message":"recovered"}', 'note')));
    const f = await fixture({ shell: native, retry: { delaysMs: [0, 0] } });
    expect(await run(f)).toMatchObject({ kind: 'completed', completion: { exit: 'passed', message: 'recovered' }, diagnostics: ['note'] });
    expect(vi.mocked(native.execute)).toHaveBeenCalledTimes(3);
  });

  it('settles one failure that carries every attempt after the retries are exhausted', async () => {
    const native = rawShell(() => guardFailure());
    const f = await fixture({ shell: native, retry: { delaysMs: [0, 0] } });
    const outcome = await run(f);
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'BASH_PROTOCOL', details: { origin: 'infrastructure', guard: { admission: 'not-admitted', exitCode: 125, signal: null } } } });
    const details = failed(outcome).details as { attempts?: unknown[] };
    expect(details?.attempts).toHaveLength(3);
    expect(vi.mocked(native.execute)).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['an unproven process tree', guardFailure({ stderr: { text: 'NATIVE_LIFETIME_UNCLEAN: Owned processes survived cleanup.\n', truncated: false } }), 'started', /could not prove/, 'BASH_PROTOCOL'],
    ['an unavailable guard runtime', guardFailure({ stderr: { text: 'NATIVE_LIFETIME_UNAVAILABLE: install Node >=24.9\n', truncated: false } }), 'not-admitted', /unavailable/, 'GUARD_UNAVAILABLE'],
    ['an unsupported guard platform', guardFailure({ stderr: { text: 'NATIVE_LIFETIME_UNSUPPORTED: no adapter\n', truncated: false } }), 'not-admitted', /does not support/, 'GUARD_UNAVAILABLE'],
    ['a killed guard', guardFailure({ exitCode: null, signal: 'SIGKILL' }), 'unknown', /terminated by SIGKILL/, 'BASH_PROTOCOL'],
    ['an unknown guard exit', guardFailure({ exitCode: 1, stderr: { text: 'node:internal failure\n', truncated: false } }), 'unknown', /did not return a valid result/, 'BASH_PROTOCOL'],
    ['whitespace-only stderr', guardFailure({ stderr: { text: ' \n', truncated: false } }), 'unknown', /did not return a valid result/, 'BASH_PROTOCOL'],
    ['a lossy empty capture', guardFailure({ stderr: { text: '', truncated: true } }), 'unknown', /did not return a valid result/, 'BASH_PROTOCOL'],
  ] as const)('does not repeat %s', async (_label, result, admission, message, code) => {
    const native = rawShell(() => result);
    const f = await fixture({ shell: native, retry: { delaysMs: [0, 0] } });
    const outcome = await run(f);
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code, details: { guard: { admission } } } });
    expect(failed(outcome).message).toMatch(message);
    expect(vi.mocked(native.execute)).toHaveBeenCalledTimes(1);
  });

  it('keeps a nonfinite retry policy bounded', async () => {
    expect(createBashRetry({ attempts: Number.NaN }).attempts).toBe(3);
    expect(createBashRetry({ attempts: Number.POSITIVE_INFINITY }).attempts).toBe(3);
    expect(createBashRetry({ attempts: 0 }).attempts).toBe(1);
    const retry = createBashRetry({ delaysMs: [Number.NaN] });
    const started = Date.now();
    await retry.wait(1, new AbortController().signal);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('abandons the wait as soon as the execution is stopped', async () => {
    const retry = createBashRetry({ delaysMs: [60_000] });
    const controller = new AbortController();
    const waiting = retry.wait(1, controller.signal);
    controller.abort(new Error('stopped by the user'));
    await expect(waiting).rejects.toThrow('stopped by the user');
    await expect(retry.wait(1, controller.signal)).rejects.toThrow('stopped by the user');
  });

  it('starts no further attempt while native cleanup is still pending', async () => {
    const controller = new AbortController();
    let calls = 0;
    const shellPort = rawShell(() => { calls += 1; return guardFailure(); });
    const stop = () => new Promise<void>(resolve => setTimeout(resolve, 300));
    const lifetime = { host: { port: 1, token: 'x' }, shell: (command: string) => command, typescriptPrelude: () => '', stop, close: async () => { await stop(); } } as unknown as NativeLifetime;
    const capture: DeterministicCapture = { sourceRef: 'ref', fingerprint: 'fp', language: 'bash', directory: 'project', executionDirectory: '/project', source: { kind: 'inline' }, env: [], params: [], exits: { passed: { columnId: 'review', stageIdentity: 'review-key' } } };
    const request: ExecuteRequest = { capture, input: {}, scope, approvalScope, signal: controller.signal };
    const running = executeCapturedProgram({ request, code: 'printf ready', policy: { mode: 'danger-full-access', workspaceRoot: '/project' }, shell: shellPort, variables: { resolve: async () => ({}), status: async () => [], set: async () => undefined, remove: async () => undefined }, lifetime, retry: createBashRetry({ delaysMs: [50] }) });
    await expect.poll(() => calls, { timeout: 5000 }).toBe(1);
    controller.abort(new Error('stopped by the user'));
    expect(await running).toEqual({ kind: 'aborted' });
    expect(calls).toBe(1);
  });

  it('reports the guard cause when a program does not handle the rejection', async () => {
    const bash = rawShell(() => guardFailure({ stderr: { text: 'NATIVE_LIFETIME_UNCLEAN: unknown\n', truncated: false } }));
    const native = ptc(async spec => {
      await expect(binding(spec, 'tools', 'bash', { command: 'gh api user' })).rejects.toMatchObject({ code: 'BASH_PROTOCOL' });
      return { error: { kind: 'exception', message: 'Error: The isolated Bash guard did not return a valid result.\n    at bindingFailure (/tmp/bootstrap.ts:246:61)' }, logs: [] };
    });
    const f = await fixture({ shell: bash, ptc: native, retry: { delaysMs: [0, 0] } });
    const outcome = await run(f, 'typescript');
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'BASH_PROTOCOL', details: { origin: 'infrastructure', cause: { code: 'TYPESCRIPT_EXCEPTION' } } } });
    const message = failed(outcome).message;
    expect(message).toContain('process tree');
    expect(message).not.toContain('bindingFailure');
    expect(message).not.toContain('    at ');
  });

  it('does not turn a handled rejection into a failure', async () => {
    const bash = rawShell(() => guardFailure({ stderr: { text: 'NATIVE_LIFETIME_UNCLEAN: unknown\n', truncated: false } }));
    const native = ptc(async spec => {
      await expect(binding(spec, 'tools', 'bash', { command: 'gh api user' })).rejects.toMatchObject({ code: 'BASH_PROTOCOL' });
      return { value: { exit: 'passed', message: 'handled the guard failure' }, logs: [] };
    });
    const f = await fixture({ shell: bash, ptc: native, retry: { delaysMs: [0, 0] } });
    expect(await run(f, 'typescript')).toMatchObject({ kind: 'completed', completion: { message: 'handled the guard failure' } });
  });

  it('redacts a secret that a guard wrote to its diagnostic stream', async () => {
    const native = rawShell(() => guardFailure({ stderr: { text: 'NATIVE_LIFETIME_UNCLEAN: token synthetic-secret rejected\n', truncated: false } }));
    const f = await fixture({ shell: native, retry: { delaysMs: [0, 0] } });
    await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-secret');
    const capture = await f.capture('bash', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const outcome = await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    expect(JSON.stringify(outcome)).not.toContain('synthetic-secret');
    expect((failed(outcome).details as { guard?: { stderrTail?: string } }).guard?.stderrTail).toContain('[REDACTED]');
  });

  it('redacts a secret that crosses the retained window boundary', async () => {
    // The secret is longer than the retained window, so a bound-before-redact
    // implementation would persist a recognizable suffix of it.
    const secret = 'A'.repeat(800) + 'SECRET-TAIL-MARKER';
    const native = rawShell(() => guardFailure({ stderr: { text: secret + 'y'.repeat(100), truncated: false } }));
    const f = await fixture({ shell: native, retry: { delaysMs: [0, 0] } });
    await f.runtime.variables.set(scope, 'CI_TOKEN', secret);
    const capture = await f.capture('bash', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const outcome = await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    const encoded = JSON.stringify(outcome);
    expect(encoded).not.toContain('SECRET-TAIL-MARKER');
    const tail = (failed(outcome).details as { guard?: { stderrTail?: string } }).guard?.stderrTail ?? '';
    expect(tail).toContain('[REDACTED]');
    expect(tail).not.toContain('SECRET-TAIL-MARKER');
  });

  it('redacts a JSON-escaped secret carried by the guard envelope', async () => {
    const secret = 'synthetic"secret';
    const envelopeText = JSON.stringify({ stdout: '', stderr: 'the value ' + secret + ' failed', overflow: true });
    const native = rawShell(() => shellResult({ stdout: { text: envelopeText, truncated: false }, stderr: { text: '', truncated: false } }));
    const f = await fixture({ shell: native, retry: { delaysMs: [0, 0] } });
    await f.runtime.variables.set(scope, 'CI_TOKEN', secret);
    const capture = await f.capture('bash', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const outcome = await f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    const encoded = JSON.stringify(outcome);
    expect(encoded).not.toContain('synthetic');
    expect(encoded).not.toContain('synthetic\\"secret');
    const head = (failed(outcome).details as { guard?: { stdoutHead?: string } }).guard?.stdoutHead ?? '';
    expect(JSON.parse(head)).toMatchObject({ stderr: 'the value [REDACTED] failed' });
  });

  it('keeps an uncaught environment authorization rejection a configuration failure', async () => {
    const native = ptc(async spec => {
      await expect(binding(spec, 'authorizedEnvironment', 'get', 'OTHER')).rejects.toMatchObject({ code: 'VARIABLE_UNAUTHORIZED' });
      return { error: { kind: 'exception', message: 'Error: the environment read was refused' }, logs: [] };
    });
    const f = await fixture({ ptc: native });
    const outcome = await run(f, 'typescript');
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'VARIABLE_UNAUTHORIZED', details: { origin: 'configuration', cause: { code: 'TYPESCRIPT_EXCEPTION' } } } });
  });

  it('classifies transport truncation as infrastructure, not as a completion defect', async () => {
    const native = rawShell(() => shellResult({ stdout: { text: '', truncated: true } }));
    const f = await fixture({ shell: native, retry: { delaysMs: [0, 0] } });
    const outcome = await run(f);
    expect(failed(outcome).code).toBe('OUTPUT_TRANSPORT_LIMIT');
    expect((failed(outcome).details as { origin?: string }).origin).toBe('infrastructure');
    expect(vi.mocked(native.execute)).toHaveBeenCalledTimes(1);
  });

  it('keeps the earlier diagnostic when native cleanup cannot confirm quiescence', async () => {
    const entered = deferred(); const release = deferred();
    const native = ptc(async () => { entered.resolve(); await release.promise; return { error: { kind: 'exception', message: 'program failed' }, logs: [] }; });
    const f = await fixture({ ptc: native });
    const capture = await f.capture('typescript'); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const running = f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: new AbortController().signal });
    await entered.promise;
    const owners = join(f.root, 'private', 'owners');
    const [name] = await readdir(owners);
    await writeFile(join(owners, name!), JSON.stringify({ execution: 'replaced', nonce: 'corrupted', guards: [] }));
    release.resolve();
    const outcome = await running;
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'OWNERSHIP_UNCERTAIN', details: { origin: 'infrastructure', cause: { code: 'TYPESCRIPT_EXCEPTION', message: 'program failed', details: { origin: 'script' } } } } });
    expect(failed(outcome).message).toContain('quiescence');
  });

  it('records a stop as the cause when cleanup cannot be confirmed', async () => {
    const entered = deferred(); const aborted = deferred();
    const native = ptc(async spec => { entered.resolve(); await new Promise<void>(resolve => spec.signal!.addEventListener('abort', () => resolve())); aborted.resolve(); return { error: { kind: 'abort', message: 'stopped' }, logs: [] }; });
    const f = await fixture({ ptc: native });
    const capture = await f.capture('typescript'); await f.runtime.trust.approve(approvalScope, capture.fingerprint);
    const controller = new AbortController();
    const running = f.runtime.execute({ capture, input: {}, scope, approvalScope, signal: controller.signal });
    await entered.promise;
    const owners = join(f.root, 'private', 'owners');
    const [name] = await readdir(owners);
    await writeFile(join(owners, name!), JSON.stringify({ execution: 'replaced', nonce: 'corrupted', guards: [] }));
    controller.abort(new Error('stopped by the user'));
    await aborted.promise;
    const outcome = await running;
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { code: 'OWNERSHIP_UNCERTAIN', details: { origin: 'infrastructure', cause: { code: 'EXECUTION_ABORTED' } } } });
  });

  it('reports only the attempts of the call that settled the failure', async () => {
    let calls = 0;
    const bash = rawShell(() => {
      calls += 1;
      if (calls === 1) return guardFailure();
      if (calls === 2) return envelope('{"exit":"passed","message":"first call recovered"}');
      return guardFailure();
    });
    const native = ptc(async spec => {
      await expect(binding(spec, 'tools', 'bash', { command: 'first' })).resolves.toBeDefined();
      await expect(binding(spec, 'tools', 'bash', { command: 'second' })).rejects.toMatchObject({ code: 'BASH_PROTOCOL' });
      return { error: { kind: 'exception', message: 'Error: the guard left no result' }, logs: [] };
    });
    const f = await fixture({ shell: bash, ptc: native, retry: { delaysMs: [0, 0] } });
    const outcome = await run(f, 'typescript');
    expect(failed(outcome).code).toBe('BASH_PROTOCOL');
    expect((failed(outcome).details as { attempts?: unknown[] }).attempts).toHaveLength(3);
  });
});


