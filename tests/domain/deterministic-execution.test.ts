import { describe, expect, it } from 'vitest';
import { readExecutionState, EXECUTION_HISTORY_LIMIT } from '../../src/domain/deterministic-execution.js';
import type { DeterministicControl } from '../../src/shared/deterministic.js';
import type { TaskHistoryEntry } from '../../src/shared/task-history.js';

const AT = '2026-11-13T10:00:00.000Z';

function control(overrides: Partial<DeterministicControl> = {}): DeterministicControl {
  return {
    entryId: 'entry-1', executionId: 'exec-1', stageIdentity: 'stage-run',
    definition: { language: 'bash', code: 'echo hi', directory: 'task', params: [{ name: 'pipeline' }], exits: { passed: 'review' } },
    parameters: { pipeline: 'ci-main' },
    phase: 'active', startedAt: AT, attempt: 2, restartCount: 1,
    ...overrides,
  };
}

const stageEntry = { id: 'entry-1', columnId: 'run', stageIdentity: 'stage-run', enteredAt: AT };

describe('execution state read', () => {
  it('reports a task that never ran a script', () => {
    const read = readExecutionState({ taskId: 'task-1', available: true });
    expect(read).toMatchObject({ taskId: 'task-1', available: true, stage: null, execution: null, handoff: null, history: [] });
  });

  it('reports a running execution with its declared values and captured version', () => {
    const read = readExecutionState({
      taskId: 'task-1', available: true, stageEntry, control: control(),
      stage: { id: 'run', name: 'Run the checks', identity: 'stage-run', deterministic: { language: 'bash', code: 'echo hi', directory: 'task', params: [{ name: 'pipeline' }], exits: { passed: 'review' } } },
    });
    expect(read.stage).toEqual({ columnId: 'run', name: 'Run the checks', entryId: 'entry-1', stageIdentity: 'stage-run', enteredAt: AT });
    expect(read.execution).toMatchObject({
      phase: 'active', attempt: 2, restartCount: 1, owned: true,
      declaredParameters: ['pipeline'], missingParameters: [], parameters: { pipeline: 'ci-main' },
      savedVersionChanged: false,
    });
    expect(read.execution?.result).toBeUndefined();
    expect(read.execution?.version).toBeUndefined();
  });

  it('reports a saved result, its destination, and the action that clears the hold', () => {
    const read = readExecutionState({
      taskId: 'task-1', available: true, stageEntry,
      control: control({
        phase: 'result-ready',
        capture: { sourceRef: 'source-1', fingerprint: 'fp-1', language: 'bash', directory: 'task', executionDirectory: '/repo', source: { kind: 'inline' }, env: [], params: ['pipeline'], exits: { passed: { columnId: 'review', stageIdentity: 'stage-review' } } },
        result: { id: 'result-1', exit: 'passed', message: 'CI passed', at: AT, target: { columnId: 'review', stageIdentity: 'stage-review' }, deliveryStatus: 'pending' },
        hold: { code: 'background-work', at: AT, background: [{ kind: 'job', id: 'job-7', label: 'wait-ci' }] },
      }),
      destinations: { review: { name: 'Review', identity: 'stage-review' } },
    });
    expect(read.execution?.result).toMatchObject({
      exit: 'passed', message: 'CI passed', deliveryStatus: 'pending',
      destination: { columnId: 'review', stageName: 'Review', resolved: true },
    });
    expect(read.execution?.hold).toMatchObject({ code: 'background-work', background: [{ kind: 'job', id: 'job-7', label: 'wait-ci' }] });
    expect(read.execution?.hold && 'pending' in read.execution.hold).toBe(false);
    expect(read.execution?.hold?.action).toContain('Cancel the blocking job');
    expect(read.execution?.version).toEqual({ fingerprint: 'fp-1', language: 'bash', directory: 'task', source: 'inline' });
  });

  it('reports a destination whose captured identity no longer matches the stage', () => {
    const read = readExecutionState({
      taskId: 'task-1', available: true, stageEntry,
      control: control({ result: { id: 'r', exit: 'passed', message: 'ok', at: AT, target: { columnId: 'review', stageIdentity: 'stage-old' } } }),
      destinations: { review: { name: 'Review', identity: 'stage-new' } },
    });
    expect(read.execution?.result?.destination).toEqual({ columnId: 'review', stageName: 'Review', resolved: false });
  });

  it('reports an entry whose stage entry was replaced as no longer owned', () => {
    const read = readExecutionState({
      taskId: 'task-1', available: true,
      stageEntry: { ...stageEntry, id: 'entry-2' },
      control: control(),
    });
    expect(read.execution?.owned).toBe(false);
    expect(read.execution?.phase).toBe('active');
  });

  it('keeps the stored phase when the host cannot run scripts', () => {
    const read = readExecutionState({ taskId: 'task-1', available: false, stageEntry, control: control({ phase: 'result-ready' }) });
    expect(read.available).toBe(false);
    expect(read.execution?.phase).toBe('result-ready');
  });

  it('reports the newest execution and handoff facts, bounded', () => {
    const rows: TaskHistoryEntry[] = [];
    for (let index = 0; index < EXECUTION_HISTORY_LIMIT + 2; index += 1) {
      rows.push({ kind: 'deterministic-execution', at: '2026-11-13T10:0' + index + ':00.000Z', executionId: 'exec-' + index, columnId: 'run', outcome: 'completed', exit: 'passed', message: 'ok ' + index });
    }
    rows.push({ kind: 'created', at: AT, columnId: 'run' });
    rows.push({ kind: 'deterministic-handoff', at: '2026-11-13T11:00:00.000Z', deliveryId: 'delivery-1', executionId: 'exec-1', fromColumnId: 'run', columnId: 'review', outcome: 'accepted', exit: 'passed', message: 'CI passed' });
    const read = readExecutionState({ taskId: 'task-1', available: true, history: rows });
    expect(read.history).toHaveLength(EXECUTION_HISTORY_LIMIT);
    expect(read.historyOmitted).toBe(EXECUTION_HISTORY_LIMIT + 2 + 1 - EXECUTION_HISTORY_LIMIT);
    expect(read.history[0]).toMatchObject({ kind: 'handoff', outcome: 'accepted', fromColumnId: 'run', columnId: 'review' });
    expect(read.history.some(fact => fact.kind === 'execution' && fact.exit === 'passed')).toBe(true);
  });
});
