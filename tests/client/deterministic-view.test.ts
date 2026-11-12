import { describe, expect, it } from 'vitest';
import { ownedScript, scriptActive, scriptLabel } from '../../src/client/deterministic-view.js';
import { projectScopeActivity } from '../../src/client/scope-activity.js';
import { buildHistoryRows } from '../../src/client/history/history-view.js';
import { AutoRunController } from '../../src/client/auto-run.js';
import { EMPTY_ATTENTION, type Task } from '../../src/shared/types.js';
import type { DeterministicSummary } from '../../src/shared/deterministic.js';
const task = { id: 'task', title: 'CI', columnId: 'wait', stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'stable', enteredAt: '2026-11-01T00:00:00Z' } } as Task;
const summary: DeterministicSummary = { entryId: 'entry', executionId: 'run', phase: 'active', startedAt: '2026-11-01T00:00:00Z', attempt: 1, restartCount: 0 };
describe('deterministic safe projections', () => {
  it('binds Stop and status to the current entry, not latest saved execution mode', () => {
    expect(ownedScript(task, summary)).toBe(summary);
    expect(ownedScript({ stageEntry: { ...task.stageEntry!, id: 'later-entry' } }, summary)).toBeUndefined();
  });
  it.each(['awaiting-trust', 'failed', 'stopped', 'result-ready', 'capture-pending'] as const)('does not pulse for %s', phase => {
    expect(scriptActive({ ...summary, phase })).toBe(false);
    expect(projectScopeActivity([task], {}, { task: { ...summary, phase } }).runningTasks).toBe(0);
  });
  it('counts each task once even with agents and scripts, and does not fabricate attention', () => {
    expect(projectScopeActivity([task], { task: { ...EMPTY_ATTENTION, running: true } }, { task: summary })).toMatchObject({ runningTasks: 1, unread: false, awaitingReply: false, failed: false });
    expect(projectScopeActivity([task], {}, { task: summary }).runningTasks).toBe(1);
    expect(scriptLabel({ ...summary, phase: 'stopping' })).toBe('Script stopping');
  });
  it('labels a parameter refusal distinctly from an executor failure', () => {
    const refusal = { code: 'PARAMETERS_REQUIRED', message: 'Missing required parameter: pipeline.' };
    expect(scriptLabel({ ...summary, phase: 'failed', error: refusal })).toBe('Script: parameters required');
    expect(scriptLabel({ ...summary, phase: 'failed', error: { code: 'TYPESCRIPT_ERROR', message: 'boom' } })).toBe('Script failed');
    expect(scriptLabel({ ...summary, phase: 'failed', deliveryStatus: 'failed', error: refusal })).toBe('Script result delivery failed');
  });
  it('cancels an instruction countdown when a durable script owns the entry', () => {
    const controller = new AutoRunController({ run: async () => { throw Error('not called'); }, clock: { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} } });
    controller.arm({ taskId: task.id, columnId: 'wait', enteredAt: 1, instruction: 'saved edit' });
    controller.reconcile([{ id: task.id, columnId: 'wait', stageEntry: { id: 'entry' }, instructionPending: { columnId: 'wait', enteredAt: 1 } }], { task: summary });
    expect(controller.getSnapshot()).toEqual({}); controller.dispose();
  });
  it('renders settled outcomes and provenance without resetting stage duration', () => {
    const rows = buildHistoryRows({ columns: [{ id: 'wait', name: 'CI' }, { id: 'done', name: 'Review' }], now: Date.parse('2026-11-01T01:00:00Z'), history: [
      { kind: 'stage', at: '2026-11-01T00:00:00Z', fromColumnId: 'start', columnId: 'wait' },
      { kind: 'deterministic-execution', at: '2026-11-01T00:10:00Z', columnId: 'wait', executionId: 'run', outcome: 'completed', exit: 'ok', message: '[REDACTED]' },
      { kind: 'deterministic-handoff', at: '2026-11-01T00:11:00Z', fromColumnId: 'wait', columnId: 'done', executionId: 'run', deliveryId: 'delivery', outcome: 'accepted', exit: 'ok', message: '[REDACTED]' },
    ] });
    expect(rows[0]?.detail).toContain('CI → Review · Execution run · Delivery delivery · Exit ok');
    expect(rows[0]?.duration).toBe('—'); expect(rows[2]?.duration).toBe('1 h 00 min');
  });
});
