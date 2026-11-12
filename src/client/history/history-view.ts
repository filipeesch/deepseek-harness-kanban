import type { TaskHistoryEntry } from '../../shared/task-history.js';
import type { Column } from '../../shared/types.js';

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

/** The stage name the board defines now, or the identifier a removed stage left behind. */
function stageName(columns: readonly Pick<Column, 'id' | 'name'>[], id: string): string {
  return columns.find(column => column.id === id)?.name ?? id;
}

function transition(fromColumnId: string, columnId: string, columns: readonly Pick<Column, 'id' | 'name'>[]): string {
  return stageName(columns, fromColumnId) + ' \u2192 ' + stageName(columns, columnId);
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

function present(entry: TaskHistoryEntry, columns: readonly Pick<Column, 'id' | 'name'>[]): { event: string; detail: string; tone: HistoryTone } {
  switch (entry.kind) {
    case 'deterministic-execution': return { event: 'Script ' + entry.outcome, detail: stageName(columns, entry.columnId) + ' · Execution ' + entry.executionId + (entry.exit ? ' · Exit ' + entry.exit : '') + (entry.message ? ' — ' + entry.message : '') + (entry.error ? ' — ' + entry.error.message : ''), tone: entry.outcome === 'failed' ? 'warning' : 'neutral' };
    case 'deterministic-handoff': return { event: 'Script handoff ' + entry.outcome, detail: transition(entry.fromColumnId, entry.columnId, columns) + ' · Execution ' + entry.executionId + ' · Delivery ' + entry.deliveryId + ' · Exit ' + entry.exit + ' — ' + entry.message + (entry.error ? ' — ' + entry.error.message : ''), tone: entry.outcome === 'failed' ? 'warning' : 'neutral' };
    case 'created': return { event: 'Created', detail: stageName(columns, entry.columnId), tone: 'accent' };
    case 'stage': return { event: 'Stage changed', detail: transition(entry.fromColumnId, entry.columnId, columns), tone: 'accent' };
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
      duration: durations.get(index) ?? EMPTY_CELL,
      tone: presented.tone,
    });
  }
  return rows;
}
