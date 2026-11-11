import { describe, expect, it } from 'vitest';
import { mergeSnapshotFrame, SnapshotProtocolError } from '../../src/client/snapshot-merge.js';
import type { ConversationFacts, HostSnapshot, KanbanState } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';

const now = '2026-11-08T00:00:00Z';
const state: KanbanState = { hubs: [{ id: 'hub', name: 'Hub', revision: 1, projects: [], boards: [], tasks: [], notes: [], createdAt: now, updatedAt: now }], settings: { revision: 0 } };
const conversations: Record<string, ConversationFacts> = {};
function frame(overrides: Partial<HostSnapshot> = {}): HostSnapshot {
  return { sequence: 1, stateRevision: 1, conversations, sharing: {}, state, ...overrides };
}

describe('snapshot frame merge', () => {
  it('keeps the held state when an update omits it at the same revision', () => {
    const first = mergeSnapshotFrame(undefined, frame(), false);
    const { state: _state, ...update } = frame({ sequence: 2 });
    const merged = mergeSnapshotFrame(first, update, false);
    expect(merged.state).toBe(state);
    expect(merged.sequence).toBe(2);
  });

  it('reuses the held state object when a frame repeats the same revision', () => {
    const first = mergeSnapshotFrame(undefined, frame(), false);
    const echoed: KanbanState = { ...state };
    const merged = mergeSnapshotFrame(first, frame({ sequence: 2, state: echoed }), false);
    expect(merged.state).toBe(state);
  });

  it('replaces the state when the frame carries a new revision', () => {
    const first = mergeSnapshotFrame(undefined, frame(), false);
    const nextState: KanbanState = { ...state, settings: { revision: 1 } };
    const merged = mergeSnapshotFrame(first, frame({ sequence: 2, stateRevision: 2, state: nextState }), false);
    expect(merged.state).toBe(nextState);
  });

  it('carries the transient retained-checkout projection through a merge', () => {
    const retained = [{ path: '/worktrees/gone', projectId: 'p', taskTitle: 'Moved repo', reason: 'unresolved' as const }];
    const first = mergeSnapshotFrame(undefined, frame({ retainedCheckouts: retained }), false);
    expect(first.retainedCheckouts).toEqual(retained);
    const merged = mergeSnapshotFrame(first, frame({ sequence: 2, retainedCheckouts: retained }), false);
    expect(merged.retainedCheckouts).toEqual(retained);
  });

  it('always accepts the state on a baseline', () => {
    const first = mergeSnapshotFrame(undefined, frame(), false);
    const restarted: KanbanState = { ...state, settings: { revision: 0 } };
    const baseline = mergeSnapshotFrame(first, frame({ sequence: 0, state: restarted }), true);
    expect(baseline.state).toBe(restarted);
  });

  it('rejects a baseline without the board state', () => {
    const { state: _state, ...baseline } = frame();
    expect(() => mergeSnapshotFrame(undefined, baseline, true)).toThrow(SnapshotProtocolError);
  });

  it('rejects an update that changed the revision without the state', () => {
    const first = mergeSnapshotFrame(undefined, frame(), false);
    const { state: _state, ...update } = frame({ sequence: 2, stateRevision: 2 });
    expect(() => mergeSnapshotFrame(first, update, false)).toThrow(SnapshotProtocolError);
  });

  it('rejects an update before any state was available', () => {
    const { state: _state, ...update } = frame();
    expect(() => mergeSnapshotFrame(undefined, update, false)).toThrow(SnapshotProtocolError);
  });

  it('keeps the fact payload of the accepted frame', () => {
    const facts: ConversationFacts = { running: true, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null };
    const merged = mergeSnapshotFrame(undefined, frame({ conversations: { s1: facts } }), false);
    expect(merged.conversations.s1).toEqual(facts);
  });
});
