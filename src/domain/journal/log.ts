import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { applyEvents } from './conflict.js';
import { decodeEvent, encodeEvent, EVENT_FORMAT_VERSION, type BoardChange, type EventDecode, type JournalEvent } from './event.js';

/**
 * One board's published log: the state the log starts from and the events appended
 * after it.
 *
 * The tail is bounded because nothing can tell this installation that every member
 * has applied an event. Compaction folds the tail into the snapshot, which carries
 * the stable stage identities, so a member behind the window recovers from the
 * snapshot without losing which stage is which.
 */

export const BOARD_LOG_VERSION = 3;
/** How many events one log keeps before the tail is folded into the snapshot. */
export const BOARD_LOG_EVENT_BOUND = 200;
/** The most events one stored log may carry, so a hostile log cannot exhaust the reader. */
export const BOARD_LOG_EVENT_LIMIT = 5_000;
/** The largest snapshot text one stored log may carry. */
export const BOARD_LOG_TEXT_LIMIT = 1_000_000;

export interface BoardLogSnapshot {
  readonly text: string;
  readonly seq: number;
}

export interface BoardLogFile {
  readonly version: number;
  readonly snapshot: BoardLogSnapshot;
  readonly events: readonly JournalEvent[];
}

/** A log that carries one board state and no history. */
export function createBoardLog(text: string): BoardLogFile {
  return { version: executableText(text) ? BOARD_LOG_VERSION : 1, snapshot: { text, seq: 0 }, events: [] };
}

/** Executable grammar requires an envelope signal even with an empty tail. */
function executableText(text: string): boolean {
  try {
    const raw = parseYaml(text) as { columns?: unknown };
    return Array.isArray(raw?.columns) && raw.columns.some(column => typeof column === 'object' && column !== null && Object.hasOwn(column, 'deterministic'));
  } catch { return false; }
}
function executableChange(change: BoardChange): boolean {
  return change.kind === 'stage.field-changed' && change.field === 'deterministic'
    || change.kind === 'stage.created' && change.stage.deterministic !== undefined
    || change.kind === 'workflow.replaced' && executableText(change.text);
}

/** The sequence the next appended event takes. */
export function nextSequence(log: BoardLogFile): number {
  return log.events.reduce((highest, event) => Math.max(highest, event.seq), log.snapshot.seq) + 1;
}

/** The opaque head of one log, which an append must match. */
export function headToken(log: BoardLogFile): string {
  const canonical = JSON.stringify({
    version: log.version,
    snapshot: { seq: log.snapshot.seq, text: log.snapshot.text },
    events: log.events.map(event => encodeEvent(event)),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Append events to a log, stamped with their positions. */
export function appendEvents(log: BoardLogFile, changes: readonly BoardChange[], at: string): BoardLogFile {
  let seq = nextSequence(log);
  const events = changes.map(change => ({ ...change, seq: seq++, at, v: executableChange(change) ? EVENT_FORMAT_VERSION : 1 } as JournalEvent));
  // Preserve a log's envelope when no new executable grammar is added; a new
  // executable change always raises it to the version this installation writes.
  const executable = executableText(log.snapshot.text) || changes.some(executableChange);
  return { ...log, version: executable ? BOARD_LOG_VERSION : log.version, events: [...log.events, ...events] };
}

/** The events a member at the given cursor has not seen yet. */
export function eventsAfter(log: BoardLogFile, cursor: number): readonly JournalEvent[] {
  return log.events.filter(event => event.seq > cursor);
}

/** What a member holds for one board: the authored text and the last sequence it applied. */
export interface BoardState {
  readonly text: string;
  readonly cursor: number;
}

export type BoardRecovery =
  | { readonly ok: true; readonly text: string; readonly cursor: number; readonly events: number; readonly rebuilt: boolean }
  | { readonly ok: false; readonly conflict: { readonly kind: 'identity' | 'lifecycle'; readonly message: string } };

/**
 * Recover one board as of the head of its log.
 *
 * The events are applied to the state the caller holds, never to the snapshot while
 * the cursor is ahead of it: the cursor says which of the two the caller has. A
 * member whose cursor is older than the retained snapshot re-establishes from the
 * snapshot, which is why compaction keeps the identities in it. Passing no state
 * means this installation has nothing stored and must rebuild from the snapshot.
 */
export function recoverBoard(log: BoardLogFile, state: BoardState | null): BoardRecovery {
  const rebuilt = state === null || state.cursor < log.snapshot.seq;
  const base: BoardState = rebuilt ? { text: log.snapshot.text, cursor: log.snapshot.seq } : state;
  const pending = eventsAfter(log, base.cursor);
  const applied = applyEvents(base.text, pending);
  if (!applied.ok) return { ok: false, conflict: { kind: applied.conflict.kind, message: applied.conflict.message } };
  return {
    ok: true,
    text: applied.text,
    cursor: pending.length === 0 ? base.cursor : pending[pending.length - 1]!.seq,
    events: pending.length,
    rebuilt,
  };
}

/**
 * Fold the tail into the snapshot once it passes the bound. A tail that cannot be
 * folded — because it diverges from the snapshot — is left untouched, so compaction
 * never loses an event a user still has to decide about.
 */
export function compactBoardLog(log: BoardLogFile, bound = BOARD_LOG_EVENT_BOUND): BoardLogFile {
  if (log.events.length <= bound) return log;
  const applied = applyEvents(log.snapshot.text, log.events);
  if (!applied.ok) return log;
  return {
    version: log.version,
    snapshot: { text: applied.text, seq: log.events[log.events.length - 1]!.seq },
    events: [],
  };
}

/** Serialize one log for storage. */
export function encodeBoardLog(log: BoardLogFile): Record<string, unknown> {
  return {
    version: log.version,
    snapshot: { seq: log.snapshot.seq, text: log.snapshot.text },
    events: log.events.map(event => encodeEvent(event)),
  };
}

/** Read one stored board log from its YAML text. */
export function readBoardLogText(text: string): BoardLogDecode {
  let raw: unknown;
  try { raw = parseYaml(text); }
  catch (error) { return { ok: false, reason: 'invalid', message: 'A board log must be valid YAML: ' + (error instanceof Error ? error.message : String(error)) }; }
  return decodeBoardLog(raw);
}

export type BoardLogDecode =
  | { readonly ok: true; readonly log: BoardLogFile }
  | Extract<EventDecode, { ok: false }>
  | { readonly ok: false; readonly reason: 'invalid'; readonly message: string };

/** Read one stored log. A newer log or a newer event is reported, never skipped. */
export function decodeBoardLog(raw: unknown): BoardLogDecode {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'invalid', message: 'A board log must be a mapping.' };
  const value = raw as Record<string, unknown>;
  const version = value.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) return { ok: false, reason: 'invalid', message: 'A board log must state an integer format version.' };
  if (version < 1) return { ok: false, reason: 'invalid', message: 'A board log version must be positive.' };
  if (version > BOARD_LOG_VERSION) return { ok: false, reason: 'unsupported-version', version };
  const snapshot = value.snapshot;
  if (typeof snapshot !== 'object' || snapshot === null) return { ok: false, reason: 'invalid', message: 'A board log requires a snapshot.' };
  const snapshotValue = snapshot as Record<string, unknown>;
  if (typeof snapshotValue.text !== 'string' || snapshotValue.text.trim().length === 0) return { ok: false, reason: 'invalid', message: 'A board log snapshot requires workflow text.' };
  if (snapshotValue.text.length > BOARD_LOG_TEXT_LIMIT) return { ok: false, reason: 'invalid', message: 'A board log snapshot exceeds the supported size.' };
  if (typeof snapshotValue.seq !== 'number' || !Number.isInteger(snapshotValue.seq) || snapshotValue.seq < 0) return { ok: false, reason: 'invalid', message: 'A board log snapshot requires a sequence.' };
  if (version === 1 && executableText(snapshotValue.text)) return { ok: false, reason: 'unsupported-version', version: BOARD_LOG_VERSION };
  const rawEvents = value.events === undefined ? [] : value.events;
  if (!Array.isArray(rawEvents)) return { ok: false, reason: 'invalid', message: 'A board log events field must be an array.' };
  if (rawEvents.length > BOARD_LOG_EVENT_LIMIT) return { ok: false, reason: 'invalid', message: 'A board log carries more events than this installation supports.' };
  const events: JournalEvent[] = [];
  let previous = snapshotValue.seq;
  for (const item of rawEvents) {
    const decoded = decodeEvent(item);
    if (!decoded.ok) return decoded;
    if (version === 1 && (decoded.event.v === 2 || decoded.event.v === 3 || executableChange(decoded.event))) return { ok: false, reason: 'unsupported-version', version: BOARD_LOG_VERSION };
    // A cursor is only meaningful over an ordered log, so a disorder is refused here.
    if (decoded.event.seq <= previous) return { ok: false, reason: 'invalid', message: 'A board log must carry its events in order, after its snapshot.' };
    previous = decoded.event.seq;
    events.push(decoded.event);
  }
  return { ok: true, log: { version, snapshot: { text: snapshotValue.text, seq: snapshotValue.seq }, events } };
}

