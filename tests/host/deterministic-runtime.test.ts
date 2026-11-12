import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials';
import type { PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime';
import type { ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell';
import type { CredentialStore } from '../../src/host/sharing/credentials.js';
import { createDeterministicRuntime, type DeterministicPolicyPort, type NativePtcPort, type NativeShellPort } from '../../src/host/deterministic/index.js';
import { NativeExecutionOwnership } from '../../src/host/deterministic/ownership.js';
import { createNativeDeterministicPolicy } from '../../src/host/deterministic/native-policy.js';
import { createServer } from 'node:net';
import { askWitness, createNativeLifetime } from '../../src/host/deterministic/lifetime.js';
import { SecretRedactor, parseCompletion } from '../../src/host/deterministic/safety.js';
import { ownedProcesses } from '../../src/host/deterministic/owned-processes.js';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const scope = { hubId: 'local-hub', boardId: 'board-a', projectId: 'project-a', stageIdentity: 'stable-stage-a' };
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
async function fixture(options: { shell?: NativeShellPort; ptc?: NativePtcPort } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kanban-runtime-')); roots.push(root);
  const project = join(root, 'project'); const task = join(root, 'task'); await mkdir(project); await mkdir(task);
  const policy: DeterministicPolicyPort = {
    directory: path => realpath(path),
    source: async (path, directory) => ({ path: await realpath(resolve(directory, path)), code: await readFile(resolve(directory, path), 'utf8') }),
    execution: async directory => ({ mode: 'danger-full-access', workspaceRoot: directory }),
  };
  const credential = credentials();
  const context = { credentials: credential.store, shell: options.shell ?? shell(), ptcRuntime: options.ptc };
  const runtime = createDeterministicRuntime({ context, privateDirectory: join(root, 'private'), policy });
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
  it('captures absolute references and does not reread a deleted primary file', async () => {
    const f = await fixture(); const source = join(f.project, 'absolute.sh'); await writeFile(source, 'printf original');
    const capture = await f.capture('bash', { code: undefined, file: source, directory: 'project' });
    expect(capture.source).toEqual({ kind: 'file', path: await realpath(source) });
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
  it('binds approval to exact fingerprint and local project/stage scope, never saves implicitly', async () => {
    const f = await fixture(); const capture = await f.capture();
    expect(await f.runtime.trust.isApproved(scope, capture.fingerprint)).toBe(false);
    await f.runtime.trust.approve(scope, capture.fingerprint); expect(await f.runtime.trust.isApproved(scope, capture.fingerprint)).toBe(true);
    expect(await f.runtime.trust.isApproved({ ...scope, projectId: 'other' }, capture.fingerprint)).toBe(false);
    expect(await f.runtime.trust.isApproved({ ...scope, boardId: 'other-board' }, capture.fingerprint)).toBe(false);
    expect(await f.runtime.trust.isApproved({ ...scope, stageIdentity: 'reused-name-new-stage' }, capture.fingerprint)).toBe(false);
    const expanded = await f.capture('bash', { env: ['CI_TOKEN'] }); expect(await f.runtime.trust.isApproved(scope, expanded.fingerprint)).toBe(false);
    await f.runtime.trust.reject(scope, capture.fingerprint); expect(await f.runtime.trust.isApproved(scope, capture.fingerprint)).toBe(false);
  });
  it('changes reviewed fingerprints for language, source provenance, directory, and routes', async () => {
    const f = await fixture(); const baseline = await f.capture('bash'); await f.runtime.trust.approve(scope, baseline.fingerprint);
    const code = 'return {exit:"passed",message:"ready"};'; await writeFile(join(f.task, 'same-code.sh'), code);
    const variants = [await f.capture('typescript'), await f.capture('bash', { directory: 'project' }), await f.capture('bash', { code: undefined, file: 'same-code.sh' }),
      await f.runtime.capture({ definition: { language: 'bash', code, directory: 'task', exits: { passed: 'other' } }, projectDirectory: f.project, taskDirectory: f.task, exits: { passed: { columnId: 'other', stageIdentity: 'other-key' } } })];
    for (const variant of variants) { expect(variant.fingerprint).not.toBe(baseline.fingerprint); expect(await f.runtime.trust.isApproved(scope, variant.fingerprint)).toBe(false); }
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
    const native = shell(); const f = await fixture({ shell: native }); const capture = await f.capture(); await f.runtime.trust.approve(scope, capture.fingerprint);
    const text = '$(not-a-command); untrusted text'; const result = await f.runtime.execute({ capture, input: { title: text }, scope, signal: new AbortController().signal });
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
    const f = await fixture({ shell: shell(async () => output) }); const capture = await f.capture(); await f.runtime.trust.approve(scope, capture.fingerprint);
    expect((await f.runtime.execute({ capture, input: {}, scope, signal: new AbortController().signal })).kind).toBe('failed');
  });
  it('keeps only tools.bash, handles nested nonzero facts, and transfers context without interpolation', async () => {
    let observed: PtcRunSpec | undefined;
    const native = ptc(async spec => {
      observed = spec; expect(await binding(spec, 'stepContext', 'read')).toEqual({ title: 'untrusted task text' });
      const facts = await binding(spec, 'tools', 'bash', { command: 'exit 7', timeoutMs: 123 }) as { exitCode: number };
      return { value: { exit: 'passed', message: 'Handled ' + facts.exitCode }, logs: [] };
    });
    const bash = shell(async () => shellResult({ exitCode: 7 })); const f = await fixture({ shell: bash, ptc: native }); const capture = await f.capture('typescript'); await f.runtime.trust.approve(scope, capture.fingerprint);
    expect(await f.runtime.execute({ capture, input: { title: 'untrusted task text' }, scope, signal: new AbortController().signal })).toMatchObject({ kind: 'completed', completion: { message: 'Handled 7' } });
    expect(observed?.timeoutMs).toBe(null); expect(Object.keys(observed!.bindings.find(item => item.global === 'tools')!.functions)).toEqual(['bash']); expect(observed!.program).not.toContain('untrusted');
    expect(vi.mocked(bash.execute).mock.calls[0]![0]).toMatchObject({ timeoutMs: 123, onExpiry: 'kill' });
  });
  it.each(['return', 'throw'])('cancels and drains unawaited nested Bash on TypeScript %s', async ending => {
    const started = deferred(); const drained = deferred(); let childSignal: AbortSignal | undefined;
    const bash = shell(async spec => { childSignal = spec.signal; started.resolve(); await new Promise<void>(resolve => spec.signal!.addEventListener('abort', () => { drained.resolve(); resolve(); }, { once: true })); return shellResult({ aborted: true }); });
    const native = ptc(async spec => { void binding(spec, 'tools', 'bash', { command: 'sleep 99999' }); await started.promise; return ending === 'return' ? { value: { exit: 'passed', message: 'done' }, logs: [] } : { error: { kind: 'exception', message: 'failed' }, logs: [] }; });
    const f = await fixture({ shell: bash, ptc: native }); const capture = await f.capture('typescript'); await f.runtime.trust.approve(scope, capture.fingerprint);
    const outcome = await f.runtime.execute({ capture, input: {}, scope, signal: new AbortController().signal });
    await drained.promise; expect(childSignal?.aborted).toBe(true); expect(outcome.kind).toBe(ending === 'return' ? 'completed' : 'failed');
  });
  it('passes only currently authorized values to Bash while keeping task input separate', async () => {
    const native = shell(); const f = await fixture({ shell: native });
    await f.runtime.variables.set(scope, 'TOKEN', 'old-synthetic-value'); await f.runtime.variables.set(scope, 'UNUSED', 'not-authorized');
    const capture = await f.capture('bash', { env: ['TOKEN'] }); await f.runtime.trust.approve(scope, capture.fingerprint);
    await f.runtime.variables.set(scope, 'TOKEN', 'new-synthetic-value');
    expect((await f.runtime.execute({ capture, input: { task: 'synthetic' }, scope, signal: new AbortController().signal })).kind).toBe('completed');
    const spec = vi.mocked(native.execute).mock.calls[0]![0]; expect(spec.env).toEqual({ TOKEN: 'new-synthetic-value' });
    expect(spec.stdin).not.toContain('synthetic-value'); expect(JSON.stringify(capture)).not.toContain('synthetic-value');
  });
  it('redacts actual resolved values and refuses unauthorized variable access', async () => {
    const native = ptc(async spec => { const secret = await binding(spec, 'authorizedEnvironment', 'get', 'CI_TOKEN'); await expect(binding(spec, 'authorizedEnvironment', 'get', 'OTHER')).rejects.toMatchObject({ code: 'VARIABLE_UNAUTHORIZED' }); return { value: { exit: 'passed', message: 'result ' + secret }, logs: ['log ' + secret] }; });
    const f = await fixture({ ptc: native }); await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-only-secret'); const capture = await f.capture('typescript', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(scope, capture.fingerprint);
    const result = await f.runtime.execute({ capture, input: {}, scope, signal: new AbortController().signal }); expect(JSON.stringify(result)).not.toContain('synthetic-only-secret'); expect(JSON.stringify(result)).toContain('[REDACTED]');
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
    const f = await fixture(); const capture = await f.capture('bash', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(scope, capture.fingerprint);
    f.context.credentials = undefined as never;
    expect(await f.runtime.execute({ capture, input: {}, scope, signal: new AbortController().signal })).toMatchObject({ kind: 'failed', diagnostic: { code: 'CREDENTIALS_UNAVAILABLE' } });
    expect(f.context.shell.execute).not.toHaveBeenCalled();
    const replacement = credentials(); f.context.credentials = replacement.store;
    await f.runtime.variables.set(scope, 'CI_TOKEN', 'current-provider-value');
    expect(await f.runtime.variables.resolve(scope, ['CI_TOKEN'])).toEqual({ CI_TOKEN: 'current-provider-value' });
    expect(f.credential.records.size).toBe(0);
  });
  it('redacts native exception and standalone stderr before returning diagnostics', async () => {
    const native = ptc(async () => ({ logs: [], error: { kind: 'exception', message: 'synthetic-secret error' } }));
    const f = await fixture({ ptc: native }); await f.runtime.variables.set(scope, 'CI_TOKEN', 'synthetic-secret');
    const capture = await f.capture('typescript', { env: ['CI_TOKEN'] }); await f.runtime.trust.approve(scope, capture.fingerprint);
    const outcome = await f.runtime.execute({ capture, input: {}, scope, signal: new AbortController().signal });
    expect(outcome).toMatchObject({ kind: 'failed', diagnostic: { message: '[REDACTED] error' } });
  });
  it('rejects an unmapped exit, unsupported lifetime, and a provider that widens explicit roots', async () => {
    const f = await fixture({ shell: shell(async () => shellResult({ stdout: { text: '{"exit":"unmapped","message":"bad route"}', truncated: false } })) });
    const capture = await f.capture(); await f.runtime.trust.approve(scope, capture.fingerprint);
    expect(await f.runtime.execute({ capture, input: {}, scope, signal: new AbortController().signal })).toMatchObject({ kind: 'failed', diagnostic: { code: 'UNMAPPED_EXIT' } });
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
    const lifetime = await createNativeLifetime({ register: async () => {}, settled: async () => {} });
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
