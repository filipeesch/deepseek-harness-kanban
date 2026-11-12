import type { BoardChange } from '../../src/domain/journal/event.js';
import { appendEvents, encodeBoardLog, type BoardLog } from '../../src/domain/journal/log.js';

const AT = '2026-01-01T00:00:00.000Z';

/** A board log that establishes its workflow, plus any identity events a test needs. */
export function genesisLog(text: string, extras: readonly BoardChange[] = []): BoardLog {
  return appendEvents([], [{ kind: 'workflow.replaced', text }, ...extras], AT);
}

/** One board log file as a storage keeps it. */
export function exportBoardLogFixture(text: string): string {
  return encodeBoardLog(genesisLog(text));
}
