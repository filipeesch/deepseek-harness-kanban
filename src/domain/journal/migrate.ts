import type { JournalEvent } from './event.js';

/**
 * The stage identity renames one batch carries, in order.
 *
 * A rename is carried into the local board's tasks by the same transaction that
 * stores the resulting workflow, so the Hub never observes a task in a stage its
 * board does not define.
 */
export interface StageRename {
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

export function stageRenames(events: readonly JournalEvent[]): StageRename[] {
  const renames: StageRename[] = [];
  for (const event of events) {
    if (event.kind !== 'stage.id-changed') continue;
    if (event.from === event.id) continue;
    renames.push({ key: event.key, from: event.from, to: event.id });
  }
  return renames;
}

/** Every stage identifier a batch removes, so a caller can explain a refused application. */
export function removedStageKeys(events: readonly JournalEvent[]): string[] {
  return events.filter(event => event.kind === 'stage.removed').map(event => (event as Extract<JournalEvent, { kind: 'stage.removed' }>).key);
}
