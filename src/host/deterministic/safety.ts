import type { StepCompletion } from '../../shared/deterministic.js';
import { failure } from './ports.js';

export const SOURCE_MAX_BYTES = 128 * 1024;
export const COMPLETION_MAX_BYTES = 32 * 1024;
export const DIAGNOSTIC_MAX_BYTES = 16 * 1024;
export function bounded(text: string, maxBytes = DIAGNOSTIC_MAX_BYTES): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  const marker = '\n[output truncated]';
  if (maxBytes <= marker.length) return marker.slice(0, Math.max(0, maxBytes));
  const prefix = new TextDecoder().decode(bytes.subarray(0, maxBytes - marker.length), { stream: true });
  return prefix + marker;
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
    // NUL cannot occur in a resolved credential, so markers cannot be recursively remasked.
    for (const secret of [...this.values].sort((a, b) => b.length - a.length)) text = text.split(secret).join('\0');
    return bounded(text.replaceAll('\0', '[REDACTED]'), maxBytes);
  }
}
export function parseCompletion(value: unknown): StepCompletion {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { failure('INVALID_COMPLETION', 'Completion must be a lossless JSON object.'); }
  if (encoded === undefined || Buffer.byteLength(encoded) > COMPLETION_MAX_BYTES) failure('INVALID_COMPLETION', 'Completion is missing or exceeds the completion byte limit.');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) failure('INVALID_COMPLETION', 'Return exactly {exit, message}.');
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== 2 || typeof object.exit !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(object.exit) || typeof object.message !== 'string' || !object.message.trim()) failure('INVALID_COMPLETION', 'Return only a nonempty exit name and nonempty message.');
  return { exit: object.exit as string, message: object.message as string };
}
export function validateVariableName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^DSH_/i.test(name)) failure('INVALID_VARIABLE', 'Execution variables must be POSIX names outside the managed DSH_ namespace.');
}
