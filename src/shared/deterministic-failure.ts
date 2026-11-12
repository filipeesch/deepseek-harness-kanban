import type { Problem } from './types.js';

/** Who is responsible for a settled deterministic failure. */
export const FAILURE_ORIGINS = ['script', 'contract', 'infrastructure', 'configuration'] as const;
export type FailureOrigin = (typeof FAILURE_ORIGINS)[number];

/** How one origin reads to a person and to a model. */
export const FAILURE_ORIGIN_LABELS: Readonly<Record<FailureOrigin, string>> = {
  script: 'script',
  contract: 'completion',
  infrastructure: 'infrastructure',
  configuration: 'configuration',
};

/** Whether the guard proved that it started the command before it stopped reporting. */
export const GUARD_ADMISSIONS = ['not-admitted', 'started', 'unknown'] as const;
export type GuardAdmission = (typeof GUARD_ADMISSIONS)[number];

/** The bounded facts the host observed about one guarded Bash attempt. */
export interface GuardFacts {
  admission: GuardAdmission;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  elapsedMs: number;
  stdoutBytes: number;
  /** Bounded beginning of what the guard wrote on stdout, already redacted. */
  stdoutHead: string;
  stderrBytes: number;
  /** Bounded end of what the guard wrote on stderr, already redacted. */
  stderrTail: string;
}

/** One attempt of a host call the host repeated. */
export interface FailureAttempt {
  attempt: number;
  code: string;
  /** Absent only in a record written before the guard facts were captured. */
  guard?: GuardFacts;
}

/** The nested failure a diagnostic reports beside the root cause it settled on. */
export interface FailureCause {
  code: string;
  message: string;
  /** The nested diagnostic's own bounded detail, so a layered failure keeps its facts. */
  details?: Record<string, unknown>;
}

/** What a deterministic diagnostic carries beyond its code and message. */
export interface FailureDetail {
  origin: FailureOrigin;
  cause?: FailureCause;
  attempts?: FailureAttempt[];
  guard?: GuardFacts;
}

/** The diagnostic one settled deterministic failure produces. */
export type FailureDiagnostic = Problem;
