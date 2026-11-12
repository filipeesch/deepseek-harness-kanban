import { describe, expect, it } from 'vitest';
import type { TransitionRule } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { applyEvents, conflictKindOf } from '../../src/domain/journal/conflict.js';
import { appendEvents, compactBoardLog, createBoardLog, decodeBoardLog, encodeBoardLog, eventsAfter, headToken, nextSequence, recoverBoard } from '../../src/domain/journal/log.js';
import type { BoardChange } from '../../src/domain/journal/event.js';

const NL = String.fromCharCode(10);
const AT = '2026-01-01T00:00:00.000Z';
const BASE = ['name: Delivery', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', '  - id: plan', '    key: s2', '    label: Plan', ''].join(NL);

function event(seq: number, change: BoardChange) {
  return { ...change, seq, at: AT, v: 1 } as never;
}

describe('board event application', () => {
  it('applies a batch in order', () => {
    const result = applyEvents(BASE, [
      event(1, { kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }),
      event(2, { kind: 'stage.field-changed', key: 's1', field: 'name', value: 'Inbox' }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const workflow = parseWorkflow(result.text);
      expect(workflow.columns[0]?.id).toBe('inbox');
      expect(workflow.columns[0]?.name).toBe('Inbox');
    }
  });

  it('reports a divergent rename as an identity conflict and applies nothing of it', () => {
    const result = applyEvents(BASE, [event(1, { kind: 'stage.id-changed', key: 's1', from: 'elsewhere', id: 'inbox' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict.kind).toBe('identity');
      expect(result.conflict.event.seq).toBe(1);
    }
  });

  it('reports an event about a stage the board does not have as a lifecycle conflict', () => {
    const result = applyEvents(BASE, [event(1, { kind: 'stage.field-changed', key: 'gone', field: 'name', value: 'X' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.kind).toBe('lifecycle');
  });

  it('raises a failure that is not a divergence', () => {
    expect(() => applyEvents(BASE, [event(1, { kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'plan' })])).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });

  it('classifies only the divergence codes', () => {
    expect(conflictKindOf(new Error('other'))).toBeNull();
  });
});

describe('board log', () => {
  const changes: BoardChange[] = [
    { kind: 'workflow.field-changed', field: 'name', value: 'Renamed' },
    { kind: 'stage.field-changed', key: 's1', field: 'name', value: 'Inbox' },
  ];

  it('stamps appended events with their position and time', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    expect(log.events.map(entry => entry.seq)).toEqual([1, 2]);
    expect(nextSequence(log)).toBe(3);
  });

  it('changes its head token when anything changes', () => {
    const first = createBoardLog(BASE);
    const second = appendEvents(first, changes, AT);
    expect(headToken(first)).not.toBe(headToken(second));
    expect(headToken(second)).toBe(headToken(appendEvents(createBoardLog(BASE), changes, AT)));
  });

  it('recovers a board from the snapshot and the tail', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    const recovered = recoverBoard(log, null);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(parseWorkflow(recovered.text).name).toBe('Renamed');
      expect(recovered.cursor).toBe(2);
      expect(recovered.rebuilt).toBe(true);
    }
  });

  it('applies from the caller state when the cursor is ahead of the snapshot', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    const firstPass = applyEvents(BASE, [log.events[0]!]);
    expect(firstPass.ok).toBe(true);
    if (!firstPass.ok) return;
    const recovered = recoverBoard(log, { text: firstPass.text, cursor: 1 });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.rebuilt).toBe(false);
      expect(recovered.events).toBe(1);
      expect(recovered.cursor).toBe(2);
      const workflow = parseWorkflow(recovered.text);
      expect(workflow.name).toBe('Renamed');
      expect(workflow.columns[0]?.name).toBe('Inbox');
    }
  });

  it('rebuilds from the snapshot when the stored cursor is older than it', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    const compacted = compactBoardLog(log, 1);
    const recovered = recoverBoard(compacted, { text: BASE, cursor: 0 });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.rebuilt).toBe(true);
      expect(parseWorkflow(recovered.text).name).toBe('Renamed');
    }
  });

  it('reports only the events after the cursor', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    expect(eventsAfter(log, 1).map(entry => entry.seq)).toEqual([2]);
    expect(eventsAfter(log, 2)).toEqual([]);
  });

  it('folds the tail into the snapshot when it passes the bound', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    const compacted = compactBoardLog(log, 1);
    expect(compacted.events).toEqual([]);
    expect(compacted.snapshot.seq).toBe(2);
    expect(parseWorkflow(compacted.snapshot.text).name).toBe('Renamed');
    expect(headToken(compacted)).toBeDefined();
  });

  it('leaves the tail alone when it is under the bound', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    expect(compactBoardLog(log, 5)).toBe(log);
  });

  it('recovers a member behind the compaction window from the snapshot', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    const compacted = compactBoardLog(log, 1);
    const recovered = recoverBoard(compacted, null);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(parseWorkflow(recovered.text).name).toBe('Renamed');
      expect(parseWorkflow(recovered.text).columns.map(column => column.key)).toEqual(['s1', 's2']);
    }
  });

  it('round-trips a stored log and refuses a newer one', () => {
    const log = appendEvents(createBoardLog(BASE), changes, AT);
    const decoded = decodeBoardLog(encodeBoardLog(log));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(headToken(decoded.log)).toBe(headToken(log));
    expect(decodeBoardLog({ ...encodeBoardLog(log), version: 3 })).toEqual({ ok: false, reason: 'unsupported-version', version: 3 });
    expect(decodeBoardLog({ version: 1, snapshot: { text: ' ', seq: 0 }, events: [] }).ok).toBe(false);
    expect(decodeBoardLog({ version: 1, snapshot: { text: BASE, seq: 5 }, events: [{ kind: 'workflow.field-changed', field: 'name', value: 'X', seq: 1, at: AT, v: 1 }] }).ok).toBe(false);
    expect(decodeBoardLog({ version: 1, snapshot: { text: BASE, seq: 0 }, events: [
      { kind: 'workflow.field-changed', field: 'name', value: 'A', seq: 2, at: AT, v: 1 },
      { kind: 'workflow.field-changed', field: 'name', value: 'B', seq: 1, at: AT, v: 1 },
    ] }).ok).toBe(false);
  });

  it('refuses an event of a newer format', () => {
    const log = encodeBoardLog(appendEvents(createBoardLog(BASE), changes, AT));
    const events = (log.events as unknown[]).map(entry => ({ ...(entry as object), v: 3 }));
    expect(decodeBoardLog({ ...log, events })).toEqual({ ok: false, reason: 'unsupported-version', version: 3 });
  });
});
