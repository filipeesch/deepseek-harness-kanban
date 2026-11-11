import type { TransitionRule } from '../../shared/types.js';

/** One stage's authored destinations; null means the stage permits any other stage. */
export type DestinationSet = readonly TransitionRule[] | null;

function authored(rules: DestinationSet): TransitionRule[] {
  return (rules ?? []).map(rule => ({ ...rule }));
}

/**
 * Add a destination the stage did not author. A stage that authored no destinations,
 * or none at all, ends up permitting exactly the drawn one; a stage that authored a
 * set keeps it, with its conditions, and gains the new destination in authored order.
 */
export function withDestination(rules: DestinationSet, to: string): TransitionRule[] {
  const next = authored(rules);
  if (next.some(rule => rule.to === to)) return next;
  if (rules === null || next.length === 0) return [{ to }];
  return [...next, { to }];
}

/**
 * Point one authored destination at another stage, keeping its condition and its
 * position. When the stage already authors the new destination, the moved entry is
 * dropped instead of authoring the pair twice.
 */
export function replacingDestination(rules: DestinationSet, from: string, to: string): TransitionRule[] {
  const next = authored(rules);
  const index = next.findIndex(rule => rule.to === from);
  if (index < 0) return next.some(rule => rule.to === to) ? next : [...next, { to }];
  const duplicate = next.some((rule, position) => rule.to === to && position !== index);
  if (duplicate) {
    next.splice(index, 1);
    return next;
  }
  const moved = next[index]!;
  next[index] = moved.when === undefined ? { to } : { to, when: moved.when };
  return next;
}

/** Remove one authored destination. Removing the last one leaves the stage permitting none. */
export function withoutDestination(rules: DestinationSet, to: string): TransitionRule[] {
  return authored(rules).filter(rule => rule.to !== to);
}

/**
 * Add a destination to the stage that receives a moved transition, carrying the
 * condition the moved rule had. A destination the receiver already authors keeps its
 * own condition, so moving a transition never rewrites one that was already there.
 */
export function withMovedDestination(rules: DestinationSet, to: string, moved: TransitionRule): TransitionRule[] {
  const next = authored(rules);
  if (next.some(rule => rule.to === to)) return next;
  const entry: TransitionRule = moved.when === undefined ? { to } : { to, when: moved.when };
  if (rules === null || next.length === 0) return [entry];
  return [...next, entry];
}

/**
 * Author or clear one destination's condition, adding the destination when the stage
 * does not author it yet. A blank condition removes it, so an empty field and a
 * destination that never carried one mean the same thing.
 */
export function withCondition(rules: DestinationSet, to: string, when: string | null): TransitionRule[] {
  const condition = typeof when === 'string' ? when.trim() : '';
  return withDestination(rules, to).map(rule => {
    if (rule.to !== to) return rule;
    return condition.length === 0 ? { to } : { to, when: condition };
  });
}
