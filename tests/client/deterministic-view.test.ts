import { describe, expect, it } from 'vitest';
import { ownedScript, scriptActive, scriptCardLabel, scriptFailureFacts, scriptLabel } from '../../src/client/deterministic-view.js';
import type { GuardFacts } from '../../src/shared/deterministic-failure.js';
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
  it('presents the failure origin, code, attempts and bounded guard facts', () => {
    const guard: GuardFacts = { admission: 'not-admitted', exitCode: 125, signal: null, timedOut: false, aborted: false, elapsedMs: 20, stdoutBytes: 0, stdoutHead: '', stderrBytes: 34, stderrTail: 'NATIVE_LIFETIME_UNCLEAN: cleanup\n' };
    const failed = { ...summary, phase: 'failed' as const, error: { code: 'BASH_PROTOCOL', message: 'Infrastructure failure: the guard did not admit the command. (2 attempts) Detail: the task History.', details: { origin: 'infrastructure', attempts: [{ attempt: 1, code: 'BASH_PROTOCOL', guard }, { attempt: 2, code: 'BASH_PROTOCOL', guard }], guard } } };
    expect(scriptLabel(failed)).toBe('Script: infrastructure failure');
    expect(scriptFailureFacts(failed)).toEqual([
      { label: 'Failure origin', value: 'infrastructure' },
      { label: 'Failure code', value: 'BASH_PROTOCOL' },
      { label: 'Attempts', value: '2' },
      { label: 'Guard', value: 'command not admitted' },
      { label: 'Guard exit', value: '125' },
      { label: 'Guard time', value: '20 ms' },
      { label: 'Guard output', value: '0 B stdout · 34 B stderr' },
      { label: 'Guard diagnostic', value: 'NATIVE_LIFETIME_UNCLEAN: cleanup' },
    ]);
    expect(scriptCardLabel(failed)).toBe('Script: tool failure');
    expect(failed.error.message).not.toContain('    at ');
    expect(scriptLabel({ ...summary, phase: 'failed' as const, error: { code: 'EXECUTION_CONTEXT_CHANGED', message: 'Configuration failure: changed.', details: { origin: 'configuration' } } })).toBe('Script: configuration failure');
    expect(scriptLabel({ ...summary, phase: 'failed' as const, error: { code: 'INVALID_COMPLETION', message: 'rejected', details: { origin: 'contract' } } })).toBe('Script: completion rejected');
    expect(scriptCardLabel({ ...summary, phase: 'failed' as const, error: { code: 'EXECUTION_CONTEXT_CHANGED', message: 'changed', details: { origin: 'configuration' } } })).toBe('Script: setup problem');
  });
  it('shows the nested cause and the guard windows a layered failure carries', () => {
    const guard: GuardFacts = { admission: 'started', exitCode: 125, signal: null, timedOut: false, aborted: false, elapsedMs: 10_012, stdoutBytes: 12, stdoutHead: 'partial', stderrBytes: 40, stderrTail: 'NATIVE_LIFETIME_UNCLEAN: cleanup' };
    const failed = { ...summary, phase: 'failed' as const, error: { code: 'OWNERSHIP_UNCERTAIN', message: 'Native cleanup could not confirm quiescence.', details: { origin: 'infrastructure', guard, cause: { code: 'BASH_PROTOCOL', message: 'Error: boom\n    at x' } } } };
    const facts = scriptFailureFacts(failed);
    expect(facts).toContainEqual({ label: 'Cause', value: 'BASH_PROTOCOL — Error: boom\n    at x' });
    expect(facts).toContainEqual({ label: 'Guard time', value: '10012 ms' });
    expect(facts).toContainEqual({ label: 'Guard output', value: '12 B stdout · 40 B stderr' });
  });
  it('keeps the generic label and no facts for a record written before the vocabulary', () => {
    const legacy = { ...summary, phase: 'failed' as const, error: { code: 'TYPESCRIPT_ERROR', message: 'boom' } };
    expect(scriptLabel(legacy)).toBe('Script failed');
    expect(scriptFailureFacts(legacy)).toEqual([]);
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
