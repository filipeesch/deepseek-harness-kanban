import type { TransitionRule } from '../shared/types.js';

/**
 * Normalize one authored transition. The condition is trimmed, and a blank one is
 * dropped so an entry with an empty condition and an entry without one mean the
 * same thing to every reader.
 */
export function transitionRule(to: string, when?: string | null): TransitionRule {
  const condition = typeof when === 'string' ? when.trim() : '';
  return condition.length > 0 ? { to, when: condition } : { to };
}
