import type { FailureOrigin } from '../shared/deterministic-failure.js';
import { neverRoutes } from './deterministic-failure.js';

/** The captured destination a settled failure may follow. */
export type FailureRoute = 'infrastructure' | 'error';

/**
 * The destination for one settled failure, or null to settle in the current stage.
 *
 * A configuration failure already names what a human must repair, and ownership
 * uncertainty forbids changing the context, so neither follows a route. Everything
 * else prefers the reserved infrastructure destination and falls back to error,
 * which keeps a stage that only maps error behaving exactly as it does today.
 */
export function settleFailureRoute(input: { code: string; origin: FailureOrigin; exits: readonly string[] }): FailureRoute | null {
  if (input.origin === 'configuration' || neverRoutes(input.code)) return null;
  if (input.origin === 'infrastructure' && input.exits.includes('infrastructure')) return 'infrastructure';
  return input.exits.includes('error') ? 'error' : null;
}
