import { describe, expect, it } from 'vitest';
import { emptyRecord, readSharingRecord } from '../../src/host/sharing/state.js';

const NOW = '2026-01-01T00:00:00.000Z';
const binding = { provider: 'local-folder' as const, intervalMinutes: 1, settings: { path: '/team' } };

describe('sharing state', () => {
  it('reads the current record shape', () => {
    const record = emptyRecord('hub', binding, NOW);
    expect(readSharingRecord(record)).toEqual(record);
  });

  it('ignores a record written by another layout version', () => {
    expect(readSharingRecord({ ...emptyRecord('hub', binding, NOW), version: 3 })).toBeUndefined();
  });

  it('rejects an unknown provider', () => {
    expect(readSharingRecord({ ...emptyRecord('hub', binding, NOW), binding: { ...binding, provider: 'dropbox' } })).toBeUndefined();
  });

  it('keeps a placement with nothing applied through a round trip', () => {
    const record = emptyRecord('hub', binding, NOW);
    record.boards.flow = { seq: -1, head: null, probe: null, present: false, workflow: null, name: null, projectKeys: null, rank: null, updates: 0, removal: false, incoming: null, conflict: null, problem: null };
    expect(readSharingRecord(record)?.boards.flow).toEqual(record.boards.flow);
  });

  it('keeps the locally applied board version through a round trip', () => {
    const record = emptyRecord('hub', binding, NOW);
    record.boards.flow = { seq: 3, head: 'head', probe: 'probe', present: true, workflow: 'name: Flow\ncolumns: []\n', name: 'Flow', projectKeys: null, rank: 'i', updates: 0, removal: false, incoming: null, conflict: null, problem: null };
    expect(readSharingRecord(record)?.boards.flow).toEqual(record.boards.flow);
  });
});
