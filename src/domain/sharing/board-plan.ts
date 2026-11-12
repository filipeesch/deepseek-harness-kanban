import { canonicalWorkflow } from '../schema-parts.js';
import { parseWorkflow } from '../workflow.js';
import type { SharingChangeSummary } from '../../shared/types.js';
import { summarizeChanges } from '../journal/summary.js';
import { deriveBoardChanges, sameScope } from '../journal/derive.js';
import type { LocalSharedBoard } from './projection.js';

/**
 * What one board looks like to the sharing rules.
 *
 * A board is decided on its own: the version this installation last applied, what the
 * last check observed, and the local board. Nothing here reads another board, so a
 * board that needs a decision cannot stop the rest.
 */

/** Display states shared with the client, one per board. */
export type BoardSharingState = 'in-sync' | 'draft' | 'updates-available' | 'needs-review' | 'update-required' | 'orphan';

/** One board as this installation knows it: the applied version and what was observed. */
export interface BoardMirrorView {
  /** The last sequence applied. */
  readonly cursor: number;
  /** Whether the storage enumerated this board's log at the last observation. */
  readonly present: boolean;
  /** The applied authored workflow. */
  readonly workflow: string | null;
  readonly name: string | null;
  readonly projectKeys: readonly string[] | null;
  readonly rank: string | null;
  /** Published events observed beyond the cursor. */
  readonly updates: number;
  /** The observed log carries a removal event this installation has not applied. */
  readonly removal: boolean;
  /** The team's text that could not be applied, while the board needs a choice. */
  readonly incoming: string | null;
  readonly conflict: 'identity' | 'lifecycle' | null;
  readonly problem: { readonly code: string; readonly message: string } | null;
}

export interface BoardEvaluationInput {
  readonly local: LocalSharedBoard;
  readonly mirror: BoardMirrorView | null;
  /** The board is recorded as removed by the team and this installation still holds it. */
  readonly orphaned: boolean;
  /** The position this board would publish; equal to the mirror's when it did not move. */
  readonly rank: string | null;
}

export interface BoardEvaluation {
  readonly boardId: string;
  readonly key?: string;
  readonly name: string;
  readonly state: BoardSharingState;
  /** The local board differs from the version this installation last applied. */
  readonly draft: boolean;
  /** Published events this installation has not applied. */
  readonly updates: number;
  readonly conflict: 'identity' | 'lifecycle' | null;
}

function sameWorkflow(left: string, right: string): boolean {
  try { return canonicalWorkflow(parseWorkflow(left)) === canonicalWorkflow(parseWorkflow(right)); }
  catch { return left === right; }
}

/**
 * Evaluate one board. The state names what the user has to do and the draft flag says
 * whether a publish is due. A bound board whose log is absent is a draft: with removal
 * carried by an event, absence only means the team has not received this board yet.
 */
export function evaluateBoard(input: BoardEvaluationInput): BoardEvaluation {
  const { local, mirror, orphaned, rank } = input;
  const base = { boardId: local.boardId, name: local.name };
  if (local.key === undefined) {
    return { ...base, state: orphaned ? 'orphan' : 'draft', draft: true, updates: 0, conflict: null };
  }
  const key = local.key;
  if (mirror?.problem != null) return { ...base, key, state: 'update-required', draft: false, updates: 0, conflict: null };
  if (mirror?.removal === true) return { ...base, key, state: 'orphan', draft: false, updates: Math.max(1, mirror.updates), conflict: null };
  if (mirror?.conflict != null) return { ...base, key, state: 'needs-review', draft: false, updates: mirror.updates, conflict: mirror.conflict };
  // Local work and team updates can coexist: the state names the blocking action, but
  // the draft flag still records that this installation has unpublished changes.
  const localDraft = mirror !== null && mirror.workflow !== null && (!sameWorkflow(local.workflow, mirror.workflow)
    || mirror.name !== local.name
    || !sameScope(mirror.projectKeys, local.projectKeys)
    || mirror.rank !== rank);
  if ((mirror?.updates ?? 0) > 0) return { ...base, key, state: 'updates-available', draft: localDraft, updates: mirror!.updates, conflict: null };
  if (mirror === null || mirror.workflow === null || mirror.present === false) return { ...base, key, state: 'draft', draft: true, updates: 0, conflict: null };
  const draft = !sameWorkflow(local.workflow, mirror.workflow)
    || mirror.name !== local.name
    || !sameScope(mirror.projectKeys, local.projectKeys)
    || mirror.rank !== rank;
  return { ...base, key, state: draft ? 'draft' : 'in-sync', draft, updates: 0, conflict: null };
}

/** The local stages that hold tasks and that the resulting workflow does not define. */
export function orphanedColumns(workflowText: string, local: LocalSharedBoard): string[] {
  let columns: Set<string>;
  try { columns = new Set(parseWorkflow(workflowText).columns.map(column => column.id)); }
  catch { return local.taskColumns.filter(entry => entry.tasks > 0).map(entry => entry.columnId); }
  return local.taskColumns.filter(entry => entry.tasks > 0 && !columns.has(entry.columnId)).map(entry => entry.columnId);
}

/**
 * The events that carry the difference between what this installation applied and the
 * local board. It is what a publish would append for a draft, and what a review shows
 * for a board that lags behind.
 */
export function boardChanges(input: { local: LocalSharedBoard; mirror: BoardMirrorView | null; rank: string | null }): SharingChangeSummary[] {
  const { local, mirror, rank } = input;
  if (mirror === null || mirror.workflow === null) return [{ kind: 'board.created' }];
  const changes = deriveBoardChanges(
    { workflow: mirror.workflow, name: mirror.name, projectKeys: mirror.projectKeys, rank: mirror.rank },
    { workflow: local.workflow, name: local.name, projectKeys: local.projectKeys, rank },
  );
  return summarizeChanges(changes);
}
