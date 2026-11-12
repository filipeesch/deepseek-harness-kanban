import type { PtcBindingNamespace, PtcJsonValue } from '@deepseek-ai/dsh-ptc-runtime';
import type { ShellRunResult } from '@deepseek-ai/dsh-shell';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { FailureAttempt } from '../../shared/deterministic-failure.js';
import type { DeterministicCapture } from '../../shared/deterministic.js';
import { classifyFailureCode } from '../../domain/deterministic-failure.js';
import { readGuardOutcome } from './guard-outcome.js';
import { createBashRetry, type BashRetry } from './retry.js';
import type { NativeLifetime } from './lifetime.js';
import type { DeterministicVariables, ExecuteRequest, ExecutionOutcome, NativePtcPort, NativeShellPort } from './ports.js';
import { DeterministicRuntimeError, failure } from './ports.js';
import { COMPLETION_MAX_BYTES, DIAGNOSTIC_MAX_BYTES, SecretRedactor, bounded, parseCompletion } from './safety.js';

export const TYPESCRIPT_PRELUDE = 'const input = await stepContext.read(null);\nconst env = Object.freeze({ get: async (name) => authorizedEnvironment.get(name) });\n';
function samePolicy(actual: SandboxExecutionPolicy | undefined, expected: SandboxExecutionPolicy): boolean {
  return actual?.mode === expected.mode && actual.workspaceRoot === expected.workspaceRoot && JSON.stringify(actual.additionalWritableRoots ?? []) === JSON.stringify(expected.additionalWritableRoots ?? []);
}
function shellPolicy(shell: NativeShellPort, policy: SandboxExecutionPolicy): void {
  if (policy.mode !== 'danger-full-access' && shell.sandboxMode === undefined) failure('POLICY_UNSUPPORTED', 'Mount a native sandboxing Bash executor for the selected file policy.');
}
export function verifyExecutors(shell: NativeShellPort | undefined, runtime: NativePtcPort | undefined, capture: DeterministicCapture, policy: SandboxExecutionPolicy, signal?: AbortSignal): void {
  if (!shell) failure('BASH_UNAVAILABLE', 'Mount the public native Bash execution capability before running deterministic steps.');
  shellPolicy(shell, policy);
  const spec = shell.resolve({ command: ':', workdir: capture.executionDirectory, onExpiry: 'none', sandboxPolicy: policy, stdoutMaxBytes: 256 * 1024, signal });
  if (spec.onExpiry !== 'none' || spec.stdoutMaxBytes < 256 * 1024 || spec.workdir !== capture.executionDirectory || !samePolicy(spec.sandboxPolicy, policy)) failure('BASH_LIFETIME_UNSUPPORTED', 'The Bash provider must preserve explicit no-deadline execution, directory, and native policy.');
  if (capture.language === 'typescript') {
    if (!runtime) failure('TYPESCRIPT_UNAVAILABLE', 'Mount a fresh native TypeScript PTC runtime with function-body support.');
    if (runtime.language !== 'typescript' || runtime.programFormat !== 'function-body' || runtime.retainsState || !['process', 'container'].includes(runtime.isolation)) failure('TYPESCRIPT_FORMAT_UNSUPPORTED', 'Select a fresh isolated function-body TypeScript provider; REPL, Script, retained state, and in-process evaluation are unsupported.');
    if (policy.mode !== 'danger-full-access' && runtime.sandboxMode === undefined) failure('POLICY_UNSUPPORTED', 'The TypeScript provider must enforce the selected native file policy.');
    const resolved = runtime.resolve({ program: 'return null;', bindings: [], cwd: capture.executionDirectory, timeoutMs: null, sandboxPolicy: runtime.sandboxMode === undefined ? undefined : policy, signal });
    if (resolved.timeoutMs !== null || resolved.cwd !== capture.executionDirectory || runtime.sandboxMode !== undefined && !samePolicy(resolved.sandboxPolicy, policy)) failure('TYPESCRIPT_LIFETIME_UNSUPPORTED', 'The TypeScript provider must preserve no deadline and the selected native policy/directory.');
  }
}
function commandFacts(result: ShellRunResult): PtcJsonValue {
  return {
    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, aborted: result.aborted,
    stdout: { text: bounded(result.stdout.text, COMPLETION_MAX_BYTES), truncated: result.stdout.truncated || Buffer.byteLength(result.stdout.text) > COMPLETION_MAX_BYTES },
    stderr: { text: bounded(result.stderr.text), truncated: result.stderr.truncated || Buffer.byteLength(result.stderr.text) > DIAGNOSTIC_MAX_BYTES },
    ...(result.sandbox ? { sandbox: { mode: result.sandbox.mode, denied: result.sandbox.denied, ...(result.sandbox.enforcement ? { enforcement: result.sandbox.enforcement } : {}) } } : {}),
  };
}
function checkPolicyResult(result: { sandbox?: { denied: boolean; runnerFailed?: boolean; enforcement?: string } }, policy: SandboxExecutionPolicy): void {
  if (result.sandbox?.denied || result.sandbox?.runnerFailed) failure('POLICY_DENIED', 'Native execution denied an operation or could not establish confinement; permissions were not widened.');
  if (policy.mode !== 'danger-full-access' && result.sandbox?.enforcement !== 'full') failure('POLICY_INCOMPLETE', 'The native execution did not confirm full file-policy enforcement.');
}
/** One cancellation tree; resolution waits for every binding even if user code forgot await. */
export async function executeCapturedProgram(options: {
  request: ExecuteRequest; code: string; policy: SandboxExecutionPolicy;
  shell: NativeShellPort; runtime?: NativePtcPort; variables: DeterministicVariables; lifetime?: NativeLifetime;
  /** Bounded repetition policy for a guarded Bash call the host did not admit. */
  retry?: BashRetry;
}): Promise<ExecutionOutcome> {
  const { request, code, policy, shell, runtime, variables } = options;
  const retry = options.retry ?? createBashRetry();
  const controller = new AbortController();
  let stopping: Promise<void> | undefined;
  const stopOwned = () => stopping ??= (options.lifetime?.stop() ?? Promise.resolve()).finally(() => controller.abort(request.signal.reason));
  const abort = () => { void stopOwned().catch(() => {}); };
  if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true });
  const signal = controller.signal;
  const redactor = new SecretRedactor();
  const pending = new Set<Promise<PtcJsonValue>>();
  let accepting = true;
  /** The first host failure of this execution; a program exception may only be its symptom. */
  let rootCause: { code: string; message: string; detail?: Record<string, unknown> } | undefined;
  const recordRootCause = (error: unknown): void => {
    if (rootCause !== undefined) return;
    const code = error instanceof DeterministicRuntimeError ? error.code : 'EXECUTOR_FAILED';
    // A program-caused rejection is not a host failure: the program's own error stays the failure.
    if (classifyFailureCode(code) === 'script') return;
    rootCause = { code, message: error instanceof Error ? error.message : String(error), ...(error instanceof DeterministicRuntimeError && error.detail !== undefined ? { detail: error.detail } : {}) };
  };
  /** Redact first, then cut the retained window, so a boundary cannot split a value. */
  const guardText = { head: (value: string, maxBytes: number) => redactor.head(value, maxBytes), tail: (value: string, maxBytes: number) => redactor.tail(value, maxBytes) };
  /** Record a host rejection from any binding, so no origin is lost at the process boundary. */
  const hostBinding = <T>(work: (args: unknown) => Promise<T>): ((args: unknown) => Promise<T>) => async (args: unknown) => {
    try { return await work(args); } catch (error) { recordRootCause(error); throw error; }
  };
  const resolveValues = async () => {
    signal.throwIfAborted();
    const values = await variables.resolve(request.scope, request.capture.env);
    redactor.add(values);
    signal.throwIfAborted();
    return values;
  };
  const runBash = async (command: string, timeoutMs?: number, stdin?: string): Promise<ShellRunResult> => {
    signal.throwIfAborted();
    const env = await resolveValues();
    /** Every attempt of this call, so its settled failure explains its own retries. */
    const attempts: FailureAttempt[] = [];
    for (let attempt = 1; ; attempt += 1) {
      // A Stop must veto the next attempt immediately, even while native cleanup is
      // still draining: the graceful drain and the admission gate are separate signals.
      signal.throwIfAborted();
      request.signal.throwIfAborted();
      const started = Date.now();
      const spec = shell.resolve({ command: options.lifetime?.shell(command) ?? command, workdir: request.capture.executionDirectory, onExpiry: timeoutMs === undefined ? 'none' : 'kill', ...(timeoutMs === undefined ? {} : { timeoutMs }), sandboxPolicy: policy, stdoutMaxBytes: 256 * 1024, signal, stdin, env, dshEnv: {} });
      if (spec.onExpiry !== (timeoutMs === undefined ? 'none' : 'kill') || spec.stdoutMaxBytes < 256 * 1024 || spec.workdir !== request.capture.executionDirectory || !samePolicy(spec.sandboxPolicy, policy)) failure('BASH_LIFETIME_UNSUPPORTED', 'The native Bash executor changed the requested lifetime, directory, or policy.');
      const handle = await shell.execute(spec);
      let result: ShellRunResult;
      try {
        result = await handle.result();
      } finally {
        // The authenticated guard drains its owned tree and proves that quiescence;
        // killing it first would destroy that proof. Escalate only if it wedges.
        const escalation = signal.aborted ? setTimeout(() => { void handle.kill(); }, 5000) : undefined;
        try { await handle.done; } finally { if (escalation) clearTimeout(escalation); }
      }
      if (!options.lifetime || result.aborted || result.timedOut) return result;
      const outcome = readGuardOutcome(result, Date.now() - started, guardText);
      if (outcome.kind === 'command') return { ...result, stdout: { text: outcome.stdout, truncated: false }, stderr: { text: outcome.stderr, truncated: false } };
      attempts.push({ attempt, code: outcome.code, guard: outcome.facts });
      if (!outcome.retryable || attempt >= retry.attempts) failure(outcome.code, outcome.message, { attempts: [...attempts], guard: outcome.facts });
      await retry.wait(attempt, request.signal);
    }
  };
  const bash = (args: unknown): Promise<PtcJsonValue> => {
    const run = (async () => {
      if (!accepting) failure('EXECUTION_ENDED', 'This program no longer owns Bash work.');
      if (!args || typeof args !== 'object' || Array.isArray(args)) failure('BASH_ARGUMENTS', 'tools.bash expects {command, timeoutMs?}.');
      const object = args as Record<string, unknown>;
      if (Object.keys(object).some(key => !['command', 'timeoutMs'].includes(key)) || typeof object.command !== 'string' || !object.command || object.timeoutMs !== undefined && (typeof object.timeoutMs !== 'number' || !Number.isFinite(object.timeoutMs) || object.timeoutMs <= 0)) failure('BASH_ARGUMENTS', 'tools.bash accepts only command and an optional positive finite command timeoutMs.');
      const result = await runBash(object.command, object.timeoutMs as number | undefined);
      checkPolicyResult(result, policy);
      return commandFacts(result);
    })();
    pending.add(run);
    void run.then(() => pending.delete(run), () => pending.delete(run));
    return run;
  };
  try {
    signal.throwIfAborted();
    await resolveValues();
    let value: unknown;
    let logs: string[];
    if (request.capture.language === 'bash') {
      const result = await runBash(code, undefined, JSON.stringify(request.input));
      if (result.aborted || request.signal.aborted) return { kind: 'aborted' };
      checkPolicyResult(result, policy);
      if (result.timedOut || result.exitCode !== 0 || result.signal !== null) failure('BASH_FAILED', 'Standalone Bash must exit with status zero. ' + result.stderr.text);
      if (result.stdout.truncated || Buffer.byteLength(result.stdout.text) > COMPLETION_MAX_BYTES) failure('INVALID_COMPLETION', 'Standalone Bash completion was truncated or exceeds the output limit.');
      try { value = JSON.parse(result.stdout.text); } catch { failure('INVALID_COMPLETION', 'Standalone Bash stdout must contain exactly one JSON completion document.'); }
      logs = [result.stderr.text];
    } else {
      if (!runtime) failure('TYPESCRIPT_UNAVAILABLE', 'Mount the native TypeScript function-body runtime.');
      const bindings: PtcBindingNamespace[] = [
        { global: 'tools', functions: { bash: hostBinding(bash) } },
        { global: 'stepContext', functions: { read: hostBinding(async () => structuredClone(request.input)) } },
        { global: 'authorizedEnvironment', functions: { get: hostBinding(async (name: unknown) => {
          if (typeof name !== 'string' || !request.capture.env.includes(name)) failure('VARIABLE_UNAUTHORIZED', 'This variable name was not authorized in the reviewed capture.');
          return (await resolveValues())[name] ?? null;
        }) } },
      ];
      const result = await runtime.run(runtime.resolve({ program: (options.lifetime?.typescriptPrelude() ?? '') + TYPESCRIPT_PRELUDE + code, bindings, cwd: request.capture.executionDirectory, timeoutMs: null, sandboxPolicy: runtime.sandboxMode === undefined ? undefined : policy, signal }));
      if (request.signal.aborted || result.error?.kind === 'abort') return { kind: 'aborted' };
      checkPolicyResult(result, policy);
      if (result.error) failure('TYPESCRIPT_' + result.error.kind.toUpperCase().replaceAll('-', '_'), result.error.message);
      if (result.logs.reduce((sum, text) => sum + Buffer.byteLength(text), 0) > 64 * 1024) failure('OUTPUT_LIMIT', 'TypeScript diagnostics exceeded the bounded output limit.');
      value = result.value;
      logs = result.logs;
    }
    const completion = parseCompletion(value);
    if (!Object.hasOwn(request.capture.exits, completion.exit)) failure('UNMAPPED_EXIT', 'The returned exit is not present in the reviewed mapping.');
    return { kind: 'completed', completion: { exit: completion.exit, message: redactor.text(completion.message, COMPLETION_MAX_BYTES) }, diagnostics: [redactor.text(logs.join('\n'))].filter(Boolean) };
  } catch (error) {
    if (request.signal.aborted) return { kind: 'aborted' };
    const code = error instanceof DeterministicRuntimeError ? error.code : 'EXECUTOR_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof DeterministicRuntimeError ? error.detail : undefined;
    const cause = rootCause;
    // A program exception that only carried a host rejection is not the failure:
    // report the host cause and keep the exception as the nested detail.
    if (cause !== undefined && code !== cause.code && code.startsWith('TYPESCRIPT_')) {
      const details = redactor.details({ ...cause.detail, cause: { code, message } });
      return { kind: 'failed', diagnostic: { code: cause.code, message: redactor.text(cause.message), ...(details === undefined ? {} : { details }) } };
    }
    const details = redactor.details(detail);
    return { kind: 'failed', diagnostic: { code, message: redactor.text(message), ...(details === undefined ? {} : { details }) } };
  } finally {
    accepting = false;
    // Give the authenticated guards a chance to drain before native AbortSignal
    // kills their hosting process; otherwise a witness can disappear mid-cleanup.
    if (request.signal.aborted || pending.size > 0) await stopOwned().catch(() => {});
    controller.abort();
    await Promise.allSettled([...pending]);
    request.signal.removeEventListener('abort', abort);
  }
}
