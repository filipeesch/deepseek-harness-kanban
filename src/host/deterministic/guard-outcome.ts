import type { ShellRunResult } from '@deepseek-ai/dsh-shell';
import type { GuardAdmission, GuardFacts } from '../../shared/deterministic-failure.js';

const HEAD_MAX_BYTES = 256;
const TAIL_MAX_BYTES = 512;
const NOT_ADMITTED_STATUS = 125;

/** The bounded, redacted windows the diagnostic keeps from each stream. */
export interface GuardText {
  head(text: string, maxBytes: number): string;
  tail(text: string, maxBytes: number): string;
}

/** What one guarded Bash call produced: the command's output, or why there is none. */
export type GuardOutcome =
  | { kind: 'command'; stdout: string; stderr: string }
  | { kind: 'failure'; code: 'BASH_PROTOCOL' | 'OUTPUT_LIMIT' | 'OUTPUT_TRANSPORT_LIMIT' | 'GUARD_UNAVAILABLE'; message: string; facts: GuardFacts; retryable: boolean };

/**
 * The guard printed one of these instead of a result envelope. An unproven tree means
 * the command ran, so it is an infrastructure failure; a guard that cannot start at all
 * is a configuration failure, because the execution could not be attempted as configured.
 */
const GUARD_DIAGNOSTICS: ReadonlyArray<{ marker: string; admission: GuardAdmission; code: 'BASH_PROTOCOL' | 'GUARD_UNAVAILABLE'; message: string }> = [
  { marker: 'NATIVE_LIFETIME_UNCLEAN:', admission: 'started', code: 'BASH_PROTOCOL', message: 'The isolated Bash guard could not prove that the command process tree was stopped.' },
  { marker: 'NATIVE_LIFETIME_UNAVAILABLE:', admission: 'not-admitted', code: 'GUARD_UNAVAILABLE', message: 'The isolated Bash guard is unavailable in the execution world.' },
  { marker: 'NATIVE_LIFETIME_UNSUPPORTED:', admission: 'not-admitted', code: 'GUARD_UNAVAILABLE', message: 'The isolated Bash guard does not support this platform.' },
];

/**
 * The observable facts of one guard process. The streams are measured in full and
 * then redacted before the retained window is cut, so a secret that crosses the
 * window boundary is redacted as the whole value instead of surviving as a fragment.
 */
export function guardFacts(result: ShellRunResult, elapsedMs: number, admission: GuardAdmission, text: GuardText): GuardFacts {
  const stdout = result.stdout.text;
  const stderr = result.stderr.text;
  return {
    admission,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutHead: text.head(stdout, HEAD_MAX_BYTES),
    stderrBytes: Buffer.byteLength(stderr),
    stderrTail: text.tail(stderr, TAIL_MAX_BYTES),
  };
}

function failure(code: 'BASH_PROTOCOL' | 'OUTPUT_LIMIT' | 'OUTPUT_TRANSPORT_LIMIT' | 'GUARD_UNAVAILABLE', message: string, facts: GuardFacts, retryable: boolean): GuardOutcome {
  return { kind: 'failure', code, message, facts, retryable };
}

/**
 * The guard's own words after its diagnostic marker, bounded and redacted. The fixed
 * sentence explains the class of failure; this explains this particular one, so an
 * operator does not have to reproduce it.
 */
function diagnosticReason(stderr: string, marker: string, text: GuardText): string {
  const index = stderr.indexOf(marker);
  if (index < 0) return '';
  return text.head(stderr.slice(index + marker.length).split('\n', 1)[0]!.trim(), 160);
}

/**
 * Only the complete absence of evidence proves that the command never started:
 * no byte on either stream, no lossy capture, the guard's admission status, and no
 * signal, timeout, or abort that would explain the silence. Every other failure may
 * have run the command, so the host must not repeat it.
 */
function neverStarted(result: ShellRunResult): boolean {
  return result.exitCode === NOT_ADMITTED_STATUS && result.signal === null && !result.timedOut && !result.aborted
    && result.stdout.text.length === 0 && !result.stdout.truncated
    && result.stderr.text.length === 0 && !result.stderr.truncated;
}

/**
 * Read one guarded Bash call. A decoded envelope is the command's output; anything
 * else is a classified guard failure that carries the facts an operator needs.
 */
export function readGuardOutcome(result: ShellRunResult, elapsedMs: number, text: GuardText): GuardOutcome {
  const stderr = result.stderr.text;
  if (result.stdout.truncated) return failure('OUTPUT_TRANSPORT_LIMIT', 'The guarded shell output exceeded the transport limit.', guardFacts(result, elapsedMs, 'unknown', text), false);
  const diagnostic = GUARD_DIAGNOSTICS.find(entry => stderr.includes(entry.marker));
  const terminated = result.signal === null ? undefined : 'The isolated Bash guard was terminated by ' + result.signal + ' without returning a result.';
  const admission: GuardAdmission = diagnostic?.admission ?? (terminated !== undefined ? 'unknown' : neverStarted(result) ? 'not-admitted' : 'unknown');
  const facts = guardFacts(result, elapsedMs, admission, text);
  let envelope: unknown;
  try { envelope = JSON.parse(result.stdout.text); }
  catch {
    if (diagnostic !== undefined) {
      const reason = diagnosticReason(stderr, diagnostic.marker, text);
      return failure(diagnostic.code, reason.length > 0 ? diagnostic.message + ' ' + reason : diagnostic.message, facts, false);
    }
    if (terminated !== undefined) return failure('BASH_PROTOCOL', terminated, facts, false);
    // A shell that cannot find the guard exited before the guard could report; no
    // command ran, and repeating the call cannot make the artifact appear.
    if (result.exitCode === 126 || result.exitCode === 127) return failure('GUARD_UNAVAILABLE', 'The native execution world could not start the isolated Bash guard (exit ' + result.exitCode + ').', facts, false);
    const message = admission === 'not-admitted'
      ? 'The isolated Bash guard returned no result and no diagnostic output (exit status 125).'
      : 'The isolated Bash guard did not return a valid result' + (result.exitCode === null ? '' : ' (exit ' + result.exitCode + ')') + '.';
    return failure('BASH_PROTOCOL', message, facts, neverStarted(result));
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return failure('BASH_PROTOCOL', 'The isolated Bash guard returned an invalid result.', facts, false);
  const value = envelope as Record<string, unknown>;
  if (value.overflow === true) return failure('OUTPUT_LIMIT', 'The script exceeded its bounded stdout or stderr limit.', facts, false);
  if (value.overflow !== false || typeof value.stdout !== 'string' || typeof value.stderr !== 'string') return failure('BASH_PROTOCOL', 'The isolated Bash guard returned invalid output.', facts, false);
  return { kind: 'command', stdout: value.stdout, stderr: value.stderr };
}
