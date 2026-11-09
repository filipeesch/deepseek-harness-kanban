// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mergeSnapshotFrame } from '../../src/client/snapshot-merge.js';
import type { HostSnapshot } from '../../src/shared/types.js';

const state = { hubs: [], settings: { revision: 0 } };
function frame(overrides: Partial<HostSnapshot> = {}): HostSnapshot {
  return { stateRevision: 1, conversations: {}, sharing: {}, sequence: 1, ...overrides };
}

describe('snapshot merge with schedule runtime', () => {
  it('replaces the runtime projection while keeping unchanged durable state', () => {
    const baseline = mergeSnapshotFrame(undefined, frame({ state, scheduleRuntime: { hub: { schedule: { running: true } } } }), true);
    const update = frame({ sequence: 2, scheduleRuntime: { hub: { schedule: { running: false, lastRun: { status: 'sent', at: '2026-01-01T09:00:00.000Z', manual: false, sessionId: 's' } } } } });
    const merged = mergeSnapshotFrame(baseline, update, false);
    expect(merged.state).toBe(baseline.state);
    expect(merged.scheduleRuntime?.hub?.schedule).toEqual({ running: false, lastRun: { status: 'sent', at: '2026-01-01T09:00:00.000Z', manual: false, sessionId: 's' } });
  });
});
