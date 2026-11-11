import type { SharedBoardEntry } from './manifest.js';
import { canonicalWorkflow } from '../schema-parts.js';
import { parseWorkflow } from '../workflow.js';
import { recoverBoard, type BoardLogFile } from '../journal/log.js';

/**
 * What one board looks like to the sharing rules.
 *
 * A board is decided on its own: its published entry, its own log, and the local
 * board. Nothing here reads another board, so a board that needs a decision cannot
 * stop the rest.
 */

/** Display states shared with the client, one per board. */
export type BoardSharingState = 'in-sync' | 'draft' | 'updates-available' | 'needs-review' | 'orphan';

/** What applying this board's unseen events would do. */
export type BoardApplyOutcome =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'applies'; readonly events: number; readonly text: string }
  | { readonly kind: 'conflict'; readonly conflict: 'identity' | 'lifecycle'; readonly message: string };

export interface LocalBoardView {
  readonly boardId: string;
  readonly name: string;
  readonly workflow: string;
  /** Absent means the board allows every project; an empty list closes it. */
  readonly projectKeys?: readonly string[];
  readonly tasks: number;
  readonly taskColumns: ReadonlyArray<{ readonly columnId: string; readonly tasks: number }>;
}

export interface BoardEvaluationInput {
  /** The published entry, or undefined when this board is not published. */
  readonly entry: SharedBoardEntry | undefined;
  readonly local: LocalBoardView;
  /** The board's published log, or null when it has none yet. */
  readonly log: BoardLogFile | null;
  /** The last sequence this installation applied. */
  readonly cursor: number;
}

export interface BoardEvaluation {
  readonly boardId: string;
  readonly key?: string;
  readonly name: string;
  readonly state: BoardSharingState;
  /** What applying this board's unseen events would do, without applying it. */
  readonly apply: BoardApplyOutcome;
  /** The published board differs from the local board after applying, so a publish is due. */
  readonly draft: boolean;
  /** True when applying would leave a local task in a stage the published workflow does not define. */
  readonly refuses: boolean;
  /** Published content differs from local content, for a review panel. */
  readonly difference: { readonly local: string; readonly published: string } | null;
}

function sameWorkflow(left: string, right: string): boolean {
  try { return canonicalWorkflow(parseWorkflow(left)) === canonicalWorkflow(parseWorkflow(right)); }
  catch { return left === right; }
}

/** The workflow the published log currently describes. */
export function publishedWorkflow(log: BoardLogFile | null): string | null {
  if (log === null) return null;
  const recovered = recoverBoard(log, null);
  return recovered.ok ? recovered.text : null;
}

/**
 * Evaluate one board. The state names what the user has to do, the apply outcome
 * says what applying would do, and the draft flag says whether a publish is due.
 */
export function evaluateBoard(input: BoardEvaluationInput): BoardEvaluation {
  const base = { boardId: input.local.boardId, name: input.local.name };
  if (input.entry === undefined) {
    // A local board the published configuration does not name is a draft for a new
    // board, or an orphan once the team removed it; the caller knows which.
    return { ...base, state: 'draft', apply: { kind: 'nothing' }, draft: true, refuses: false, difference: null };
  }
  const key = input.entry.key;
  if (input.log === null) {
    return { ...base, key, state: 'updates-available', apply: { kind: 'nothing' }, draft: true, refuses: false, difference: null };
  }

  const recovered = recoverBoard(input.log, { text: input.local.workflow, cursor: input.cursor });
  if (!recovered.ok) {
    return {
      ...base, key, state: 'needs-review',
      apply: { kind: 'conflict', conflict: recovered.conflict.kind, message: recovered.conflict.message },
      draft: false, refuses: false, difference: null,
    };
  }

  const published = publishedWorkflow(input.log);
  const draft = published === null ? true : !sameWorkflow(recovered.text, published);
  const applied = recovered.events > 0;
  const state: BoardSharingState = applied ? 'updates-available' : draft ? 'draft' : 'in-sync';
  const refuses = applied && wouldOrphanTasks(recovered.text, input.local);
  return {
    ...base, key, state,
    apply: applied ? { kind: 'applies', events: recovered.events, text: recovered.text } : { kind: 'nothing' },
    draft,
    refuses,
    difference: published === null ? null : { local: input.local.workflow, published },
  };
}

/** The local stages that hold tasks and that the resulting workflow does not define. */
export function orphanedColumns(workflowText: string, local: LocalBoardView): string[] {
  let columns: Set<string>;
  try { columns = new Set(parseWorkflow(workflowText).columns.map(column => column.id)); }
  catch { return local.taskColumns.filter(entry => entry.tasks > 0).map(entry => entry.columnId); }
  return local.taskColumns.filter(entry => entry.tasks > 0 && !columns.has(entry.columnId)).map(entry => entry.columnId);
}

/** True when the resulting workflow would leave a local task in a stage it does not define. */
export function wouldOrphanTasks(workflowText: string, local: LocalBoardView): boolean {
  return orphanedColumns(workflowText, local).length > 0;
}
