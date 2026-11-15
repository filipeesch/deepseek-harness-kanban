import type { PtcJsonValue, PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime';
import type { ShellExecutor } from '@deepseek-ai/dsh-shell';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { ScriptedApprovalOrigin, ScriptedCapture, ScriptedDefinition, ScriptedTarget, StepCompletion } from '../../shared/scripted.js';
import type { Problem } from '../../shared/types.js';
import { classifyFailureCode } from '../../domain/scripted-failure.js';

/** Approval, ownership, and variable scopes are deliberately distinct. */
export interface ScriptedApprovalScope { hubId: string; boardId: string; stageIdentity: string }
export interface ScriptedScope { hubId: string; boardId: string; projectId: string; stageIdentity: string }
export interface CaptureRequest {
  definition: ScriptedDefinition;
  projectDirectory: string;
  taskDirectory?: string;
  exits: Record<string, ScriptedTarget>;
  signal?: AbortSignal;
}
/** What one capture definition resolves to, before any bytes are stored. */
export interface CapturePlan {
  readonly content: Omit<ScriptedCapture, 'sourceRef' | 'fingerprint'>;
  readonly code: string;
  readonly fingerprint: string;
}
export interface ScriptedPolicyPort {
  directory(path: string, signal?: AbortSignal): Promise<string>;
  source(path: string, directory: string, signal?: AbortSignal): Promise<{ path: string; code: string }>;
  execution(directory: string, signal?: AbortSignal): Promise<SandboxExecutionPolicy>;
}
export interface ScriptedVariables {
  status(scope: ScriptedScope, names: readonly string[]): Promise<Array<{ name: string; configured: boolean }>>;
  set(scope: ScriptedScope, name: string, value: string): Promise<void>;
  remove(scope: ScriptedScope, name: string): Promise<void>;
  /** Host-only: never expose this operation through a client/remote interface. */
  resolve(scope: ScriptedScope, names: readonly string[]): Promise<Readonly<Record<string, string>>>;
}
/** One recorded approval: where it came from, and when it was recorded. */
export interface ScriptedApprovalRecord {
  readonly origin: ScriptedApprovalOrigin;
  readonly approvedAt: string;
}
export interface ScriptedTrust {
  isApproved(scope: ScriptedApprovalScope, fingerprint: string): Promise<boolean>;
  /** The recorded approval of one version, or undefined when it was never approved. */
  approval(scope: ScriptedApprovalScope, fingerprint: string): Promise<ScriptedApprovalRecord | undefined>;
  approve(scope: ScriptedApprovalScope, fingerprint: string, origin: ScriptedApprovalOrigin): Promise<void>;
}
/** A failure keeps its diagnostics: the origin, the bounded facts, and the nested cause. */
export type ExecutionOutcome =
  | { kind: 'completed'; completion: StepCompletion; diagnostics: string[] }
  | { kind: 'failed'; diagnostic: Problem }
  | { kind: 'aborted' };
export interface ExecuteRequest {
  executionId?: string;
  taskId?: string;
  capture: ScriptedCapture;
  input: PtcJsonValue;
  /** Process ownership and variables remain project-scoped. */
  scope: ScriptedScope;
  /** Approval is board-and-stage scoped. */
  approvalScope: ScriptedApprovalScope;
  signal: AbortSignal;
}
export interface ScriptedRuntime {
  capture(request: CaptureRequest): Promise<ScriptedCapture>;
  /** Resolve one definition without storing it, so a report can name its fingerprint. */
  plan(request: CaptureRequest): Promise<CapturePlan>;
  loadCapture(capture: ScriptedCapture): Promise<string>;
  /** Rewrite a verified stored capture under the current version identity and pin its new immutable reference. */
  normalizeCapture(capture: ScriptedCapture, definition: ScriptedDefinition): Promise<ScriptedCapture>;
  /** Release the pin created by normalizeCapture after the task or owner adopts it. */
  releaseCapture(capture: ScriptedCapture): void;
  collectSources(referencedSourceRefs: readonly string[]): Promise<void>;
  releaseSource?(sourceRef: string): void;
  verify(capture: ScriptedCapture, signal?: AbortSignal): Promise<void>;
  /** Confirms provider-owned predecessor cleanup; never kills a process by bare PID. */
  reclaim(executionId: string): Promise<void>;
  reclaimTask?(scope: ScriptedScope, taskId: string): Promise<void>;
  execute(request: ExecuteRequest): Promise<ExecutionOutcome>;
  /** Run one authored program against a simulated shell; absent when the host cannot test. */
  test?(request: TestProgramRequest): Promise<TestProgramOutcome>;
  trust: ScriptedTrust;
  variables: ScriptedVariables;
}
export type NativePtcPort = Pick<PtcRuntime, 'language' | 'isolation' | 'programFormat' | 'retainsState' | 'sandboxMode' | 'resolve' | 'run'>;

/** One declared answer to a command a tested program may run. */
export interface SimulatedShellResponse {
  /** A substring the requested command must contain to take this answer. */
  readonly match: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}
/** One command a tested program ran, and the answer that resolved it. */
export interface SimulatedShellCall {
  readonly command: string;
  readonly matched: string | null;
  readonly exitCode: number;
}
/** Everything one isolated test execution needs; nothing here is durable. */
export interface TestProgramRequest {
  readonly definition: ScriptedDefinition;
  readonly code: string;
  readonly input: PtcJsonValue;
  readonly directory: string;
  readonly responses: readonly SimulatedShellResponse[];
  readonly defaultResponse?: SimulatedShellResponse;
  readonly signal: AbortSignal;
}
export type TestProgramOutcome =
  | { readonly kind: 'completed'; readonly completion: StepCompletion; readonly calls: readonly SimulatedShellCall[]; readonly callsOmitted?: number; readonly diagnostics: string[] }
  | { readonly kind: 'failed'; readonly diagnostic: Problem; readonly calls: readonly SimulatedShellCall[]; readonly callsOmitted?: number };
export type NativeShellPort = Pick<ShellExecutor, 'sandboxMode' | 'resolve' | 'execute'>;
export class ScriptedRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: Record<string, unknown>) { super(message); this.name = 'ScriptedRuntimeError'; }
}
/** Raise one failure with the origin its code names, so no call site has to restate it. */
export function failure(code: string, message: string, detail?: Record<string, unknown>): never {
  throw new ScriptedRuntimeError(code, message, { origin: classifyFailureCode(code), ...(detail ?? {}) });
}
