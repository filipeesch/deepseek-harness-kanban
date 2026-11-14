import { randomUUID } from 'node:crypto';
import type { DeterministicCapture } from '../../shared/deterministic.js';
import { credentialStoreFromContext } from '../sharing/credentials.js';
import { DeterministicCaptureStore, createDeterministicTrust } from './capture.js';
import { createNativeDeterministicPolicy, optionalService } from './native-policy.js';
import { NativeExecutionOwnership, type OwnershipLease } from './ownership.js';
import { clearGuardConfigurations, createNativeLifetime, type NativeLifetime } from './lifetime.js';
import { createProcessOwnership } from './process/index.js';
import { createDeterministicVariables } from './variables.js';
import { TYPESCRIPT_PRELUDE, executeCapturedProgram, verifyExecutors, verifyProgramRuntime } from './executor.js';
import { createBashRetry, type BashRetryOptions } from './retry.js';
import type { DeterministicPolicyPort, DeterministicRuntime, ExecuteRequest, ExecutionOutcome, NativePtcPort, NativeShellPort, SimulatedShellCall, SimulatedShellResponse, TestProgramOutcome, TestProgramRequest } from './ports.js';
import { DeterministicRuntimeError, failure } from './ports.js';
import { bounded, parseCompletion } from './safety.js';
import type { PtcBindingNamespace, PtcJsonValue } from '@deepseek-ai/dsh-ptc-runtime';
export * from './ports.js';
export { createNativeDeterministicPolicy } from './native-policy.js';
export { SecretRedactor, parseCompletion } from './safety.js';

/** How many simulated shell calls one test result lists before it counts the rest. */
const TEST_CALL_LIMIT = 50;
/** The longest command or match string one test result quotes back. */
const TEST_COMMAND_LIMIT = 200;
/** The bounded total of a test program's own diagnostics. */
const TEST_LOG_LIMIT = 64 * 1024;

export interface DeterministicRuntimeOptions {
  context: unknown;
  privateDirectory: string;
  policy?: DeterministicPolicyPort;
  /** Bounded repetition policy for a guarded Bash call; a test can shorten its waits. */
  retry?: BashRetryOptions;
  /** The built guard artifact; resolved next to the host bundle when absent. */
  guardPath?: string;
}
/** Missing optional native services fail per script, not at conventional Kanban startup. */
export function createDeterministicRuntime(options: DeterministicRuntimeOptions): DeterministicRuntime {
  const policy = options.policy ?? createNativeDeterministicPolicy(options.context);
  const captures = new DeterministicCaptureStore(options.privateDirectory, policy);
  const trust = createDeterministicTrust(options.privateDirectory);
  const variables = createDeterministicVariables(() => credentialStoreFromContext(options.context));
  const ownership = new NativeExecutionOwnership(options.privateDirectory);
  // The guard configuration is private to one run; a host that did not finish must
  // not leave the previous run's configuration behind.
  clearGuardConfigurations(options.privateDirectory);
  const processOwnership = createProcessOwnership();
  const retry = createBashRetry(options.retry ?? {});
  const active = new Map<string, Promise<ExecutionOutcome>>();
  const services = () => ({ shell: optionalService<NativeShellPort>(options.context, 'shell'), runtime: optionalService<NativePtcPort>(options.context, 'ptcRuntime') });
  const verify = async (capture: DeterministicCapture, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (await policy.directory(capture.executionDirectory, signal) !== capture.executionDirectory) failure('DIRECTORY_CHANGED', 'The captured directory no longer resolves to the reviewed execution identity.');
    const executionPolicy = await policy.execution(capture.executionDirectory, signal);
    const { shell, runtime } = services();
    verifyExecutors(shell, runtime, capture, executionPolicy, signal);
    return executionPolicy;
  };
  /**
   * Run one authored program against a simulated shell.
   *
   * This path never captures, approves, stores, routes, or touches a task: it is the
   * debug surface. The program body runs in the same fresh isolated function-body
   * runtime a real execution uses, while every shell command resolves against the
   * responses the caller declared; a command no response covers fails instead of
   * reaching the native shell.
   */
  const test = async (request: TestProgramRequest): Promise<TestProgramOutcome> => {
    const calls: SimulatedShellCall[] = [];
    let callsOmitted = 0;
    const record = (call: SimulatedShellCall): void => {
      if (calls.length < TEST_CALL_LIMIT) calls.push(call); else callsOmitted += 1;
    };
    try {
      request.signal.throwIfAborted();
      if (request.definition.language !== 'typescript') failure('TEST_LANGUAGE_UNSUPPORTED', 'A Bash program is the shell script itself; run it from a card to test it.');
      const { runtime } = services();
      if (!runtime) failure('TYPESCRIPT_UNAVAILABLE', 'Mount a fresh native TypeScript function-body runtime to test a program.');
      const answer = (command: string): SimulatedShellResponse | undefined =>
        request.responses.find(response => command.includes(response.match)) ?? request.defaultResponse;
      const bash = async (args: unknown): Promise<PtcJsonValue> => {
        const object = args as { command?: unknown } | null;
        if (object === null || typeof object !== 'object' || typeof object.command !== 'string' || object.command.length === 0) failure('BASH_ARGUMENTS', 'tools.bash expects {command}.');
        const command = bounded(object.command, TEST_COMMAND_LIMIT);
        const response = answer(object.command);
        if (response === undefined) {
          record({ command, matched: null, exitCode: 127 });
          failure('TEST_BASH_UNCOVERED', 'No simulated response covers this command: ' + command);
        }
        const exitCode = response.exitCode ?? 0;
        record({ command, matched: bounded(response.match, TEST_COMMAND_LIMIT), exitCode });
        return {
          exitCode, signal: null, timedOut: false, aborted: false,
          stdout: { text: bounded(response.stdout ?? ''), truncated: false },
          stderr: { text: bounded(response.stderr ?? ''), truncated: false },
        };
      };
      const bindings: PtcBindingNamespace[] = [
        { global: 'tools', functions: { bash: async (args: unknown) => bash(args) } },
        { global: 'stepContext', functions: { read: async () => structuredClone(request.input) } },
        { global: 'authorizedEnvironment', functions: { get: async () => null } },
      ];
      const executionPolicy = runtime.sandboxMode === undefined ? undefined : await policy.execution(request.directory, request.signal);
      // Agent-authored code runs with no approval here, so the runtime contract is the guard.
      verifyProgramRuntime(runtime, executionPolicy, request.directory, request.signal);
      const result = await runtime.run(runtime.resolve({
        program: TYPESCRIPT_PRELUDE + request.code, bindings, cwd: request.directory, timeoutMs: null,
        sandboxPolicy: executionPolicy, signal: request.signal,
      }));
      if (request.signal.aborted) return { kind: 'failed', diagnostic: { code: 'TEST_ABORTED', message: 'The test execution was cancelled.' }, calls, ...(callsOmitted === 0 ? {} : { callsOmitted }) };
      if (result.error) failure('TYPESCRIPT_' + result.error.kind.toUpperCase().replaceAll('-', '_'), result.error.message);
      const completion = parseCompletion(result.value);
      if (!Object.hasOwn(request.definition.exits, completion.exit)) failure('UNMAPPED_EXIT', 'The returned exit is not present in the authored exit mapping.');
      // A program that logs in a loop must not inflate the tool result this session reads.
      if (result.logs.reduce((sum, text) => sum + Buffer.byteLength(text), 0) > TEST_LOG_LIMIT) failure('OUTPUT_LIMIT', 'Test diagnostics exceeded the bounded output limit.');
      return { kind: 'completed', completion, calls, diagnostics: result.logs.map(text => bounded(text)), ...(callsOmitted === 0 ? {} : { callsOmitted }) };
    } catch (error) {
      return {
        kind: 'failed', calls, ...(callsOmitted === 0 ? {} : { callsOmitted }),
        diagnostic: {
          code: error instanceof DeterministicRuntimeError ? error.code : 'TEST_EXECUTION_FAILED',
          message: bounded(error instanceof Error ? error.message : String(error)),
          ...(error instanceof DeterministicRuntimeError && error.detail !== undefined ? { details: error.detail } : {}),
        },
      };
    }
  };
  const execute = async (request: ExecuteRequest): Promise<ExecutionOutcome> => {
    const key = request.executionId ?? randomUUID();
    if (active.has(key)) return { kind: 'failed', diagnostic: { code: 'OWNERSHIP_CONFLICT', message: 'This logical execution already has an owned native attempt.' } };
    const running = (async (): Promise<ExecutionOutcome> => {
      let release: OwnershipLease | undefined;
      let lifetime: NativeLifetime | undefined;
      let outcome: ExecutionOutcome;
      try {
        request.signal.throwIfAborted();
        if (!await trust.isApproved(request.approvalScope, request.capture.fingerprint)) failure('TRUST_REQUIRED', 'Review and explicitly approve this exact local executable version before execution.');
        const code = await captures.load(request.capture);
        const executionPolicy = await verify(request.capture, request.signal);
        lifetime = await createNativeLifetime({
          register: witness => release ? release.register(witness) : Promise.reject(new Error('Native resource lease was not admitted.')),
          settled: token => release ? release.settled(token) : Promise.reject(new Error('Native resource lease was not admitted.')),
          sweep: (marker, exclude) => processOwnership.sweep(marker, exclude),
          directory: options.privateDirectory,
          ...(options.guardPath === undefined ? {} : { guardPath: options.guardPath }),
        });
        release = await ownership.acquire(request.scope, key, request.taskId, lifetime.host);
        request.signal.throwIfAborted();
        const { shell, runtime } = services();
        if (!shell) failure('BASH_UNAVAILABLE', 'Mount the public native Bash executor.');
        outcome = await executeCapturedProgram({ request, code, policy: executionPolicy, shell, runtime, variables, lifetime, retry });
      } catch (error) {
        outcome = request.signal.aborted
          ? { kind: 'aborted' }
          : { kind: 'failed', diagnostic: {
            code: error instanceof DeterministicRuntimeError ? error.code : 'EXECUTOR_FAILED',
            message: bounded(error instanceof Error ? error.message : String(error)),
            ...(error instanceof DeterministicRuntimeError && error.detail !== undefined ? { details: error.detail } : {}),
          } };
      }
      try {
        await lifetime?.close();
        await release?.();
      } catch (error) {
        // Cleanup uncertainty is the settled failure, but it must not erase what the
        // execution had already found: the complete earlier diagnosis becomes the cause.
        const previous = outcome.kind === 'failed' ? outcome.diagnostic : undefined;
        const stopped = outcome.kind === 'aborted';
        const carried = previous?.details ?? {};
        const cause = previous !== undefined
          ? { code: previous.code, message: previous.message, ...(previous.details === undefined ? {} : { details: previous.details }) }
          : stopped ? { code: 'EXECUTION_ABORTED', message: 'The execution was stopped before cleanup was confirmed.' } : undefined;
        return { kind: 'failed', diagnostic: {
          code: 'OWNERSHIP_UNCERTAIN',
          message: bounded('Native cleanup could not confirm quiescence. ' + (error instanceof Error ? error.message : String(error))),
          details: {
            origin: 'infrastructure',
            ...(cause === undefined ? {} : { cause }),
            ...(carried.attempts === undefined ? {} : { attempts: carried.attempts }),
            ...(carried.guard === undefined ? {} : { guard: carried.guard }),
          },
        } };
      }
      return outcome;
    })();
    active.set(key, running);
    try { return await running; } finally { if (active.get(key) === running) active.delete(key); }
  };
  return {
    capture: request => captures.capture(request), plan: request => captures.plan(request), loadCapture: capture => captures.load(capture),
    normalizeCapture: (capture, definition) => captures.normalize(capture, definition), releaseCapture: capture => captures.releaseSource(capture.sourceRef), trust, variables, execute, test,
    collectSources: referenced => captures.collectSources(referenced),
    releaseSource: reference => captures.releaseSource(reference),
    async verify(capture, signal) { await captures.load(capture); await verify(capture, signal); },
    async reclaim(executionId) { await active.get(executionId); await ownership.reclaim(executionId); },
    async reclaimTask(scope, taskId) { await ownership.reclaimTask(scope, taskId); },
  };
}
