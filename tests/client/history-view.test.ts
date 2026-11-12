import { describe, expect, it } from 'vitest';
import { buildHistoryRows, EMPTY_CELL, formatDuration, formatMoment } from '../../src/client/history/history-view.js';
import type { TaskHistoryEntry } from '../../src/shared/task-history.js';

const COLUMNS = [{ id: 'backlog', name: 'Backlog' }, { id: 'plan', name: 'Plan' }];
const FIRST = '2026-11-11T09:00:00.000Z';
const SECOND = '2026-11-11T10:00:00.000Z';
const THIRD = '2026-11-11T11:30:00.000Z';

function rows(history: TaskHistoryEntry[], now = Date.parse(THIRD)) {
  return buildHistoryRows({ history, columns: COLUMNS, now, locale: 'en-US', timeZone: 'UTC' });
}

describe('task history rows', () => {
  it('presents the record newest first and keeps the machine-readable moment', () => {
    const value = rows([
      { kind: 'created', at: FIRST, columnId: 'backlog' },
      { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan' },
    ]);
    expect(value.map(row => row.event)).toEqual(['Stage changed', 'Created']);
    expect(value[0]).toMatchObject({ moment: SECOND, detail: 'Backlog \u2192 Plan \u00b7 Move trigger not recorded', tone: 'accent', duration: '1 h 30 min' });
    expect(value[1]).toMatchObject({ moment: FIRST, detail: 'Backlog', duration: EMPTY_CELL });
  });

  it('reads a stage by its current name and falls back to the identifier a removed stage left', () => {
    const value = rows([
      { kind: 'stage', at: FIRST, fromColumnId: 'ghost', columnId: 'plan' },
    ]);
    expect(value[0]?.detail).toBe('ghost \u2192 Plan \u00b7 Move trigger not recorded');
  });

  it('measures each stage until the next stage entry, and the current one until now', () => {
    const value = rows([
      { kind: 'stage', at: FIRST, fromColumnId: 'backlog', columnId: 'plan' },
      { kind: 'auto-mode', at: '2026-11-11T09:30:00.000Z', action: 'enabled' },
      { kind: 'stage', at: SECOND, fromColumnId: 'plan', columnId: 'backlog' },
    ], Date.parse('2026-11-11T10:45:00.000Z'));
    expect(value.map(row => [row.event, row.duration])).toEqual([
      ['Stage changed', '45 min'],
      ['Auto mode enabled', EMPTY_CELL],
      ['Stage changed', '1 h 00 min'],
    ]);
  });

  it('presents how each stage entry happened, and an entry without an origin as unrecorded', () => {
    const value = rows([
      { kind: 'stage', at: FIRST, fromColumnId: 'backlog', columnId: 'plan' },
      { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan', origin: 'manual' },
      { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan', origin: 'agent' },
      { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan', origin: 'auto' },
      { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan', origin: 'script:passed' },
      { kind: 'stage', at: SECOND, fromColumnId: 'backlog', columnId: 'plan', origin: 'error:error' },
    ]);
    expect(value.map(row => row.detail)).toEqual([
      'Backlog \u2192 Plan \u00b7 Moved by the reserved error route',
      'Backlog \u2192 Plan \u00b7 Moved by script exit passed',
      'Backlog \u2192 Plan \u00b7 Moved by an automatic advance',
      'Backlog \u2192 Plan \u00b7 Moved by an agent-declared transition',
      'Backlog \u2192 Plan \u00b7 Moved by an operator',
      'Backlog \u2192 Plan \u00b7 Move trigger not recorded',
    ]);
    expect(value.every(row => row.event === 'Stage changed' && row.tone === 'accent')).toBe(true);
  });

  it('presents a recorded destination as an intention, separate from a stage change', () => {
    const value = rows([{ kind: 'intent', at: FIRST, fromColumnId: 'plan', columnId: 'backlog' }]);
    expect(value[0]).toMatchObject({ event: 'Next stage recorded', detail: 'Plan \u2192 Backlog', tone: 'neutral', duration: EMPTY_CELL });
  });

  it('presents every auto mode change with the reason that paused it', () => {
    const value = rows([
      { kind: 'auto-mode', at: FIRST, action: 'enabled' },
      { kind: 'auto-mode', at: FIRST, action: 'paused', reason: 'turn-error', message: 'Rate limited.' },
      { kind: 'auto-mode', at: FIRST, action: 'agent-paused', reason: 'Review the diff' },
      { kind: 'auto-mode', at: FIRST, action: 'resumed' },
      { kind: 'auto-mode', at: FIRST, action: 'disabled' },
    ]);
    expect(value.map(row => [row.event, row.detail, row.tone])).toEqual([
      ['Auto mode disabled', 'Automatic advance off', 'neutral'],
      ['Task resumed', 'Pause cleared', 'neutral'],
      ['Task paused', 'Requested by the agent: Review the diff', 'warning'],
      ['Auto mode paused', 'The turn failed — Rate limited.', 'warning'],
      ['Auto mode enabled', 'Automatic advance on', 'neutral'],
    ]);
  });

  it('presents a worktree outcome with its checkout, branch, and the failure that ended it', () => {
    const value = rows([
      { kind: 'worktree', at: FIRST, action: 'created', path: '/trees/one', branch: 'feat/one' },
      { kind: 'worktree', at: FIRST, action: 'attached', path: '/trees/two' },
      { kind: 'worktree', at: FIRST, action: 'removed', path: '/trees/two' },
      { kind: 'worktree', at: FIRST, action: 'failed', path: '/trees/three', error: { code: 'PREFLIGHT_FAILED', message: 'Target exists.' } },
    ]);
    expect(value.map(row => [row.event, row.detail, row.tone])).toEqual([
      ['Operation failed', '/trees/three — Target exists.', 'warning'],
      ['Worktree removed', '/trees/two', 'neutral'],
      ['Worktree attached', '/trees/two', 'neutral'],
      ['Worktree created', '/trees/one (feat/one)', 'neutral'],
    ]);
  });

  it('names the failure origin, code, attempts and guard facts of one settled script failure', () => {
    const guard = { admission: 'not-admitted', exitCode: 125, signal: null, timedOut: false, aborted: false, elapsedMs: 20, stdoutBytes: 0, stdoutHead: '', stderrBytes: 0, stderrTail: '' };
    const value = rows([{ kind: 'deterministic-execution', at: FIRST, columnId: 'plan', executionId: 'run', outcome: 'failed', error: {
      code: 'BASH_PROTOCOL', message: 'Infrastructure failure: the guard did not admit the command.',
      details: { origin: 'infrastructure', attempts: [{ attempt: 1, code: 'BASH_PROTOCOL', guard }, { attempt: 2, code: 'BASH_PROTOCOL', guard }], guard },
    } }]);
    expect(value[0]).toMatchObject({ event: 'Script failed', tone: 'warning' });
    expect(value[0]?.detail).toContain('infrastructure failure · BASH_PROTOCOL · 2 attempts · command not admitted · exit 125');
    expect(value[0]?.detail).toContain('the guard did not admit the command');
    expect(value[0]?.evidence).toBe('Guard: command not admitted · 20 ms\nExit: 125\nOutput: 0 B stdout · 0 B stderr\nAttempts: BASH_PROTOCOL (125), BASH_PROTOCOL (125)');
  });

  it('shows the synthetic result message once and keeps the deep facts expandable', () => {
    const message = 'Infrastructure failure: boom. Detail: the task History.';
    const guard = { admission: 'started', exitCode: 125, signal: null, timedOut: false, aborted: false, elapsedMs: 15, stdoutBytes: 3, stdoutHead: 'abc', stderrBytes: 23, stderrTail: 'NATIVE_LIFETIME_UNCLEAN: x' };
    const value = rows([{ kind: 'deterministic-execution', at: FIRST, columnId: 'plan', executionId: 'run', outcome: 'failed', exit: 'error', message, error: { code: 'BASH_PROTOCOL', message, details: { origin: 'infrastructure', guard, cause: { code: 'BASH_PROTOCOL', message: 'The guard left no result.' } } } }]);
    expect(value[0]?.detail.split(message)).toHaveLength(2);
    expect(value[0]?.evidence).toContain('Cause: BASH_PROTOCOL — The guard left no result.');
    expect(value[0]?.evidence).toContain('stderr: NATIVE_LIFETIME_UNCLEAN: x');
    expect(value[0]?.evidence).toContain('stdout: abc');
  });

  it('keeps a failure recorded before the vocabulary readable', () => {
    const value = rows([{ kind: 'deterministic-execution', at: FIRST, columnId: 'plan', executionId: 'run', outcome: 'failed', error: { code: 'EXECUTOR_FAILED', message: 'legacy failure' } }]);
    expect(value[0]?.detail).toContain('— legacy failure');
    expect(value[0]?.detail).not.toContain('failure · EXECUTOR_FAILED');
  });

  it('returns no rows for a task that recorded nothing', () => {
    expect(rows([])).toEqual([]);
    expect(buildHistoryRows({ history: undefined, columns: COLUMNS, now: 0 })).toEqual([]);
  });
});

describe('history formatting', () => {
  it('converts a moment into the reader time zone and keeps an unreadable moment as it is', () => {
    expect(formatMoment(SECOND, 'en-US', 'UTC')).toBe('11/11/26, 10:00 AM');
    // A zone with a different offset proves the conversion instead of restating UTC.
    expect(formatMoment(SECOND, 'en-US', 'Asia/Tokyo')).toBe('11/11/26, 7:00 PM');
    expect(formatMoment(SECOND, 'en-US', 'Europe/Lisbon')).toBe('11/11/26, 10:00 AM');
    // Lisbon keeps its own offset in summer, so the conversion is not a fixed one.
    expect(formatMoment('2026-07-01T10:00:00.000Z', 'en-US', 'Europe/Lisbon')).toBe('7/1/26, 11:00 AM');
    expect(formatMoment('not-a-moment', 'en-US', 'UTC')).toBe('not-a-moment');
  });

  it('formats durations in the compact from under a minute to days', () => {
    expect(formatDuration(30_000)).toBe('< 1 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
    expect(formatDuration((2 * 60 + 5) * 60_000)).toBe('2 h 05 min');
    expect(formatDuration(27 * 60 * 60_000)).toBe('1 d 3 h');
  });
});
