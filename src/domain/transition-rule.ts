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

/**
 * Whether a stored destination set equals a wanted one: `undefined` permits any
 * stage and `null` wants that, while an array is compared entry by entry with
 * normalized conditions. Both surfaces that edit destinations share this check,
 * so "unchanged" means the same thing in the stage editor and in the diagram.
 */
export function sameTransitionRules(stored: readonly TransitionRule[] | undefined, wanted: readonly TransitionRule[] | null): boolean {
  if (stored === undefined || wanted === null) return (stored === undefined) && (wanted === null);
  if (stored.length !== wanted.length) return false;
  return stored.every((rule, index) => {
    const other = wanted[index];
    return other !== undefined
      && rule.to === other.to
      && transitionRule(rule.to, rule.when).when === transitionRule(other.to, other.when).when;
  });
}
