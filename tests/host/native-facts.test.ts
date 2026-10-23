import { describe, expect, it, vi } from 'vitest';
import {
  createNativeSessionFacts, inspectedOpenTurn, lastOutcomeFailed, nativePending, partitionActivity,
} from '../../src/host/native-facts.js';

const inspection = (events: Array<{ type: string; data: unknown }> = []) => ({ meta: { cwd: '/repo' }, events });
const sequenced = (values: Record<string, unknown> = {}) => ({ values });

describe('native activity partition', () => {
  it('treats only the turn family as execution and maps every other known family to background items', () => {
    expect(partitionActivity([{ kind: 'turn' }])).toEqual({ turn: true, background: [] });
    expect(partitionActivity([
      { kind: 'job', items: [{ id: 'job-1', label: 'Run tests' }] },
      { kind: 'subagent', items: [{ id: 'child', label: 'Research' }] },
      { kind: 'schedule', items: [{ id: 'schedule-1', label: 'Wake later' }] },
    ])).toEqual({
      turn: false,
      background: [
        { kind: 'job', label: 'Run tests' },
        { kind: 'subagent', label: 'Research' },
        { kind: 'schedule', label: 'Wake later' },
      ],
    });
  });

  it('keeps turn and background together and ignores unknown families', () => {
    expect(partitionActivity([
      { kind: 'turn' },
      { kind: 'job', items: [{ id: 'job-1', label: 'Run tests' }] },
      { kind: 'future-family', items: [{ id: 'future', label: 'Ignored' }] },
    ])).toEqual({ turn: true, background: [{ kind: 'job', label: 'Run tests' }] });
  });

  it('falls back to the item id, then the family name, when no label is available', () => {
    expect(partitionActivity([
      { kind: 'job', items: [{ id: 'job-1' }, { id: ' ' }] },
      { kind: 'subagent' },
    ])).toEqual({
      turn: false,
      background: [
        { kind: 'job', label: 'job-1' },
        { kind: 'job', label: 'job' },
        { kind: 'subagent', label: 'subagent' },
      ],
    });
  });

  it('reads an empty waterfall as idle', () => {
    expect(partitionActivity([])).toEqual({ turn: false, background: [] });
  });
});

describe('native session facts', () => {
  it('combines the activity families, pending interaction, and last outcome in one read', async () => {
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
    ]));
    const facts = createNativeSessionFacts({ activity, projections, inspect });
    expect(await facts.read('session-1')).toEqual({
      turn: true,
      background: [{ kind: 'job', label: 'Run tests' }],
      awaitingReply: true,
      failed: false,
    });
    expect(activity).toHaveBeenCalledWith('session-1');
    expect(projections).toHaveBeenCalledWith('session-1');
    expect(inspect).toHaveBeenCalledWith('session-1');
  });

  it('reports failure only from the last recorded turn outcome', async () => {
    const failed = inspection([{ type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } }]);
    const recovered = inspection([
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    ]);
    expect(lastOutcomeFailed(failed)).toBe(true);
    expect(lastOutcomeFailed(recovered)).toBe(false);
    expect(lastOutcomeFailed(inspection())).toBe(false);
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
