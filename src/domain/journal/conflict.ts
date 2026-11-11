import { KanbanError } from '../../shared/errors.js';
import { parseWorkflow } from '../workflow.js';
import { materialize } from './materialize.js';
import type { JournalEvent } from './event.js';

/**
 * Apply a batch of board events to the authored workflow text.
 *
 * A batch is applied event by event. A difference of identity or of lifecycle is
 * not applied: the two installations disagree about what a stage is, and only the
 * user can decide. Every other failure is a defect in the event and is raised.
 */

export type BoardConflictKind = 'identity' | 'lifecycle';

export interface BoardConflict {
  readonly kind: BoardConflictKind;
  readonly event: JournalEvent;
  readonly message: string;
}

export type ApplyEventsResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly conflict: BoardConflict };

const IDENTITY_CODES: ReadonlySet<string> = new Set(['JOURNAL_IDENTITY_CONFLICT']);
const LIFECYCLE_CODES: ReadonlySet<string> = new Set(['JOURNAL_STAGE_MISSING', 'JOURNAL_GROUP_MISSING']);

/** The conflict one failure means, or null when the failure is not a divergence. */
export function conflictKindOf(error: unknown): BoardConflictKind | null {
  if (!(error instanceof KanbanError)) return null;
  if (IDENTITY_CODES.has(error.code)) return 'identity';
  if (LIFECYCLE_CODES.has(error.code)) return 'lifecycle';
  return null;
}

/** Apply the batch in order, stopping at the first divergence. */
export function applyEvents(text: string, events: readonly JournalEvent[]): ApplyEventsResult {
  let value = text;
  for (const event of events) {
    try {
      value = materialize(value, event);
      parseWorkflow(value);
    } catch (error) {
      const kind = conflictKindOf(error);
      if (kind === null) throw error;
      return { ok: false, conflict: { kind, event, message: error instanceof Error ? error.message : String(error) } };
    }
  }
  return { ok: true, text: value };
}
