import { describe, expect, it, vi } from 'vitest';
import {
  createNativeSessionFacts, inspectedOpenTurn, lastSettledTurn, nativePending, partitionActivity,
} from '../../src/host/native-facts.js';

const inspection = (events: Array<{ type: string; data: unknown; seq?: number }> = []) => ({
  meta: { cwd: '/repo' },
  events: events.map((event, index) => ({ ...event, seq: event.seq ?? index + 1 })),
});
const sequenced = (values: Record<string, unknown> = {}) => ({ values });

describe('native activity partition', () => {
  it('treats the turn family and owned descendants as agent execution and keeps jobs and schedules in the background', () => {
    expect(partitionActivity([{ kind: 'turn' }])).toEqual({ running: true, background: [] });
    expect(partitionActivity([{ kind: 'subagent', items: [{ id: 'child', label: 'Research' }] }])).toEqual({ running: true, background: [] });
    expect(partitionActivity([
      { kind: 'job', items: [{ id: 'job-1', label: 'Run tests' }] },
      { kind: 'subagent', items: [{ id: 'child', label: 'Research' }] },
      { kind: 'schedule', items: [{ id: 'schedule-1', label: 'Wake later' }] },
    ])).toEqual({
      running: true,
      background: [
        { kind: 'job', label: 'Run tests' },
        { kind: 'schedule', label: 'Wake later' },
      ],
    });
  });

  it('keeps agent execution and background together and ignores unknown families', () => {
    expect(partitionActivity([
      { kind: 'turn' },
      { kind: 'job', items: [{ id: 'job-1', label: 'Run tests' }] },
      { kind: 'future-family', items: [{ id: 'future', label: 'Ignored' }] },
    ])).toEqual({ running: true, background: [{ kind: 'job', label: 'Run tests' }] });
  });

  it('falls back to the item id, then the family name, when no label is available', () => {
    expect(partitionActivity([
      { kind: 'job', items: [{ id: 'job-1' }, { id: ' ' }] },
      { kind: 'schedule' },
    ])).toEqual({
      running: false,
      background: [
        { kind: 'job', label: 'job-1' },
        { kind: 'job', label: 'job' },
        { kind: 'schedule', label: 'schedule' },
      ],
    });
  });

  it('reads an empty waterfall as idle', () => {
    expect(partitionActivity([])).toEqual({ running: false, background: [] });
  });
});

describe('native session facts', () => {
  it('combines the activity families, pending interaction, and settled turn in one read', async () => {
    const activity = vi.fn(async () => [
      { kind: 'turn' },
      { kind: 'job', items: [{ id: 'job-1', label: 'Run tests' }] },
    ]);
    const projections = vi.fn(async () => sequenced({ userQuestions: { active: [{ callId: 'q' }] } }));
    const inspect = vi.fn(async () => inspection([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'approval/asked', data: { id: 'approval-1' } },
      { type: 'approval/asked', data: { id: 'approval-2' } },
      { type: 'approval/decided', data: { id: 'approval-1' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, seq: 11 },
    ]));
    const facts = createNativeSessionFacts({ activity, projections, inspect });
    expect(await facts.read('session-1')).toEqual({
      running: true,
      background: [{ kind: 'job', label: 'Run tests' }],
      pending: { kinds: ['native-question'], queuedPrompts: 0 },
      settledTurn: { seq: 11, outcome: 'ok' },
    });
    expect(activity).toHaveBeenCalledWith('session-1');
    expect(projections).toHaveBeenCalledWith('session-1');
    expect(inspect).toHaveBeenCalledWith('session-1');
  });

  it('uses the incremental fold for a live Session without inspecting its history', async () => {
    const activity = vi.fn(async () => [{ kind: 'turn' }]);
    const projections = vi.fn(async () => sequenced());
    const inspect = vi.fn(async () => inspection());
    const facts = createNativeSessionFacts({
      activity, projections, inspect,
      liveFacts: () => ({ lastTurnEndSeq: 9, lastTurnOutcome: 'error', openApprovalIds: [] }),
    });
    expect(await facts.read('session-1')).toEqual({
      running: true,
      background: [],
      pending: { kinds: [], queuedPrompts: 0 },
      settledTurn: { seq: 9, outcome: 'error' },
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('keeps an open approval from the fold as awaiting a reply', async () => {
    const facts = createNativeSessionFacts({
      activity: async () => [], projections: async () => null, inspect: async () => inspection(),
      liveFacts: () => ({ lastTurnEndSeq: null, lastTurnOutcome: null, openApprovalIds: ['approval-1'] }),
    });
    expect((await facts.read('session-1')).pending.kinds).toEqual(['approval']);
  });

  it('reports the last settled turn regardless of an open turn', async () => {
    const inspect = vi.fn(async () => inspection([
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, seq: 3 },
      { type: 'turn/start', data: { turn: 2 } },
    ]));
    const facts = createNativeSessionFacts({
      activity: async () => [{ kind: 'turn' }], projections: async () => null, inspect,
    });
    expect((await facts.read('session-1')).settledTurn).toEqual({ seq: 3, outcome: 'ok' });
  });
});

describe('pending user work', () => {
  it('reports a queued prompt next to the native pending kinds', async () => {
    const facts = createNativeSessionFacts({
      activity: async () => [], projections: async () => sequenced({ userQuestions: { active: [{ callId: 'q' }] } }), inspect: async () => inspection(),
      liveFacts: () => ({ lastTurnEndSeq: null, lastTurnOutcome: null, openApprovalIds: ['approval-1'] }),
      queuedPrompts: () => 2,
    });
    expect((await facts.read('session-1')).pending).toEqual({ kinds: ['native-question', 'approval', 'queued-prompt'], queuedPrompts: 2 });
  });

  it('reports a queued prompt alone as pending', async () => {
    const facts = createNativeSessionFacts({
      activity: async () => [], projections: async () => null, inspect: async () => inspection(), queuedPrompts: () => 1,
    });
    expect((await facts.read('session-1')).pending).toEqual({ kinds: ['queued-prompt'], queuedPrompts: 1 });
  });

  it('fails closed when the queued-prompt read is unavailable', async () => {
    const facts = createNativeSessionFacts({
      activity: async () => [], projections: async () => null, inspect: async () => inspection(),
      queuedPrompts: () => { throw new Error('inbox unavailable'); },
    });
    await expect(facts.read('session-1')).rejects.toThrow('inbox unavailable');
  });
});

describe('settled turn detection', () => {
  it('uses the last recorded turn outcome and its durable sequence', () => {
    expect(lastSettledTurn(inspection([{ type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } }, seq: 5 }]))).toEqual({ seq: 5, outcome: 'error' });
    expect(lastSettledTurn(inspection([{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, seq: 5 }]))).toEqual({ seq: 5, outcome: 'ok' });
    expect(lastSettledTurn(inspection())).toBeNull();
  });

  it('recovers on a later successful turn and never compares sequences across conversations', () => {
    expect(lastSettledTurn(inspection([
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } }, seq: 5 },
      { type: 'turn/start', data: { turn: 2 }, seq: 6 },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } }, seq: 7 },
    ]))).toEqual({ seq: 7, outcome: 'ok' });
  });
});

describe('native pending interaction', () => {
  it('recognizes active and continued questions from the projection', () => {
    expect(nativePending(sequenced({ userQuestions: { active: [{ callId: 'q', state: 'continued' }] } }), inspection())).toBe(true);
    expect(nativePending(sequenced({ userQuestions: { active: [] } }), inspection())).toBe(false);
    expect(nativePending(sequenced(), inspection())).toBe(false);
    expect(nativePending(null, inspection())).toBe(false);
    expect(nativePending(undefined, inspection())).toBe(false);
  });

  it('tracks approvals until they are decided or the turn ends', () => {
    expect(nativePending(sequenced(), inspection([
      { type: 'approval/asked', data: { id: 'a' } },
      { type: 'approval/decided', data: { id: 'a' } },
    ]))).toBe(false);
    expect(nativePending(sequenced(), inspection([
      { type: 'approval/asked', data: { id: 'a' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]))).toBe(false);
    expect(nativePending(sequenced(), inspection([{ type: 'approval/asked', data: { id: 'a' } }]))).toBe(true);
  });

  it('recognizes an open turn boundary only until its recorded end', () => {
    expect(inspectedOpenTurn(inspection())).toBe(false);
    expect(inspectedOpenTurn(inspection([{ type: 'turn/start', data: { turn: 1 } }]))).toBe(true);
    expect(inspectedOpenTurn(inspection([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]))).toBe(false);
  });
});
