import { createHash } from 'node:crypto';
import type { BoardChange, JournalEvent } from './event.js';
import { decodeEvent, encodeEvent, EVENT_FORMAT_VERSION } from './event.js';
import { applyEvents } from './conflict.js';

/**
 * One board's published log: an append-only sequence of events, one JSON object per
 * line. There is no snapshot in the log and no compaction that rewrites it; the
 * publisher appends a whole-workflow event as a checkpoint to bound replay.
 */

/** How many events after the latest checkpoint a log keeps before another one is due. */
export const BOARD_LOG_EVENT_BOUND = 200;
/** The most events one stored log may carry, so a hostile log cannot exhaust the reader. */
export const BOARD_LOG_EVENT_LIMIT = 5_000;
/** The largest single stored line, so one event cannot exhaust the reader. */
export const BOARD_LOG_LINE_LIMIT = 2_000_000;

/** One board's log as the domain reads it. */
export type BoardLog = readonly JournalEvent[];

export type BoardLogDecode =
  | { readonly ok: true; readonly log: BoardLog }
  | { readonly ok: false; readonly reason: 'unsupported-version'; readonly version: number }
  | { readonly ok: false; readonly reason: 'unknown-kind'; readonly kind: string }
  | { readonly ok: false; readonly reason: 'invalid'; readonly message: string };

/** The sequence the next appended event takes. */
export function nextSequence(log: BoardLog): number {
  return lastSequence(log) + 1;
}

/** The sequence of the last event, or -1 for a log with no events. */
export function lastSequence(log: BoardLog): number {
  return log.length === 0 ? -1 : log[log.length - 1]!.seq;
}

/** The opaque head of one log, which an append must match. */
export function headToken(log: BoardLog): string {
  const canonical = JSON.stringify(log.map(event => encodeEvent(event)));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Append events to a log, stamped with their positions. */
export function appendEvents(log: BoardLog, changes: readonly BoardChange[], at: string): BoardLog {
  let seq = nextSequence(log);
  return [...log, ...changes.map(change => ({ ...change, seq: seq++, at, v: EVENT_FORMAT_VERSION } as JournalEvent))];
}

/** The events a member at the given cursor has not seen yet. */
export function eventsAfter(log: BoardLog, cursor: number): readonly JournalEvent[] {
  return log.filter(event => event.seq > cursor);
}

/** The index of the most recent whole-workflow event in a log, or -1. */
export function lastCheckpoint(log: BoardLog): number {
  for (let index = log.length - 1; index >= 0; index--) if (log[index]!.kind === 'workflow.replaced') return index;
  return -1;
}

/** Whether publishing should append a checkpoint after the batch it is about to write. */
export function needsCheckpoint(log: BoardLog): boolean {
  const checkpoint = lastCheckpoint(log);
  const since = checkpoint < 0 ? log.length : log.length - checkpoint - 1;
  return since > BOARD_LOG_EVENT_BOUND;
}

/** Whether one event changes the authored workflow text rather than the board identity. */
export function isWorkflowEvent(event: JournalEvent): boolean {
  return !event.kind.startsWith('board.');
}

/** What a member holds for one board: the authored text and the last sequence it applied. */
export interface BoardState {
  readonly text: string;
  readonly cursor: number;
}

export type BoardReplay =
  | { readonly ok: true; readonly text: string; readonly cursor: number; readonly events: readonly JournalEvent[] }
  | { readonly ok: false; readonly conflict: { readonly kind: 'identity' | 'lifecycle'; readonly message: string } };

/**
 * Recover one board as of the head of its log.
 *
 * The caller's own materialized text is the base, so replay applies only what it has
 * not seen. An installation with nothing stored, or a cursor past the log, rebuilds
 * from the most recent checkpoint, which is why a checkpoint is an appended
 * whole-workflow event rather than a rewrite.
 */
export function replay(log: BoardLog, state: BoardState | null): BoardReplay {
  const last = lastSequence(log);
  let base: BoardState;
  if (state === null || state.cursor > last) {
    const checkpoint = lastCheckpoint(log);
    if (checkpoint < 0) return { ok: false, conflict: { kind: 'lifecycle', message: 'The board log has no whole-workflow event to recover from.' } };
    const anchor = log[checkpoint]!;
    base = { text: (anchor as Extract<JournalEvent, { kind: 'workflow.replaced' }>).text, cursor: anchor.seq };
  } else {
    base = state;
  }
  const pending = eventsAfter(log, base.cursor);
  const workflow = pending.filter(isWorkflowEvent);
  const applied = applyEvents(base.text, workflow);
  if (!applied.ok) return { ok: false, conflict: { kind: applied.conflict.kind, message: applied.conflict.message } };
  return { ok: true, text: applied.text, cursor: last, events: pending };
}

/** The workflow a log describes from its most recent checkpoint, or null when it has none. */
export function publishedWorkflow(log: BoardLog | null): string | null {
  if (log === null) return null;
  const recovered = replay(log, null);
  return recovered.ok ? recovered.text : null;
}

/** Serialize one log for storage: one JSON object per line. */
export function encodeBoardLog(log: BoardLog): string {
  return log.map(event => JSON.stringify(encodeEvent(event))).join(String.fromCharCode(10)) + String.fromCharCode(10);
}

/** Read one stored log. A newer event or an unknown kind is reported, never skipped. */
export function decodeBoardLog(text: string): BoardLogDecode {
  const lines = text.split(String.fromCharCode(10)).filter(line => line.trim().length > 0);
  if (lines.length === 0) return { ok: false, reason: 'invalid', message: 'A board log requires at least one event.' };
  if (lines.length > BOARD_LOG_EVENT_LIMIT) return { ok: false, reason: 'invalid', message: 'A board log carries more events than this installation supports.' };
  const events: JournalEvent[] = [];
  for (const line of lines) {
    if (line.length > BOARD_LOG_LINE_LIMIT) return { ok: false, reason: 'invalid', message: 'A board log line exceeds the supported size.' };
    let raw: unknown;
    try { raw = JSON.parse(line); }
    catch { return { ok: false, reason: 'invalid', message: 'A board log line must be a JSON object.' }; }
    const decoded = decodeEvent(raw);
    if (!decoded.ok) return decoded;
    const expected = events.length === 0 ? 0 : events[events.length - 1]!.seq + 1;
    if (decoded.event.seq !== expected) return { ok: false, reason: 'invalid', message: 'A board log must carry its events in order, from sequence 0.' };
    events.push(decoded.event);
  }
  if (events[0]!.kind !== 'workflow.replaced') return { ok: false, reason: 'invalid', message: 'A board log must start with a whole-workflow event.' };
  return { ok: true, log: events };
}