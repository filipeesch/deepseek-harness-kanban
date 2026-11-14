import type { StepCompletion } from '../shared/deterministic.js';
import { PARAMETER_NAME } from './deterministic-definition.js';
import { parameterValuesProblem } from './deterministic-parameters.js';

/**
 * The whole completion document bound. The executor and the supervisor share it,
 * so a value accepted by one is accepted by the other.
 */
export const COMPLETION_MAX_BYTES = 32 * 1024;

export type CompletionValidation =
  | { readonly ok: true; readonly completion: StepCompletion }
  | { readonly ok: false; readonly code: 'INVALID_COMPLETION'; readonly message: string };

function invalid(message: string): CompletionValidation {
  return { ok: false, code: 'INVALID_COMPLETION', message };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * One completion contract for every executor and the supervisor: exactly an exit,
 * a message, and an optional bounded params map. The map is rejected as a whole
 * when malformed, so a partial value set can never bind to a destination entry.
 */
export function validateCompletion(value: unknown): CompletionValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('Return an object with exit, message, and an optional params object.');
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return invalid('Completion must be a lossless JSON object.');
  }
  if (encoded === undefined) return invalid('Completion is missing or cannot be serialized.');
  if (utf8Length(encoded) > COMPLETION_MAX_BYTES) return invalid('Completion exceeds the completion byte limit.');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const hasParams = Object.hasOwn(record, 'params');
  const allowed = hasParams ? ['exit', 'message', 'params'] : ['exit', 'message'];
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) return invalid('Return only a nonempty exit name, a nonempty message, and an optional params object.');
  if (typeof record.exit !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(record.exit)) return invalid('Return a safe nonempty exit name.');
  if (typeof record.message !== 'string' || !record.message.trim()) return invalid('Return a nonempty message.');
  let params: Record<string, string> | undefined;
  if (hasParams) {
    const raw = record.params;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return invalid('The params field must be an object of nonempty string values.');
    const values = raw as Record<string, unknown>;
    const names = Object.keys(values);
    if (names.some(name => !PARAMETER_NAME.test(name))) return invalid('Every parameter name in params must be a safe identifier.');
    if (names.some(name => typeof values[name] !== 'string' || (values[name] as string).length === 0)) return invalid('Every value in params must be a nonempty string.');
    const problem = parameterValuesProblem(values as Record<string, string>);
    if (problem !== null) return invalid(problem);
    if (names.length > 0) params = Object.fromEntries(names.map(name => [name, values[name] as string]));
  }
  return { ok: true, completion: { exit: record.exit, message: record.message, ...(params === undefined ? {} : { params }) } };
}
