import type { StageEntryOrigin, TaskHistoryEntry } from '../../shared/task-history.js';
import type { Column, Problem } from '../../shared/types.js';
import { FAILURE_ORIGIN_LABELS } from '../../shared/deterministic-failure.js';
import { failureDetail } from '../../domain/deterministic-failure.js';

/**
 * How one task's flow record reads as table rows.
 *
 * This module owns the presentation of a recorded fact — its label, its detail,
 * and its duration — and nothing else: it takes no React state, reads no clock,
 * and stores nothing. A row is a pure function of the record, the board's
 * current stages, and the moment the reader is looking at.
 */

/** The value a cell shows when the row has nothing for it. */
export const EMPTY_CELL = '—';

/** How one row is emphasized: a step, an ordinary fact, or something that needs attention. */
export type HistoryTone = 'neutral' | 'accent' | 'warning';

/** One row of the history table, ready to render. */
export interface HistoryRow {
  /** Stable identity of the row within one rendering. */
  readonly key: string;
  /** The recorded moment, machine-readable. */
  readonly moment: string;
  /** The recorded moment as the reader's local date and time. */
  readonly when: string;
  readonly event: string;
  readonly detail: string;
  /** The bounded deep facts behind the summary; the reader expands the row to see them. */
  readonly evidence?: string;
  /** The time the task spent in the stage; the placeholder on other rows. */
  readonly duration: string;
  readonly tone: HistoryTone;
}

export interface HistoryViewInput {
  /** The record to present; absent means the task recorded nothing yet. */
  readonly history: readonly TaskHistoryEntry[] | undefined;
  /** The board's stages, so a recorded reference reads with the stage's current name. */
  readonly columns: readonly Pick<Column, 'id' | 'name'>[];
  /** The moment the reader is looking at, so the current stage's duration stays honest. */
  readonly now: number;
  /** The reader's locale; the browser's when omitted. */
  readonly locale?: string;
  /** The reader's time zone; the browser's when omitted. */
  readonly timeZone?: string;
}

const PAUSE_REASONS: Readonly<Record<string, string>> = {
  'turn-error': 'The turn failed',
  'turn-blocked': 'The turn was blocked',
  'turn-aborted': 'The turn was aborted',
  'turn-max-tokens': 'The turn reached its token limit',
  'advance-failed': 'The automatic advance failed',
  'transition-stale': 'The recorded transition is no longer valid',
};

/** One formatter per locale and zone, so a refresh tick does not rebuild it per row. */
const momentFormatters = new Map<string, Intl.DateTimeFormat>();

function momentFormatter(locale: string | undefined, timeZone: string | undefined): Intl.DateTimeFormat {
  const key = (locale ?? '') + String.fromCharCode(0) + (timeZone ?? '');
  const cached = momentFormatters.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', ...(timeZone === undefined ? {} : { timeZone }) });
  momentFormatters.set(key, created);
  return created;
}

/** One recorded moment as the reader's local date and time. */
export function formatMoment(moment: string, locale?: string, timeZone?: string): string {
  const date = new Date(moment);
  if (Number.isNaN(date.getTime())) return moment;
  return momentFormatter(locale, timeZone).format(date);
}

/** One duration in the table's compact form: "< 1 min", "45 min", "2 h 05 min", "1 d 3 h". */
export function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return '< 1 min';
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return days + ' d ' + (hours % 24) + ' h';
  if (hours > 0) return hours + ' h ' + String(minutes % 60).padStart(2, '0') + ' min';
  return minutes + ' min';
}

/**
 * One settled failure in Detail: its origin, code, attempts, the admission proof,
 * the exit status and the nested cause, so a tool failure reads differently from a
 * problem in the work. The deep facts sit behind the row's evidence block.
 */
function failureText(error: Problem | undefined): string {
  if (error === undefined) return '';
  const detail = failureDetail(error.details);
  if (detail === undefined) return ' \u2014 ' + error.message;
  const parts = [FAILURE_ORIGIN_LABELS[detail.origin] + ' failure', error.code];
  const attempts = detail.attempts?.length ?? 0;
  if (attempts > 0) parts.push(attempts + (attempts === 1 ? ' attempt' : ' attempts'));
  const guard = detail.guard;
  if (guard !== undefined) parts.push(guard.admission === 'started' ? 'command started' : guard.admission === 'not-admitted' ? 'command not admitted' : 'admission unknown');
  if (guard !== undefined && guard.signal !== null) parts.push('signal ' + guard.signal);
  if (guard !== undefined && guard.signal === null && guard.exitCode !== null) parts.push('exit ' + guard.exitCode);
  if (detail.cause !== undefined) parts.push('cause ' + detail.cause.code);
  return ' \u00b7 ' + parts.join(' \u00b7 ') + ' \u2014 ' + error.message;
}

/** The bounded deep facts of one failure, or undefined when the record carries none. */
function failureEvidence(error: Problem | undefined): string | undefined {
  if (error === undefined) return undefined;
  const detail = failureDetail(error.details);
  if (detail === undefined) return undefined;
  const lines: string[] = [];
  if (detail.cause !== undefined) lines.push('Cause: ' + detail.cause.code + (detail.cause.message.trim() ? ' \u2014 ' + detail.cause.message.trim() : ''));
  const guard = detail.guard;
  if (guard !== undefined) {
    lines.push('Guard: ' + (guard.admission === 'started' ? 'command started' : guard.admission === 'not-admitted' ? 'command not admitted' : 'admission unknown') + ' \u00b7 ' + guard.elapsedMs + ' ms');
    lines.push('Exit: ' + (guard.signal !== null ? 'signal ' + guard.signal : guard.exitCode === null ? 'no status' : String(guard.exitCode)) + (guard.timedOut ? ' \u00b7 timed out' : '') + (guard.aborted ? ' \u00b7 aborted' : ''));
    lines.push('Output: ' + guard.stdoutBytes + ' B stdout \u00b7 ' + guard.stderrBytes + ' B stderr');
    if (guard.stdoutHead.trim()) lines.push('stdout: ' + guard.stdoutHead.trim());
    if (guard.stderrTail.trim()) lines.push('stderr: ' + guard.stderrTail.trim());
  }
  if (detail.attempts !== undefined && detail.attempts.length > 0) {
    lines.push('Attempts: ' + detail.attempts.map(attempt => attempt.code + (attempt.guard === undefined ? '' : ' (' + (attempt.guard.signal !== null ? attempt.guard.signal : attempt.guard.exitCode ?? 'no status') + ')')).join(', '));
  }
  return lines.length === 0 ? undefined : lines.join('\n');
}

/** The stage name the board defines now, or the identifier a removed stage left behind. */
function stageName(columns: readonly Pick<Column, 'id' | 'name'>[], id: string): string {
  return columns.find(column => column.id === id)?.name ?? id;
}

function transition(fromColumnId: string, columnId: string, columns: readonly Pick<Column, 'id' | 'name'>[]): string {
  return stageName(columns, fromColumnId) + ' \u2192 ' + stageName(columns, columnId);
}

/** How a stage entry happened; a named exit carries the exit that routed the card. */
function stageOrigin(origin: StageEntryOrigin | undefined): string {
  // The copy names what produced the move, not the record's field, so a reader
  // never confuses a missing trigger with a missing stage.
  if (origin === undefined) return 'Move trigger not recorded';
  if (origin === 'manual') return 'Moved by an operator';
  if (origin === 'agent') return 'Moved by an agent-declared transition';
  if (origin === 'auto') return 'Moved by an automatic advance';
  if (origin.startsWith('error:')) return 'Moved by the reserved error route';
  return 'Moved by script exit ' + origin.slice('script:'.length);
}

function autoModeRow(entry: Extract<TaskHistoryEntry, { kind: 'auto-mode' }>): { event: string; detail: string; tone: HistoryTone } {
  switch (entry.action) {
    case 'enabled': return { event: 'Auto mode enabled', detail: 'Automatic advance on', tone: 'neutral' };
    case 'disabled': return { event: 'Auto mode disabled', detail: 'Automatic advance off', tone: 'neutral' };
    case 'resumed': return { event: 'Task resumed', detail: 'Pause cleared', tone: 'neutral' };
    case 'agent-paused': return { event: 'Task paused', detail: 'Requested by the agent: ' + (entry.reason ?? ''), tone: 'warning' };
    case 'paused': {
      const reason = entry.reason === undefined ? 'Paused' : (PAUSE_REASONS[entry.reason] ?? entry.reason);
      return { event: 'Auto mode paused', detail: entry.message === undefined ? reason : reason + ' — ' + entry.message, tone: 'warning' };
    }
  }
}

function worktreeRow(entry: Extract<TaskHistoryEntry, { kind: 'worktree' }>): { event: string; detail: string; tone: HistoryTone } {
  switch (entry.action) {
    case 'created': return { event: 'Worktree created', detail: (entry.path ?? '') + (entry.branch === undefined ? '' : ' (' + entry.branch + ')'), tone: 'neutral' };
    case 'attached': return { event: 'Worktree attached', detail: entry.path ?? '', tone: 'neutral' };
    case 'removed': return { event: 'Worktree removed', detail: entry.path ?? '', tone: 'neutral' };
    case 'failed': {
      const message = entry.error?.message ?? 'The operation failed';
      return { event: 'Operation failed', detail: entry.path === undefined ? message : entry.path + ' — ' + message, tone: 'warning' };
    }
  }
}

function present(entry: TaskHistoryEntry, columns: readonly Pick<Column, 'id' | 'name'>[]): { event: string; detail: string; tone: HistoryTone; evidence?: string } {
  switch (entry.kind) {
    case 'deterministic-execution': {
      // The synthetic result message and the diagnostic are the same sentence; show
      // it once instead of repeating it inside the same row.
      const repeated = entry.message !== undefined && entry.error !== undefined && entry.message === entry.error.message;
      const evidence = failureEvidence(entry.error);
      return { event: 'Script ' + entry.outcome, detail: stageName(columns, entry.columnId) + ' · Execution ' + entry.executionId + (entry.exit ? ' · Exit ' + entry.exit : '') + (entry.parameters && Object.keys(entry.parameters).length > 0 ? ' · Parameters ' + Object.entries(entry.parameters).map(([name, value]) => name + '=' + value).join(', ').slice(0, 4096) : '') + (entry.message !== undefined && !repeated ? ' — ' + entry.message : '') + failureText(entry.error), tone: entry.outcome === 'failed' ? 'warning' : 'neutral', ...(evidence === undefined ? {} : { evidence }) };
    }
    case 'deterministic-handoff': return { event: 'Script handoff ' + entry.outcome, detail: transition(entry.fromColumnId, entry.columnId, columns) + ' · Execution ' + entry.executionId + ' · Delivery ' + entry.deliveryId + ' · Exit ' + entry.exit + ' — ' + entry.message + (entry.error ? ' — ' + entry.error.message : ''), tone: entry.outcome === 'failed' ? 'warning' : 'neutral' };
    case 'created': return { event: 'Created', detail: stageName(columns, entry.columnId), tone: 'accent' };
    case 'stage': return { event: 'Stage changed', detail: transition(entry.fromColumnId, entry.columnId, columns) + ' · ' + stageOrigin(entry.origin), tone: 'accent' };
    case 'intent': return { event: 'Next stage recorded', detail: transition(entry.fromColumnId, entry.columnId, columns), tone: 'neutral' };
    case 'auto-mode': return autoModeRow(entry);
    case 'worktree': return worktreeRow(entry);
  }
}

/** The time each stage entry lasted: until the next stage entry, or until now for the current one. */
function stageDurations(entries: readonly TaskHistoryEntry[], now: number): Map<number, string> {
  const stages = entries.map((entry, index) => ({ entry, index })).filter(item => item.entry.kind === 'stage');
  const durations = new Map<number, string>();
  stages.forEach((item, position) => {
    const next = stages[position + 1];
    const end = next === undefined ? now : Date.parse(next.entry.at);
    durations.set(item.index, formatDuration(Math.max(0, end - Date.parse(item.entry.at))));
  });
  return durations;
}

/** The whole record as rows, newest first. */
export function buildHistoryRows(input: HistoryViewInput): HistoryRow[] {
  const entries = input.history ?? [];
  const durations = stageDurations(entries, input.now);
  const rows: HistoryRow[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    const presented = present(entry, input.columns);
    rows.push({
      key: String(index),
      moment: entry.at,
      when: formatMoment(entry.at, input.locale, input.timeZone),
      event: presented.event,
      detail: presented.detail,
      ...(presented.evidence === undefined ? {} : { evidence: presented.evidence }),
      duration: durations.get(index) ?? EMPTY_CELL,
      tone: presented.tone,
    });
  }
  return rows;
}
