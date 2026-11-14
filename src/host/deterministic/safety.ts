import type { StepCompletion } from '../../shared/deterministic.js';
import { bounded as boundText, boundedTail } from '../../shared/bounded.js';
import { redactExact, redactRecord } from '../../shared/redact.js';
import { COMPLETION_MAX_BYTES, validateCompletion } from '../../domain/deterministic-completion.js';
import { PARAMETER_LIMITS } from '../../domain/deterministic-definition.js';
import { failure } from './ports.js';

export { COMPLETION_MAX_BYTES };
export const SOURCE_MAX_BYTES = 128 * 1024;
export const DIAGNOSTIC_MAX_BYTES = 16 * 1024;
export function bounded(text: string, maxBytes = DIAGNOSTIC_MAX_BYTES): string {
  return boundText(text, maxBytes);
}
/** Exact-value protection, not a transformed-secret or network DLP boundary. */
export class SecretRedactor {
  private readonly values = new Set<string>();
  private bytes = 0;
  add(values: Readonly<Record<string, string>>): void {
    for (const value of Object.values(values)) {
      if (!value || this.values.has(value)) continue;
      if (value.includes('\0')) failure('REDACTION_VALUE_INVALID', 'Credential values cannot contain NUL bytes.');
      const size = Buffer.byteLength(value);
      if (this.values.size >= 512 || this.bytes + size > 1024 * 1024) failure('REDACTION_LIMIT', 'Credential rotation exceeded the bounded redaction budget; restart with a newly reviewed execution.');
      this.values.add(value); this.bytes += size;
    }
  }
  text(text: string, maxBytes = DIAGNOSTIC_MAX_BYTES): string {
    return bounded(redactExact(text, [...this.values]), maxBytes);
  }
  /** Redact one parameter value; a redaction that grows past the value bound becomes one marker. */
  parameter(text: string): string {
    const redacted = redactExact(text, [...this.values]);
    return redacted.length > PARAMETER_LIMITS.valueLength ? '[REDACTED]' : redacted;
  }
  /** The beginning of a stream after redaction, so a boundary cannot split a value. */
  head(text: string, maxBytes: number): string {
    return bounded(redactExact(text, [...this.values]), maxBytes);
  }
  /** The end of a stream after redaction, so a boundary cannot split a value. */
  tail(text: string, maxBytes: number): string {
    return boundedTail(redactExact(text, [...this.values]), maxBytes);
  }
  /** The same protection and bounds for a structured diagnostic detail. */
  details(value: unknown): Record<string, unknown> | undefined {
    return redactRecord(value, [...this.values]);
  }
}
export function parseCompletion(value: unknown): StepCompletion {
  const result = validateCompletion(value);
  if (!result.ok) failure(result.code, result.message);
  return result.completion;
}
export function validateVariableName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^DSH_/i.test(name)) failure('INVALID_VARIABLE', 'Execution variables must be POSIX names outside the managed DSH_ namespace.');
}
