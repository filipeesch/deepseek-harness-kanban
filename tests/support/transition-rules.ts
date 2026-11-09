import type { TransitionRule } from '../../src/shared/types.js';

/** Shorthand for a configured transition list in test fixtures. */
export function transitions(...targets: string[]): TransitionRule[] {
  return targets.map(to => ({ to }));
}
