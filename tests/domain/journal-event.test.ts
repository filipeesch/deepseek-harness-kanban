import { describe, expect, it } from 'vitest';
import { decodeEvent, encodeEvent, EVENT_KINDS, type JournalEvent } from '../../src/domain/journal/event.js';

const base = { seq: 3, at: '2026-01-01T00:00:00.000Z', v: 1 } as const;

describe('journal event codec', () => {
  it('round-trips every event kind', () => {
    const events: JournalEvent[] = [
      { kind: 'workflow.replaced', text: 'columns: []', ...base },
      { kind: 'workflow.field-changed', field: 'name', value: 'Delivery', ...base },
      { kind: 'workflow.initial-changed', columnId: 'backlog', ...base },
      { kind: 'stage.created', stage: { id: 'review', key: 's2', name: 'Review' }, ...base },
      { kind: 'stage.field-changed', key: 's1', field: 'name', value: 'Inbox', ...base },
      { kind: 'stage.field-changed', key: 's1', field: 'allowedTransitions', value: [{ to: 'done' }, { to: 'plan', when: 'only' }], ...base },
      { kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox', ...base },
      { kind: 'stage.removed', key: 's1', ...base },
      { kind: 'stage.layout-set', key: 's1', position: { x: 1, y: 2 }, size: null, ...base },
      { kind: 'group.created', group: { id: 'g', name: 'Group', columnIds: ['backlog'] }, ...base },
      { kind: 'group.field-changed', id: 'g', field: 'name', value: 'Renamed', ...base },
      { kind: 'group.removed', id: 'g', ...base },
      { kind: 'connection.set', layout: { from: 'a', to: 'b', source: { side: 'right', at: 2 } }, ...base },
      { kind: 'connection.removed', from: 'a', to: 'b', ...base },
    ];
    expect(new Set(events.map(event => event.kind))).toEqual(new Set(EVENT_KINDS));
    for (const event of events) {
      const decoded = decodeEvent(encodeEvent(event));
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.event).toEqual(event);
    }
  });

  it('normalizes a bare transition entry into the authored shape', () => {
    const decoded = decodeEvent({ ...base, kind: 'stage.field-changed', key: 's1', field: 'allowedTransitions', value: ['done', { to: 'plan', when: '  only  ' }] });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.event).toMatchObject({ value: [{ to: 'done' }, { to: 'plan', when: 'only' }] });
  });

  it('refuses a value that does not match the field it names', () => {
    expect(decodeEvent({ ...base, kind: 'stage.field-changed', key: 's1', field: 'name', value: ['a'] }).ok).toBe(false);
    expect(decodeEvent({ ...base, kind: 'stage.field-changed', key: 's1', field: 'onEnterPrompt', value: [{ to: 'a' }] }).ok).toBe(false);
    expect(decodeEvent({ ...base, kind: 'stage.field-changed', key: 's1', field: 'allowedTransitions', value: 'done' }).ok).toBe(false);
    expect(decodeEvent({ ...base, kind: 'group.field-changed', id: 'g', field: 'name', value: ['a'] }).ok).toBe(false);
    expect(decodeEvent({ ...base, kind: 'group.field-changed', id: 'g', field: 'columns', value: 'a' }).ok).toBe(false);
  });

  it('reports a newer event version instead of guessing', () => {
    expect(decodeEvent({ ...base, v: 4, kind: 'stage.removed', key: 's1' })).toEqual({ ok: false, reason: 'unsupported-version', version: 4 });
  });

  it('reports an unknown event kind instead of skipping it', () => {
    expect(decodeEvent({ ...base, kind: 'stage.teleported', key: 's1' })).toEqual({ ok: false, reason: 'unknown-kind', kind: 'stage.teleported' });
  });

  it('rejects a malformed event', () => {
    expect(decodeEvent({ ...base, kind: 'stage.removed' }).ok).toBe(false);
    expect(decodeEvent({ ...base, kind: 'stage.id-changed', key: 's1', from: 'a', id: '../escape' }).ok).toBe(false);
    expect(decodeEvent({ ...base, kind: 'stage.id-changed', key: 's1', from: 'a', id: 'ok', extra: 1 }).ok).toBe(false);
    expect(decodeEvent(null).ok).toBe(false);
    expect(decodeEvent([]).ok).toBe(false);
    expect(decodeEvent({ kind: 'stage.removed' }).ok).toBe(false);
  });
});
