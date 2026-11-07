import { KanbanError } from '../../shared/errors.js';

/**
 * The compare-verify contract shared by every storage that cannot offer an
 * atomic conditional write. The caller reads a token, decides, writes, and
 * verifies; these two checks are the only places that decide whether the
 * decision was still valid.
 */

/** Refuse a write whose base token no longer matches the current document. */
export function assertExpectedToken(expected: string | null, actual: string | null): void {
  if (expected === actual) return;
  throw new KanbanError('SHARING_STALE_TOKEN', 'The team document changed since it was read. Get the team updates before publishing.', { expected: expected ?? 'none', actual: actual ?? 'none' });
}

/** Report a concurrent write when the stored content differs from what was written. */
export function assertWrittenToken(expected: string, actual: string): void {
  if (expected === actual) return;
  throw new KanbanError('SHARING_CONCURRENT_WRITE', 'Another member wrote the team document during this synchronization. Review the team changes before retrying.', { expected, actual });
}
