import { z } from 'zod';
import { applyEvents } from '../journal/conflict.js';
import { deriveChanges } from '../journal/derive.js';
import { appendEvents, decodeBoardLog, encodeBoardLog, lastSequence, replay, type BoardLog } from '../journal/log.js';
import type { BoardChange, JournalEvent } from '../journal/event.js';
import { diffWorkflow } from '../workflow-difference.js';
import { parseWorkflow } from '../workflow.js';

/** The format this installation writes for a board's local revision log. */
export const REVISION_LOG_VERSION = 2;
/** Every format version this installation can read; a record outside it is unreadable, never absent. */
export const REVISION_LOG_COMPATIBLE_VERSIONS: readonly number[] = [1, 2];
/** How many revisions one board keeps before the oldest fold into the checkpoint. */
export const RETAINED_REVISIONS = 100;

/** Where a board's retained history starts. */
export type RevisionBaselineKind = 'created' | 'recovered';
/** The moment and the kind of event a board's history starts at. */
export interface RevisionBaseline {
  readonly kind: RevisionBaselineKind;
  readonly at: string;
}

/** Where a revision came from. */
export type RevisionOrigin = 'editor' | 'tool' | 'team' | 'recovery';

/** Who authored a revision. */
export type RevisionActor =
  | { readonly kind: 'operator' }
  | { readonly kind: 'agent'; readonly sessionId: string }
  | { readonly kind: 'team'; readonly source: string };

/** One accepted write: the events it appended, who made it, and what it changed. */
export interface RevisionCommit {
  /** The first event sequence this write appended. */
  readonly from: number;
  /** The last event sequence this write appended. Never a revision identity. */
  readonly to: number;
  readonly at: string;
  readonly actor: RevisionActor;
  readonly origin: RevisionOrigin;
  readonly summary: string;
}

/** One board's local revision log: the journal log plus the commits that wrote it. */
export interface BoardRevisionLog {
  readonly hubId: string;
  readonly boardId: string;
  readonly log: BoardLog;
  readonly commits: readonly RevisionCommit[];
  /** Revisions folded out of the log since it was created. */
  readonly dropped: number;
  /** Where this history starts; a log written before baselines existed reads as created. */
  readonly baseline?: RevisionBaseline;
}

/**
 * A revision's identity: its position in the board's whole history.
 *
 * It is derived from how many revisions were folded out and the commit's position,
 * so folding never renumbers a retained revision: the sequence a caller read stays
 * the same document for as long as the log retains it.
 */
export function revisionOf(log: BoardRevisionLog, index: number): number {
  return log.dropped + index + 1;
}

/** The commit one revision identity names, when the log still retains it. */
export function commitOf(log: BoardRevisionLog, revision: number): RevisionCommit | undefined {
  const index = revision - log.dropped - 1;
  return Number.isInteger(index) && index >= 0 ? log.commits[index] : undefined;
}

/** A log for a board's current document, as its first checkpoint. */
export function createRevisionLog(input: {
  readonly hubId: string;
  readonly boardId: string;
  readonly text: string;
  readonly at: string;
  readonly baseline?: RevisionBaseline;
}): BoardRevisionLog {
  return {
    hubId: input.hubId,
    boardId: input.boardId,
    log: appendEvents([], [{ kind: 'workflow.replaced', text: input.text }], input.at),
    commits: [],
    dropped: 0,
    ...(input.baseline === undefined ? {} : { baseline: input.baseline }),
  };
}

/** The document the log currently describes. */
export function headText(log: BoardRevisionLog): string {
  const recovered = replay(log.log, null);
  if (recovered.ok) return recovered.text;
  const checkpoint = log.log[log.log.length - 1];
  return checkpoint !== undefined && checkpoint.kind === 'workflow.replaced' ? checkpoint.text : '';
}

/** The sequence of the last event the log holds, or -1 when it holds none. */
export function headSequence(log: BoardRevisionLog): number {
  return lastSequence(log.log);
}

/** The document as it stood after the given journal sequence, when the log holds it. */
export function textAtSequence(log: BoardRevisionLog, seq: number): string | undefined {
  if (!Number.isInteger(seq) || seq < 0 || seq > headSequence(log)) return undefined;
  const prefix = log.log.filter(event => event.seq <= seq);
  if (prefix.length === 0) return undefined;
  const recovered = replay(prefix, null);
  return recovered.ok ? recovered.text : undefined;
}

/** The document as it stood after the given revision, when the log retains it. */
export function textAtRevision(log: BoardRevisionLog, revision: number): string | undefined {
  const commit = commitOf(log, revision);
  return commit === undefined ? undefined : textAtSequence(log, commit.to);
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

/** Fold the oldest revisions into a fresh checkpoint, keeping every retained revision identity. */
function prune(log: BoardRevisionLog): BoardRevisionLog {
  const excess = log.commits.length - RETAINED_REVISIONS;
  if (excess <= 0) return log;
  const dropped = log.commits.slice(0, excess);
  const boundary = dropped[dropped.length - 1]!.to;
  const text = textAtSequence(log, boundary);
  const checkpoint = log.log.find(event => event.seq === boundary);
  if (text === undefined || checkpoint === undefined) return log;
  const retained = log.log.filter(event => event.seq > boundary).map((event, index) => ({ ...event, seq: index + 1 }));
  const shifted = log.commits.slice(excess).map(commit => ({ ...commit, from: commit.from - boundary, to: commit.to - boundary }));
  return {
    ...log,
    log: [...appendEvents([], [{ kind: 'workflow.replaced', text }], checkpoint.at), ...retained],
    commits: shifted,
    dropped: log.dropped + excess,
  };
}

/** Append one accepted write to the log, folding the oldest revisions past the bound. */
export function appendRevision(log: BoardRevisionLog, input: { readonly text: string; readonly at: string; readonly actor: RevisionActor; readonly origin: RevisionOrigin }): BoardRevisionLog {
  const previous = headText(log);
  if (previous === input.text) return log;
  const from = lastSequence(log.log) + 1;
  const changes = exactChanges(previous, deriveChanges({ text: previous }, { text: input.text }), input.text, input.at);
  const next = appendEvents(log.log, changes, input.at);
  const commit: RevisionCommit = { from, to: from + changes.length - 1, at: input.at, actor: input.actor, origin: input.origin, summary: describeChange(previous, input.text) };
  return prune({ ...log, log: next, commits: [...log.commits, commit] });
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
  origin: z.enum(['editor', 'tool', 'team', 'recovery']),
  summary: z.string().min(1),
});
const baselineSchema = z.strictObject({ kind: z.enum(['created', 'recovered']), at: z.string().min(1) });

/** One revision log as storage writes it. The board log keeps the journal's own JSONL envelope. */
export const encodedRevisionLogSchema = z.strictObject({
  version: z.number().int().positive(),
  hubId: z.string().min(1),
  boardId: z.string().min(1),
  dropped: z.number().int().nonnegative(),
  board: z.string().min(1),
  commits: z.array(commitSchema),
  /** The format versions this writer can read, so a reader can tell a future record apart. */
  formatVersions: z.array(z.number().int().positive()).optional(),
  baseline: baselineSchema.optional(),
});
export type EncodedRevisionLog = z.infer<typeof encodedRevisionLogSchema>;

/**
 * Read one stored revision log.
 *
 * A record this installation can read answers with its log; a record written in a
 * future format answers undefined, and the reader must report it as unreadable
 * instead of treating the board as having no history.
 */
export function decodeRevisionLog(raw: unknown): BoardRevisionLog | undefined {
  const parsed = encodedRevisionLogSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  if (!REVISION_LOG_COMPATIBLE_VERSIONS.includes(parsed.data.version)) return undefined;
  const decoded = decodeBoardLog(parsed.data.board);
  if (!decoded.ok) return undefined;
  const first = parsed.data.commits[0];
  return {
    hubId: parsed.data.hubId,
    boardId: parsed.data.boardId,
    log: decoded.log,
    commits: parsed.data.commits,
    dropped: parsed.data.dropped,
    // A record written before baselines existed can only prove where its history starts.
    baseline: parsed.data.baseline ?? { kind: 'created', at: first?.at ?? new Date(0).toISOString() },
  };
}

/** One stored revision log, validated and decoded into the journal's own shape. */
export const revisionLogSchema: z.ZodType<BoardRevisionLog> = encodedRevisionLogSchema.transform((value, context) => {
  if (!REVISION_LOG_COMPATIBLE_VERSIONS.includes(value.version)) {
    context.addIssue({ code: 'custom', path: ['version'], message: 'The revision log was written in a format this installation cannot read.' });
    return z.NEVER;
  }
  const decoded = decodeBoardLog(value.board);
  if (!decoded.ok) {
    context.addIssue({ code: 'custom', path: ['board'], message: 'The board log this revision log carries is invalid.' });
    return z.NEVER;
  }
  const first = value.commits[0];
  return {
    hubId: value.hubId, boardId: value.boardId, log: decoded.log, commits: value.commits, dropped: value.dropped,
    baseline: value.baseline ?? { kind: 'created', at: first?.at ?? new Date(0).toISOString() },
  };
});

/** Serialize one revision log as the storage domain stores it. */
export function encodeRevisionLog(log: BoardRevisionLog): EncodedRevisionLog {
  return {
    version: REVISION_LOG_VERSION, hubId: log.hubId, boardId: log.boardId, dropped: log.dropped,
    board: encodeBoardLog(log.log), commits: log.commits.map(commit => ({ ...commit })),
    formatVersions: [...REVISION_LOG_COMPATIBLE_VERSIONS],
    ...(log.baseline === undefined ? {} : { baseline: { ...log.baseline } }),
  };
}
