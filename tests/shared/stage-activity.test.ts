import { describe, expect, it } from 'vitest';
import { describeStageActivity, hasInFlightWork, persistedStageActivity } from '../../src/shared/stage-activity.js';

describe('stage activity', () => {
  it('reports no reason for an idle task', () => {
    expect(persistedStageActivity({})).toEqual([]);
    expect(hasInFlightWork([])).toBe(false);
  });

  it('names every persisted reason that blocks a rename', () => {
    expect(persistedStageActivity({ pendingTransition: { status: 'waiting' } })).toEqual(['a pending transition']);
    expect(persistedStageActivity({ autoMode: { enabled: true } })).toEqual(['auto mode is armed']);
    expect(persistedStageActivity({ autoMode: { enabled: false } })).toEqual([]);
    expect(persistedStageActivity({ instructionPending: { columnId: 'plan' } })).toEqual(['an unresolved stage instruction']);
    expect(persistedStageActivity({ operation: { id: 'op' } })).toEqual(['an operation in progress']);
    expect(persistedStageActivity({ worktree: { status: 'preparing' } })).toEqual(['a worktree being prepared']);
    expect(persistedStageActivity({ worktree: { status: 'error' } })).toEqual(['a worktree in error']);
    expect(persistedStageActivity({ worktree: { status: 'ready' } })).toEqual([]);
  });

  it('describes the collected reasons once each', () => {
    expect(describeStageActivity(['a running conversation', 'auto mode is armed', 'auto mode is armed'])).toBe('a running conversation, auto mode is armed');
  });
});
