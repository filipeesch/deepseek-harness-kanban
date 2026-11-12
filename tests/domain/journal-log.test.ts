import { describe, expect, it } from 'vitest';
import type { BoardChange } from '../../src/domain/journal/event.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { applyEvents, conflictKindOf } from '../../src/domain/journal/conflict.js';
import {
  appendEvents, BOARD_LOG_EVENT_BOUND, decodeBoardLog, encodeBoardLog, eventsAfter, headToken,
  lastCheckpoint, needsCheckpoint, nextSequence, replay,
} from '../../src/domain/journal/log.js';
import { genesisLog } from '../support/board-log-fixture.js';

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

describe('append-only board log', () => {
  const changes: BoardChange[] = [
    { kind: 'workflow.field-changed', field: 'name', value: 'Renamed' },
    { kind: 'stage.field-changed', key: 's1', field: 'name', value: 'Inbox' },
  ];

  it('stamps appended events with their position and time, from zero', () => {
    const log = appendEvents(genesisLog(BASE), changes, AT);
    expect(log.map(entry => entry.seq)).toEqual([0, 1, 2]);
    expect(nextSequence(log)).toBe(3);
  });

  it('changes its head token when anything changes', () => {
    const first = genesisLog(BASE);
    const second = appendEvents(first, changes, AT);
    expect(headToken(first)).not.toBe(headToken(second));
    expect(headToken(second)).toBe(headToken(appendEvents(genesisLog(BASE), changes, AT)));
  });

  it('replays from its only checkpoint when the caller has nothing stored', () => {
    const log = appendEvents(genesisLog(BASE), changes, AT);
    const recovered = replay(log, null);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(parseWorkflow(recovered.text).name).toBe('Renamed');
      expect(recovered.cursor).toBe(2);
      expect(recovered.events.map(entry => entry.seq)).toEqual([1, 2]);
    }
  });

  it('replays only the events after the caller cursor', () => {
    const log = appendEvents(genesisLog(BASE), changes, AT);
    const firstPass = applyEvents(BASE, [log[1]!]);
    expect(firstPass.ok).toBe(true);
    if (!firstPass.ok) return;
    const recovered = replay(log, { text: firstPass.text, cursor: 1 });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.events).toHaveLength(1);
      expect(recovered.cursor).toBe(2);
      const workflow = parseWorkflow(recovered.text);
      expect(workflow.name).toBe('Renamed');
      expect(workflow.columns[0]?.name).toBe('Inbox');
    }
  });

  it('reports only the events after the cursor', () => {
    const log = appendEvents(genesisLog(BASE), changes, AT);
    expect(eventsAfter(log, 1).map(entry => entry.seq)).toEqual([2]);
    expect(eventsAfter(log, 2)).toEqual([]);
  });

  it('bounds replay with an appended checkpoint rather than a rewrite', () => {
    let log = genesisLog(BASE);
    for (let index = 0; index <= BOARD_LOG_EVENT_BOUND; index++) log = appendEvents(log, [{ kind: 'workflow.field-changed', field: 'name', value: 'Name ' + index }], AT);
    expect(needsCheckpoint(log)).toBe(true);
    const checkpointed = appendEvents(log, [{ kind: 'workflow.replaced', text: BASE }], AT);
    expect(lastCheckpoint(checkpointed)).toBe(checkpointed.length - 1);
    expect(needsCheckpoint(checkpointed)).toBe(false);
    // Every earlier event is retained, and replay still recovers the checkpoint's text.
    expect(checkpointed.slice(0, log.length)).toEqual(log);
    const recovered = replay(checkpointed, null);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.text).toBe(BASE);
  });

  it('round-trips its JSON Lines encoding and keeps event stamps', () => {
    const log = appendEvents(genesisLog(BASE), changes, AT);
    const encoded = encodeBoardLog(log);
    const decoded = decodeBoardLog(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(headToken(decoded.log)).toBe(headToken(log));
      expect(decoded.log.map(entry => [entry.seq, entry.at, entry.v])).toEqual(log.map(entry => [entry.seq, entry.at, entry.v]));
    }
    expect(encoded.trim().split(NL)).toHaveLength(log.length);
  });

  it('refuses a newer event, an unknown kind, and a broken sequence', () => {
    const log = appendEvents(genesisLog(BASE), changes, AT);
    const lines = encodeBoardLog(log).trim().split(NL);
    expect(decodeBoardLog([lines[0], JSON.stringify({ ...JSON.parse(lines[1]!), v: 9 })].join(NL))).toEqual({ ok: false, reason: 'unsupported-version', version: 9 });
    expect(decodeBoardLog([lines[0], JSON.stringify({ ...JSON.parse(lines[1]!), kind: 'stage.teleported' })].join(NL))).toEqual({ ok: false, reason: 'unknown-kind', kind: 'stage.teleported' });
    expect(decodeBoardLog([lines[0], JSON.stringify({ ...JSON.parse(lines[1]!), seq: 5 })].join(NL)).ok).toBe(false);
  });

  it('requires a whole-workflow event first', () => {
    const log = appendEvents(genesisLog(BASE), changes, AT);
    const lines = encodeBoardLog(log).trim().split(NL);
    expect(decodeBoardLog(lines[1]!).ok).toBe(false);
    expect(decodeBoardLog('').ok).toBe(false);
  });
});
