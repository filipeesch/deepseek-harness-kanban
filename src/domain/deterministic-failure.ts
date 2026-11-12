import { bounded, utf8Length } from '../shared/bounded.js';
import { FAILURE_ORIGINS, GUARD_ADMISSIONS, type FailureAttempt, type FailureCause, type FailureDetail, type FailureOrigin, type GuardAdmission, type GuardFacts } from '../shared/deterministic-failure.js';

/** The accepted size of one diagnostic detail map. */
export const FAILURE_DETAIL_MAX_BYTES = 16 * 1024;
const ATTEMPT_MAX = 8;
const HEAD_MAX_BYTES = 256;
const TAIL_MAX_BYTES = 512;
// A cause message is bounded after redaction, so the bound is generous enough not
// to cut the redaction marker itself.
const CAUSE_MAX_BYTES = 1024;

/**
 * The origin of every failure code the deterministic execution path can raise.
 *
 * A code that is absent is a host failure the product does not know yet, so it is
 * labelled `infrastructure` — the honest "this is not the work" answer — instead of
 * blaming the program for a defect in the host.
 */
const ORIGINS: Readonly<Record<string, FailureOrigin>> = {
  // The captured program did or returned something of its own.
  BASH_ARGUMENTS: 'script',
  BASH_FAILED: 'script',
  TYPESCRIPT_EXCEPTION: 'script',
  UNMAPPED_EXIT: 'script',
  // The program ran, but its completion violated the required shape or size.
  INVALID_COMPLETION: 'contract',
  OUTPUT_LIMIT: 'contract',
  TYPESCRIPT_INVALID_OUTPUT: 'contract',
  TYPESCRIPT_OUTPUT_LIMIT: 'contract',
  // The host failed while the program was running.
  BASH_PROTOCOL: 'infrastructure',
  OUTPUT_TRANSPORT_LIMIT: 'infrastructure',
  EXECUTOR_FAILED: 'infrastructure',
  EXECUTION_ENDED: 'infrastructure',
  EXECUTION_ABORTED: 'infrastructure',
  TYPESCRIPT_TIMEOUT: 'infrastructure',
  TYPESCRIPT_WORKER_EXIT: 'infrastructure',
  TYPESCRIPT_PROTOCOL: 'infrastructure',
  TYPESCRIPT_ABORT: 'infrastructure',
  OWNERSHIP_UNAVAILABLE: 'infrastructure',
  OWNERSHIP_UNCERTAIN: 'infrastructure',
  OWNERSHIP_CONFLICT: 'infrastructure',
  EXECUTION_OWNERSHIP_UNCERTAIN: 'infrastructure',
  // The execution could not be attempted as configured.
  TRUST_REQUIRED: 'configuration',
  TRUST_UNAVAILABLE: 'configuration',
  TRUST_CORRUPT: 'configuration',
  PARAMETERS_REQUIRED: 'configuration',
  EXECUTION_CONTEXT_CHANGED: 'configuration',
  DIRECTORY_CHANGED: 'configuration',
  DIRECTORY_INVALID: 'configuration',
  PROJECT_DIRECTORY_REQUIRED: 'configuration',
  CAPTURE_MISSING: 'configuration',
  CAPTURE_CORRUPT: 'configuration',
  CAPTURE_NOT_READY: 'configuration',
  SOURCE_INVALID: 'configuration',
  LANGUAGE_UNSUPPORTED: 'configuration',
  ROUTES_INVALID: 'configuration',
  INVALID_VARIABLE: 'configuration',
  INVALID_SCOPE: 'configuration',
  INVALID_PARAMETERS: 'configuration',
  VARIABLE_MISSING: 'configuration',
  VARIABLE_UNAUTHORIZED: 'configuration',
  VARIABLE_UNAVAILABLE: 'configuration',
  VARIABLE_SCOPE_INVALID: 'configuration',
  CREDENTIALS_UNAVAILABLE: 'configuration',
  FILESYSTEM_UNAVAILABLE: 'configuration',
  REDACTION_LIMIT: 'configuration',
  REDACTION_VALUE_INVALID: 'configuration',
  BASH_UNAVAILABLE: 'configuration',
  GUARD_UNAVAILABLE: 'configuration',
  BASH_LIFETIME_UNSUPPORTED: 'configuration',
  TYPESCRIPT_UNAVAILABLE: 'configuration',
  TYPESCRIPT_FORMAT_UNSUPPORTED: 'configuration',
  TYPESCRIPT_LIFETIME_UNSUPPORTED: 'configuration',
  TYPESCRIPT_SANDBOX_UNAVAILABLE: 'configuration',
  POLICY_UNAVAILABLE: 'configuration',
  POLICY_UNSUPPORTED: 'configuration',
  POLICY_DENIED: 'configuration',
  POLICY_INCOMPLETE: 'configuration',
  SANDBOX_DENIED: 'configuration',
  SANDBOX_UNAVAILABLE: 'configuration',
};

/** The origin used when a code is not in the table. */
export const DEFAULT_FAILURE_ORIGIN: FailureOrigin = 'infrastructure';

/**
 * Ownership uncertainty is a host failure that must never choose a destination:
 * until cleanup is proven, the context cannot be changed safely.
 */
const NEVER_ROUTED: ReadonlySet<string> = new Set(['OWNERSHIP_UNCERTAIN', 'OWNERSHIP_CONFLICT', 'OWNERSHIP_UNAVAILABLE', 'EXECUTION_OWNERSHIP_UNCERTAIN']);

/** The origin of one failure code. */
export function classifyFailureCode(code: string): FailureOrigin {
  return Object.hasOwn(ORIGINS, code) ? ORIGINS[code]! : DEFAULT_FAILURE_ORIGIN;
}

/** Whether a code must settle in place even when a destination was captured. */
export function neverRoutes(code: string): boolean {
  return NEVER_ROUTED.has(code);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readOrigin(value: unknown): FailureOrigin | undefined {
  return typeof value === 'string' && (FAILURE_ORIGINS as readonly string[]).includes(value) ? value as FailureOrigin : undefined;
}

function readCause(value: unknown): FailureCause | undefined {
  const object = record(value);
  if (!object || typeof object.code !== 'string' || typeof object.message !== 'string') return undefined;
  const details = record(object.details);
  return { code: object.code, message: bounded(object.message, TAIL_MAX_BYTES), ...(details === undefined ? {} : { details }) };
}

function readAdmission(value: unknown): GuardAdmission | undefined {
  return typeof value === 'string' && (GUARD_ADMISSIONS as readonly string[]).includes(value) ? value as GuardAdmission : undefined;
}

function readGuard(value: unknown): GuardFacts | undefined {
  const object = record(value);
  const admission = object && readAdmission(object.admission);
  if (!object || admission === undefined) return undefined;
  const number = (item: unknown, fallback: number): number => typeof item === 'number' && Number.isFinite(item) ? item : fallback;
  const text = (item: unknown): string => typeof item === 'string' ? item : '';
  const signal = typeof object.signal === 'string' ? object.signal : null;
  const exitCode = typeof object.exitCode === 'number' && Number.isFinite(object.exitCode) ? object.exitCode : null;
  return {
    admission, exitCode, signal,
    timedOut: object.timedOut === true, aborted: object.aborted === true,
    elapsedMs: Math.max(0, number(object.elapsedMs, 0)),
    stdoutBytes: Math.max(0, number(object.stdoutBytes, 0)), stdoutHead: bounded(text(object.stdoutHead), HEAD_MAX_BYTES),
    stderrBytes: Math.max(0, number(object.stderrBytes, 0)), stderrTail: bounded(text(object.stderrTail), TAIL_MAX_BYTES),
  };
}

function readAttempt(value: unknown, index: number): FailureAttempt | undefined {
  const object = record(value);
  if (!object || typeof object.code !== 'string') return undefined;
  const guard = readGuard(object.guard);
  return { attempt: typeof object.attempt === 'number' && Number.isFinite(object.attempt) ? object.attempt : index + 1, code: object.code, ...(guard === undefined ? {} : { guard }) };
}

/**
 * The typed view of a diagnostic detail map, or undefined when the record predates
 * this vocabulary. A malformed member is dropped instead of failing the read, so an
 * older or partially written record still presents what it can.
 */
export function failureDetail(value: unknown): FailureDetail | undefined {
  const object = record(value);
  const origin = object && readOrigin(object.origin);
  if (!object || !origin) return undefined;
  const detail: FailureDetail = { origin };
  const cause = readCause(object.cause);
  if (cause !== undefined) detail.cause = cause;
  const guard = readGuard(object.guard);
  if (guard !== undefined) detail.guard = guard;
  if (Array.isArray(object.attempts)) {
    const attempts = object.attempts.slice(0, ATTEMPT_MAX).map(readAttempt).filter((item): item is FailureAttempt => item !== undefined);
    if (attempts.length > 0) detail.attempts = attempts;
  }
  return detail;
}

function guardValues(facts: GuardFacts): Record<string, unknown> {
  return {
    admission: facts.admission, exitCode: facts.exitCode, signal: facts.signal,
    timedOut: facts.timedOut, aborted: facts.aborted, elapsedMs: facts.elapsedMs,
    stdoutBytes: facts.stdoutBytes, stdoutHead: bounded(facts.stdoutHead, HEAD_MAX_BYTES),
    stderrBytes: facts.stderrBytes, stderrTail: bounded(facts.stderrTail, TAIL_MAX_BYTES),
  };
}

/**
 * The bounded detail map a diagnostic persists. The accepted byte budget is
 * enforced here: when the full map would exceed it, the attempt facts are dropped
 * before the root cause and the top-level guard facts, which explain more per byte.
 */
export function failureDetailValues(detail: FailureDetail): Record<string, unknown> {
  const cause = detail.cause === undefined ? undefined : {
    code: detail.cause.code,
    message: bounded(detail.cause.message, CAUSE_MAX_BYTES),
    ...(detail.cause.details === undefined ? {} : { details: detail.cause.details }),
  };
  const guard = detail.guard === undefined ? undefined : guardValues(detail.guard);
  const attempts = detail.attempts === undefined || detail.attempts.length === 0 ? undefined : detail.attempts.slice(0, ATTEMPT_MAX).map((attempt, index) => ({
    attempt: index + 1, code: attempt.code, ...(attempt.guard === undefined ? {} : { guard: guardValues(attempt.guard) }),
  }));
  const base = { origin: detail.origin, ...(cause === undefined ? {} : { cause }), ...(guard === undefined ? {} : { guard }) };
  const full = { ...base, ...(attempts === undefined ? {} : { attempts }) };
  const within = (value: unknown): boolean => utf8Length(JSON.stringify(value)) <= FAILURE_DETAIL_MAX_BYTES;
  if (within(full)) return full;
  if (within(base)) return base;
  // A single oversized nested cause must not defeat the budget: drop its own detail,
  // then keep only what still explains the failure.
  const shallowCause = detail.cause === undefined ? undefined : { code: detail.cause.code, message: bounded(detail.cause.message, CAUSE_MAX_BYTES) };
  const withoutCauseDetail = { origin: detail.origin, ...(shallowCause === undefined ? {} : { cause: shallowCause }), ...(guard === undefined ? {} : { guard }) };
  return within(withoutCauseDetail) ? withoutCauseDetail : { origin: detail.origin };
}
