import { randomUUID } from 'node:crypto';
import type { DeterministicCapture } from '../../shared/deterministic.js';
import { credentialStoreFromContext } from '../sharing/credentials.js';
import { DeterministicCaptureStore, createDeterministicTrust } from './capture.js';
import { createNativeDeterministicPolicy, optionalService } from './native-policy.js';
import { NativeExecutionOwnership, type OwnershipLease } from './ownership.js';
import { createNativeLifetime, type NativeLifetime } from './lifetime.js';
import { createDeterministicVariables } from './variables.js';
import { executeCapturedProgram, verifyExecutors } from './executor.js';
import type { DeterministicPolicyPort, DeterministicRuntime, ExecuteRequest, ExecutionOutcome, NativePtcPort, NativeShellPort } from './ports.js';
import { DeterministicRuntimeError, failure } from './ports.js';
import { bounded } from './safety.js';
export * from './ports.js';
export { createNativeDeterministicPolicy } from './native-policy.js';
export { SecretRedactor, parseCompletion } from './safety.js';

export interface DeterministicRuntimeOptions {
  context: unknown;
  privateDirectory: string;
  policy?: DeterministicPolicyPort;
}
/** Missing optional native services fail per script, not at conventional Kanban startup. */
export function createDeterministicRuntime(options: DeterministicRuntimeOptions): DeterministicRuntime {
  const policy = options.policy ?? createNativeDeterministicPolicy(options.context);
  const captures = new DeterministicCaptureStore(options.privateDirectory, policy);
  const trust = createDeterministicTrust(options.privateDirectory);
  const variables = createDeterministicVariables(() => credentialStoreFromContext(options.context));
  const ownership = new NativeExecutionOwnership(options.privateDirectory);
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
  const execute = async (request: ExecuteRequest): Promise<ExecutionOutcome> => {
    const key = request.executionId ?? randomUUID();
    if (active.has(key)) return { kind: 'failed', diagnostic: { code: 'OWNERSHIP_CONFLICT', message: 'This logical execution already has an owned native attempt.' } };
    const running = (async (): Promise<ExecutionOutcome> => {
      let release: OwnershipLease | undefined;
      let lifetime: NativeLifetime | undefined;
      try {
        request.signal.throwIfAborted();
        if (!await trust.isApproved(request.scope, request.capture.fingerprint)) failure('TRUST_REQUIRED', 'Review and explicitly approve this exact local executable version before execution.');
        const code = await captures.load(request.capture);
        const executionPolicy = await verify(request.capture, request.signal);
        lifetime = await createNativeLifetime({
          register: witness => release ? release.register(witness) : Promise.reject(new Error('Native resource lease was not admitted.')),
          settled: token => release ? release.settled(token) : Promise.reject(new Error('Native resource lease was not admitted.')),
        });
        release = await ownership.acquire(request.scope, key, request.taskId, lifetime.host);
        request.signal.throwIfAborted();
        const { shell, runtime } = services();
        if (!shell) failure('BASH_UNAVAILABLE', 'Mount the public native Bash executor.');
        return await executeCapturedProgram({ request, code, policy: executionPolicy, shell, runtime, variables, lifetime });
      } catch (error) {
        if (request.signal.aborted) return { kind: 'aborted' };
        return { kind: 'failed', diagnostic: { code: error instanceof DeterministicRuntimeError ? error.code : 'EXECUTOR_FAILED', message: bounded(error instanceof Error ? error.message : String(error)) } };
      } finally {
        try { await lifetime?.close(); await release?.(); }
        catch (error) { return { kind: 'failed', diagnostic: { code: 'OWNERSHIP_UNCERTAIN', message: bounded('Native cleanup could not confirm quiescence. ' + (error instanceof Error ? error.message : String(error))) } }; }
      }
    })();
    active.set(key, running);
    try { return await running; } finally { if (active.get(key) === running) active.delete(key); }
  };
  return {
    capture: request => captures.capture(request), loadCapture: capture => captures.load(capture), trust, variables, execute,
    collectSources: referenced => captures.collectSources(referenced),
    releaseSource: reference => captures.releaseSource(reference),
    async verify(capture, signal) { await captures.load(capture); await verify(capture, signal); },
    async reclaim(executionId) { await active.get(executionId); await ownership.reclaim(executionId); },
    async reclaimTask(scope, taskId) { await ownership.reclaimTask(scope, taskId); },
  };
}
