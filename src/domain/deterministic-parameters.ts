import type { DeterministicParameter } from '../shared/deterministic.js';
import { PARAMETER_LIMITS, PARAMETER_NAME } from './deterministic-definition.js';

/** UTF-8 byte length without depending on a Node-only global in the client bundle. */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The declared names in their authored order. */
export function declaredParameterNames(params: readonly DeterministicParameter[] | undefined): string[] {
  return (params ?? []).map(parameter => parameter.name);
}

export type ParameterValueResult = { ok: true; values: Record<string, string> } | { ok: false; message: string };

/**
 * Validate one value set against a declaration. Every declared name is required,
 * an undeclared name is refused, and the accepted bounds are enforced in one place
 * so the transition tool, admission, and the local repair command cannot disagree.
 */
export function validateParameterValues(declared: readonly string[], values: unknown): ParameterValueResult {
  if (values === undefined || values === null) {
    return { ok: false, message: declared.length === 0 ? 'This stage declares no parameters.' : 'Missing required parameter' + (declared.length === 1 ? '' : 's') + ': ' + declared.join(', ') + '.' };
  }
  if (typeof values !== 'object' || Array.isArray(values)) return { ok: false, message: 'Parameters must be a mapping of declared names to string values.' };
  const entries = Object.entries(values as Record<string, unknown>);
  const accepted = new Set(declared);
  const unknown = entries.map(([name]) => name).filter(name => !accepted.has(name));
  if (unknown.length > 0) {
    return { ok: false, message: 'Undeclared parameter' + (unknown.length === 1 ? '' : 's') + ': ' + unknown.join(', ') + '. Accepted names: ' + (declared.length === 0 ? 'none' : declared.join(', ')) + '.' };
  }
  const missing = declared.filter(name => typeof (values as Record<string, unknown>)[name] !== 'string' || ((values as Record<string, unknown>)[name] as string).length === 0);
  if (missing.length > 0) return { ok: false, message: 'Missing required parameter' + (missing.length === 1 ? '' : 's') + ': ' + missing.join(', ') + '.' };
  const result: Record<string, string> = {};
  let total = 0;
  for (const name of declared) {
    const value = (values as Record<string, string>)[name]!;
    if (value.length > PARAMETER_LIMITS.valueLength) return { ok: false, message: 'Parameter ' + name + ' exceeds ' + PARAMETER_LIMITS.valueLength + ' characters.' };
    total += utf8Length(name) + utf8Length(value);
    result[name] = value;
  }
  if (total > PARAMETER_LIMITS.totalBytes) return { ok: false, message: 'The parameter values exceed ' + PARAMETER_LIMITS.totalBytes + ' bytes.' };
  return { ok: true, values: result };
}

/** The declared names that have no usable value on this entry, in declaration order. */
export function missingParameterNames(declared: readonly string[], values: Readonly<Record<string, string>> | undefined): string[] {
  return declared.filter(name => typeof values?.[name] !== 'string' || values[name]!.length === 0);
}

/** Exactly the declared names with their entry values; an undeclared stored value is ignored. */
export function declaredParameterValues(declared: readonly string[], values: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of declared) {
    const value = values?.[name];
    if (typeof value === 'string' && value.length > 0) result[name] = value;
  }
  return result;
}

/** One value set as the durable schemas accept it: declared-shaped keys within the bounds. */
export function parameterValuesProblem(values: Readonly<Record<string, string>>): string | null {
  const names = Object.keys(values);
  if (names.length > PARAMETER_LIMITS.count) return 'At most ' + PARAMETER_LIMITS.count + ' parameters are supported.';
  let total = 0;
  for (const name of names) {
    if (!PARAMETER_NAME.test(name)) return 'A parameter name must be a safe identifier.';
    const value = values[name]!;
    if (typeof value !== 'string' || value.length === 0) return 'A parameter value must be nonempty text.';
    if (value.length > PARAMETER_LIMITS.valueLength) return 'A parameter value exceeds ' + PARAMETER_LIMITS.valueLength + ' characters.';
    total += utf8Length(name) + utf8Length(value);
  }
  if (total > PARAMETER_LIMITS.totalBytes) return 'The parameter values exceed ' + PARAMETER_LIMITS.totalBytes + ' bytes.';
  return null;
}
