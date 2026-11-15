import type { ProcessOwnership } from './types.js';

/**
 * Ownership for a process that cannot read the process table itself. The proof comes
 * from the one party that can read it, over that party's authenticated channel.
 */
export function createDelegatedOwnership(request: (marker: string) => Promise<void>): ProcessOwnership {
  // The delegate owns the process table, so it also owns which pids are excluded.
  return { sweep: marker => request(marker) };
}
