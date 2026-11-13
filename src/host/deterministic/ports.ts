import type { PtcJsonValue, PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime';
import type { ShellExecutor } from '@deepseek-ai/dsh-shell';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { DeterministicCapture, DeterministicDefinition, DeterministicTarget, StepCompletion } from '../../shared/deterministic.js';
import type { Problem } from '../../shared/types.js';
import { classifyFailureCode } from '../../domain/deterministic-failure.js';

/** Approval, ownership, and variable scopes are deliberately distinct. */
export interface DeterministicApprovalScope { hubId: string; boardId: string; stageIdentity: string }
export interface DeterministicScope { hubId: string; boardId: string; projectId: string; stageIdentity: string }
export interface CaptureRequest {
  definition: DeterministicDefinition;
  projectDirectory: string;
  taskDirectory?: string;
  exits: Record<string, DeterministicTarget>;
  signal?: AbortSignal;
}
/** What one capture definition resolves to, before any bytes are stored. */
export interface CapturePlan {
  readonly content: Omit<DeterministicCapture, 'sourceRef' | 'fingerprint'>;
  readonly code: string;
  readonly fingerprint: string;
}
export interface DeterministicPolicyPort {
  directory(path: string, signal?: AbortSignal): Promise<string>;
  source(path: string, directory: string, signal?: AbortSignal): Promise<{ path: string; code: string }>;
  execution(directory: string, signal?: AbortSignal): Promise<SandboxExecutionPolicy>;
}
export interface DeterministicVariables {
  status(scope: DeterministicScope, names: readonly string[]): Promise<Array<{ name: string; configured: boolean }>>;
  set(scope: DeterministicScope, name: string, value: string): Promise<void>;
  remove(scope: DeterministicScope, name: string): Promise<void>;
  /** Host-only: never expose this operation through a client/remote interface. */
  resolve(scope: DeterministicScope, names: readonly string[]): Promise<Readonly<Record<string, string>>>;
}
export interface DeterministicTrust {
  isApproved(scope: DeterministicApprovalScope, fingerprint: string): Promise<boolean>;
  approve(scope: DeterministicApprovalScope, fingerprint: string): Promise<void>;
}
/** A failure keeps its diagnostics: the origin, the bounded facts, and the nested cause. */
export type ExecutionOutcome =
  | { kind: 'completed'; completion: StepCompletion; diagnostics: string[] }
  | { kind: 'failed'; diagnostic: Problem }
  | { kind: 'aborted' };
export interface ExecuteRequest {
  executionId?: string;
  taskId?: string;
  capture: DeterministicCapture;
  input: PtcJsonValue;
  /** Process ownership and variables remain project-scoped. */
  scope: DeterministicScope;
  /** Approval is board-and-stage scoped. */
  approvalScope: DeterministicApprovalScope;
  signal: AbortSignal;
}
export interface DeterministicRuntime {
  capture(request: CaptureRequest): Promise<DeterministicCapture>;
  /** Resolve one definition without storing it, so a report can name its fingerprint. */
  plan(request: CaptureRequest): Promise<CapturePlan>;
  loadCapture(capture: DeterministicCapture): Promise<string>;
  /** Rewrite a verified stored capture under the current version identity and pin its new immutable reference. */
  normalizeCapture(capture: DeterministicCapture, definition: DeterministicDefinition): Promise<DeterministicCapture>;
  /** Release the pin created by normalizeCapture after the task or owner adopts it. */
  releaseCapture(capture: DeterministicCapture): void;
  collectSources(referencedSourceRefs: readonly string[]): Promise<void>;
  releaseSource?(sourceRef: string): void;
  verify(capture: DeterministicCapture, signal?: AbortSignal): Promise<void>;
  /** Confirms provider-owned predecessor cleanup; never kills a process by bare PID. */
  reclaim(executionId: string): Promise<void>;
  reclaimTask?(scope: DeterministicScope, taskId: string): Promise<void>;
  execute(request: ExecuteRequest): Promise<ExecutionOutcome>;
  trust: DeterministicTrust;
  variables: DeterministicVariables;
}
export type NativePtcPort = Pick<PtcRuntime, 'language' | 'isolation' | 'programFormat' | 'retainsState' | 'sandboxMode' | 'resolve' | 'run'>;
export type NativeShellPort = Pick<ShellExecutor, 'sandboxMode' | 'resolve' | 'execute'>;
export class DeterministicRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: Record<string, unknown>) { super(message); this.name = 'DeterministicRuntimeError'; }
}
/** Raise one failure with the origin its code names, so no call site has to restate it. */
export function failure(code: string, message: string, detail?: Record<string, unknown>): never {
  throw new DeterministicRuntimeError(code, message, { origin: classifyFailureCode(code), ...(detail ?? {}) });
}
