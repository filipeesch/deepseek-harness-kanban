import { z } from 'zod';
import { applyEvents } from '../journal/conflict.js';
import { deriveChanges } from '../journal/derive.js';
import { appendEvents, createBoardLog, decodeBoardLog, encodeBoardLog, nextSequence, recoverBoard, type BoardLogFile } from '../journal/log.js';
import type { BoardChange, JournalEvent } from '../journal/event.js';
import { diffWorkflow } from '../workflow-difference.js';
import { parseWorkflow } from '../workflow.js';

/** The format this installation writes for a board's local revision log. */
export const REVISION_LOG_VERSION = 1;
/** How many revisions one board keeps before the oldest fold into the snapshot. */
export const RETAINED_REVISIONS = 100;

/** Where a revision came from. */
export type RevisionOrigin = 'editor' | 'tool' | 'team';

/** Who authored a revision. */
export type RevisionActor =
  | { readonly kind: 'operator' }
  | { readonly kind: 'agent'; readonly sessionId: string }
  | { readonly kind: 'team'; readonly source: string };

/** One accepted write: the events it appended, who made it, and what it changed. */
export interface RevisionCommit {
  /** The first event sequence this write appended. */
  readonly from: number;
  /** The last event sequence this write appended; the revision's identity. */
  readonly to: number;
  readonly at: string;
  readonly actor: RevisionActor;
  readonly origin: RevisionOrigin;
  readonly summary: string;
}

/** One board's local revision log: the same snapshot and events the journal uses, plus commits. */
export interface BoardRevisionLog {
  readonly hubId: string;
  readonly boardId: string;
  readonly board: BoardLogFile;
  readonly commits: readonly RevisionCommit[];
  /** Revisions folded out of the log since it was created. */
  readonly dropped: number;
}

/** A log for a board that has never been written beyond its current document. */
export function createRevisionLog(input: { readonly hubId: string; readonly boardId: string; readonly text: string }): BoardRevisionLog {
  return {
    hubId: input.hubId,
    boardId: input.boardId,
    board: createBoardLog(input.text),
    commits: [],
    dropped: 0,
  };
}

/** The document the log currently describes. */
export function headText(log: BoardRevisionLog): string {
  const recovered = recoverBoard(log.board, null);
  return recovered.ok ? recovered.text : log.board.snapshot.text;
}

/** The document as it stood after the given revision, when the log still holds it. */
export function textAtRevision(log: BoardRevisionLog, seq: number): string | undefined {
  if (!Number.isInteger(seq) || seq < log.board.snapshot.seq) return undefined;
  if (seq > headSequence(log)) return undefined;
  const applied = applyEvents(log.board.snapshot.text, log.board.events.filter(event => event.seq <= seq));
  return applied.ok ? applied.text : undefined;
}

/** The sequence of the last event the log holds. */
export function headSequence(log: BoardRevisionLog): number {
  return log.board.events.reduce((highest, event) => Math.max(highest, event.seq), log.board.snapshot.seq);
}

/**
 * The applied changes that reproduce the new document byte for byte.
 *
 * The differ may rewrite authored text, for example when it writes a stable
 * stage key into a recreated block. A local log must replay to exactly what was
 * saved, so a derived set that does not is replaced by one whole-document event.
 */
function exactChanges(previous: string, changes: readonly BoardChange[], text: string, at: string): readonly BoardChange[] {
  try {
    const replayed = applyEvents(previous, changes.map((change, index) => ({ ...change, seq: index, at, v: 2 }) as JournalEvent));
    return replayed.ok && replayed.text === text ? changes : [{ kind: 'workflow.replaced', text }];
  } catch {
    return [{ kind: 'workflow.replaced', text }];
  }
}

/** One bounded sentence describing what a revision changed. */
export function describeChange(previous: string, next: string): string {
  try {
    const difference = diffWorkflow(parseWorkflow(previous), parseWorkflow(next));
    const counts = { added: 0, removed: 0, changed: 0 };
    for (const stage of difference.stages) counts[stage.change] += 1;
    const parts: string[] = [];
    const stages = (count: number, verb: string) => { if (count > 0) parts.push(verb + ' ' + count + ' stage' + (count === 1 ? '' : 's')); };
    stages(counts.added, 'added');
    stages(counts.removed, 'removed');
    stages(counts.changed, 'changed');
    const layout = difference.stages.some(stage => stage.fields?.some(field => field.field === 'position' || field.field === 'size')) || difference.connections.length > 0;
    if (layout) parts.push('layout changed');
    if (difference.groups.length > 0) parts.push('groups changed');
    if (difference.workflow.length > 0) parts.push('workflow settings changed');
    return parts.length === 0 ? 'The authored text changed without a semantic difference.' : parts.join(', ');
  } catch {
    return 'The workflow document was replaced.';
  }
}

function prune(log: BoardRevisionLog): BoardRevisionLog {
  const excess = log.commits.length - RETAINED_REVISIONS;
  if (excess <= 0) return log;
  const dropped = log.commits.slice(0, excess);
  const boundary = dropped[dropped.length - 1]!.to;
  const folded = applyEvents(log.board.snapshot.text, log.board.events.filter(event => event.seq <= boundary));
  if (!folded.ok) return log;
  return {
    ...log,
    board: { version: log.board.version, snapshot: { text: folded.text, seq: boundary }, events: log.board.events.filter(event => event.seq > boundary) },
    commits: log.commits.slice(excess),
    dropped: log.dropped + excess,
  };
}

/** Append one accepted write to the log, folding the oldest revisions past the bound. */
export function appendRevision(log: BoardRevisionLog, input: { readonly text: string; readonly at: string; readonly actor: RevisionActor; readonly origin: RevisionOrigin }): BoardRevisionLog {
  const previous = headText(log);
  if (previous === input.text) return log;
  const from = nextSequence(log.board);
  const changes = exactChanges(previous, deriveChanges({ text: previous }, { text: input.text }), input.text, input.at);
  const board = appendEvents(log.board, changes, input.at);
  const commit: RevisionCommit = { from, to: from + changes.length - 1, at: input.at, actor: input.actor, origin: input.origin, summary: describeChange(previous, input.text) };
  return prune({ ...log, board, commits: [...log.commits, commit] });
}

const actorSchema = z.union([
  z.strictObject({ kind: z.literal('operator') }),
  z.strictObject({ kind: z.literal('agent'), sessionId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('team'), source: z.string().min(1) }),
]);
const commitSchema = z.strictObject({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  at: z.string().min(1),
  actor: actorSchema,
  origin: z.enum(['editor', 'tool', 'team']),
  summary: z.string().min(1),
});

/**
 * One revision log as storage writes it. The nested board log keeps the
 * journal's own envelope, so a board with executable stages is written with the
 * version that grammar requires.
 */
export const encodedRevisionLogSchema = z.strictObject({
  version: z.literal(REVISION_LOG_VERSION),
  hubId: z.string().min(1),
  boardId: z.string().min(1),
  dropped: z.number().int().nonnegative(),
  board: z.unknown(),
  commits: z.array(commitSchema),
});
export type EncodedRevisionLog = z.infer<typeof encodedRevisionLogSchema>;

/** Read one stored revision log, or undefined when the record is not one this installation understands. */
export function decodeRevisionLog(raw: unknown): BoardRevisionLog | undefined {
  const parsed = encodedRevisionLogSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const decoded = decodeBoardLog(parsed.data.board);
  if (!decoded.ok) return undefined;
  return { hubId: parsed.data.hubId, boardId: parsed.data.boardId, board: decoded.log, commits: parsed.data.commits, dropped: parsed.data.dropped };
}

/** One stored revision log, validated and decoded into the journal's own shape. */
export const revisionLogSchema: z.ZodType<BoardRevisionLog> = encodedRevisionLogSchema.transform((value, context) => {
  const decoded = decodeBoardLog(value.board);
  if (!decoded.ok) {
    context.addIssue({ code: 'custom', path: ['board'], message: 'The board log this revision log carries is invalid.' });
    return z.NEVER;
  }
  return { hubId: value.hubId, boardId: value.boardId, board: decoded.log, commits: value.commits, dropped: value.dropped };
});

/** Serialize one revision log as the storage domain stores it. */
export function encodeRevisionLog(log: BoardRevisionLog): EncodedRevisionLog {
  return { version: REVISION_LOG_VERSION, hubId: log.hubId, boardId: log.boardId, dropped: log.dropped, board: encodeBoardLog(log.board), commits: log.commits.map(commit => ({ ...commit })) };
}