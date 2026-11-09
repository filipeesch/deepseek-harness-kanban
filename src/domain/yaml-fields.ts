import { KanbanError } from '../shared/errors.js';
import type { TransitionRule } from '../shared/types.js';
import { transitionRule } from './transition-rule.js';
import { isDomainId } from './validation.js';

/** Throws the code the authored workflow parsers report for an invalid document. */
export type InvalidField = (message: string) => never;

/** The workflow document's own rejection: every field problem uses the same code. */
export function invalidWorkflow(message: string): never {
  throw new KanbanError('INVALID_WORKFLOW', message);
}

/**
 * The small validation vocabulary shared by the authored workflow document and
 * its parts. Each helper reports through the caller's `invalid`, so a parser
 * that owns a different error code can reuse the same shape checks.
 */
export function createYamlFields(invalid: InvalidField) {
  function record(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(label + ' must be a mapping.');
    return value as Record<string, unknown>;
  }

  function keys(value: Record<string, unknown>, allowed: string[], label: string, note?: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) invalid('Unsupported ' + label + ' field: ' + key + '.' + (note === undefined ? '' : ' ' + note));
    }
  }

  function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) invalid(label + ' must be nonempty text.');
    return value.trim();
  }

  function id(value: unknown, label: string): string {
    if (!isDomainId(value)) invalid(label + ' must be a safe identifier.');
    return value;
  }

  function ids(value: unknown, context: string): string[] {
    if (!Array.isArray(value)) invalid(context + ' must be an array of column IDs.');
    const result = value.map((item, index) => id(item, context + '[' + index + ']'));
    if (new Set(result).size !== result.length) invalid(context + ' contains duplicate IDs.');
    return result;
  }

  /**
   * One transition entry: a bare target identifier, or a mapping with the target
   * and an optional condition. Both forms normalize to the same value.
   */
  function rule(value: unknown, context: string): TransitionRule {
    if (typeof value === 'string') return transitionRule(id(value, context));
    const map = record(value, context);
    keys(map, ['to', 'when'], context + ' transition');
    const to = id(map.to, context + ' target');
    if (map.when !== undefined && map.when !== null && typeof map.when !== 'string') invalid(context + ' condition must be text.');
    return transitionRule(to, typeof map.when === 'string' ? map.when : undefined);
  }

  function rules(value: unknown, context: string): TransitionRule[] {
    if (!Array.isArray(value)) invalid(context + ' must be an array of column IDs or transition mappings.');
    const result = value.map((item, index) => rule(item, context + '[' + index + ']'));
    if (new Set(result.map(entry => entry.to)).size !== result.length) invalid(context + ' contains duplicate IDs.');
    return result;
  }

  return { record, keys, text, id, ids, rules };
}
