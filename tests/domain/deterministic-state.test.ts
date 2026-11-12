import { describe, expect, it } from 'vitest';
import { createTask, placeTask, saveBoardWorkflow, updateBoardStage } from '../../src/domain/hub-operations.js';
import { HubStateSchema } from '../../src/domain/hub-schema.js';
import { acceptsDeterministicResult, deterministicCurrent, ensureLocalStageIdentity, ownsDeterministicEntry, reconcileLocalStageIdentities, resolveDeterministicTarget } from '../../src/domain/deterministic-state.js';
import { advanceArmed, resolveAdvanceRoute } from '../../src/domain/transition-route.js';
import { resolveAdvanceDecision } from '../../src/domain/auto-advance.js';
import { hasUnresolvedEntry } from '../../src/domain/stage-entry.js';
import { recordDeterministicExecution, recordDeterministicHandoff } from '../../src/domain/task-history/record.js';
import { sampleHub, operationDeps } from './hub-helpers.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { renameTaskStage } from '../../src/domain/stage-update.js';
import { persistedStageActivity } from '../../src/shared/stage-activity.js';

const YAML = 'columns:\n  - id: wait\n    label: Wait\n    deterministic: {language: bash, code: "echo ready", exits: {ok: done}}\n  - {id: done, label: Done}\n';
function fixture() {
  const hub = sampleHub(); const deps = operationDeps();
  saveBoardWorkflow(hub, 'board', YAML, deps);
  const task = createTask(hub, { boardId: 'board', projectId: 'project', title: 'Wait', description: '', autoMode: false }, deps);
  return { hub, deps, task, board: hub.boards[0]! };
}
describe('durable deterministic stage entry', () => {
  it('creates the entry and immutable capture request in the same durable aggregate without a conversation', () => {
    const { hub, task, board } = fixture();
    expect(task.stageEntry?.id).toBe(task.deterministic?.entryId);
    expect(task.deterministic).toMatchObject({ phase: 'capture-pending', definition: board.workflow.columns[0]?.deterministic, attempt: 0 });
    expect(task.instructionPending).toBeUndefined(); expect(task.sessionIds).toEqual([]);
    const recovered = HubStateSchema.parse(JSON.parse(JSON.stringify(hub)));
    expect(recovered.tasks[0]?.deterministic).toEqual(task.deterministic);
    expect(board.workflowYaml).not.toContain('key:');
    expect(board.localStageIdentities?.wait).toBe(task.stageEntry?.stageIdentity);
  });
  it('binds declared parameter values to the entry and never to a later entry', () => {
    const hub = sampleHub(); const deps = operationDeps();
    saveBoardWorkflow(hub, 'board', 'columns:\n  - id: wait\n    label: Wait\n    deterministic: {language: bash, code: "echo ready", params: [{name: pipeline}], exits: {ok: done}}\n  - {id: done, label: Done}\n', deps);
    const task = createTask(hub, { boardId: 'board', projectId: 'project', title: 'Wait', description: '', autoMode: false }, deps);
    expect(task.deterministic?.parameters).toBeUndefined();
    task.deterministic!.parameters = { pipeline: 'ci' };
    placeTask(hub, task.id, 'done', 'start', 100, { at: deps.now() });
    placeTask(hub, task.id, 'wait', 'start', 101, { at: deps.now() });
    expect(task.deterministic?.entryId).toBe(task.stageEntry?.id);
    expect(task.deterministic?.parameters).toBeUndefined();
    placeTask(hub, task.id, 'done', 'start', 102, { at: deps.now() });
    placeTask(hub, task.id, 'wait', 'start', 103, { at: deps.now(), parameters: { pipeline: 'ci-other' } });
    expect(task.deterministic?.parameters).toEqual({ pipeline: 'ci-other' });
    expect(HubStateSchema.parse(JSON.parse(JSON.stringify(hub))).tasks[0]?.deterministic?.parameters).toEqual({ pipeline: 'ci-other' });
    task.deterministic!.parameters = { 'bad name': 'x' };
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
  });
  it('keeps capture-pending source after edits and makes same-stage reorder nonactivating', () => {
    const { hub, deps, task } = fixture(); const original = structuredClone(task.deterministic); const entry = structuredClone(task.stageEntry);
    saveBoardWorkflow(hub, 'board', YAML.replace('echo ready', 'echo changed'), deps);
    placeTask(hub, task.id, 'wait', 'start', 99, { at: deps.now() });
    expect(task.deterministic).toEqual(original); expect(task.stageEntry).toEqual(entry);
    expect(task.history).toHaveLength(1);
  });
  it('never activates legacy occupied cards after loading or a configuration-only edit', () => {
    const { hub, deps, task } = fixture(); delete task.stageEntry; delete task.deterministic;
    const recovered = HubStateSchema.parse(hub); expect(recovered.tasks[0]?.deterministic).toBeUndefined();
    saveBoardWorkflow(hub, 'board', YAML.replace('echo ready', 'echo changed'), deps);
    expect(task.deterministic).toBeUndefined();
  });
  it('allocates fresh authority after move-away-and-back and rejects stale attempt results', () => {
    const { hub, deps, task } = fixture(); const old = task.deterministic!;
    old.phase = 'active'; old.attemptId = 'attempt-1';
    const expected = { entryId: old.entryId, executionId: old.executionId, attemptId: 'attempt-1' };
    expect(acceptsDeterministicResult(task, expected)).toBe(true);
    placeTask(hub, task.id, 'done', 'start', 100, { at: deps.now() });
    placeTask(hub, task.id, 'wait', 'start', 101, { at: deps.now() });
    expect(task.deterministic?.entryId).not.toBe(expected.entryId);
    expect(deterministicCurrent(task, expected)).toBe(false); expect(acceptsDeterministicResult(task, expected)).toBe(false);
  });
  it.each(['capture-pending','awaiting-trust','active','stopping','stopped','result-ready','delivering','failed'] as const)('suppresses incidental turns after saved mode changes while %s owns the entry', phase => {
    const { hub, deps, task, board } = fixture(); task.deterministic!.phase = phase; task.autoMode = { enabled: true };
    saveBoardWorkflow(hub, 'board', YAML.replace('    deterministic: {language: bash, code: "echo ready", exits: {ok: done}}','    on_enter_prompt: Agent now'), deps);
    task.instructionPending = { columnId: 'wait', enteredAt: 10 };
    expect(ownsDeterministicEntry(task)).toBe(true); expect(advanceArmed(board.workflow, task)).toBe(false); expect(resolveAdvanceRoute(board.workflow, task)).toEqual({ kind: 'none' });
    expect(resolveAdvanceDecision(task, new Map())).toEqual({ kind: 'busy' }); expect(hasUnresolvedEntry(task)).toBe(false);
  });
  it.each(['stopped','failed','result-ready','delivering','stopping','awaiting-trust','capture-pending'] as const)('does not accept terminal results from %s', phase => {
    const { task } = fixture(); const control = task.deterministic!; control.phase = phase; control.attemptId = 'current';
    expect(acceptsDeterministicResult(task, { entryId: control.entryId, executionId: control.executionId, attemptId: 'current' })).toBe(false);
  });
  it('rejects every stale currency dimension and accepts only an active uncompleted attempt', () => {
    const { task } = fixture(); const control = task.deterministic!; control.phase = 'active'; control.attemptId = 'current';
    const expected = { entryId: control.entryId, executionId: control.executionId, attemptId: 'current' };
    for (const key of ['entryId', 'executionId', 'attemptId'] as const) expect(acceptsDeterministicResult(task, { ...expected, [key]: 'stale' })).toBe(false);
    control.result = { id: 'result', exit: 'ok', message: '', at: control.startedAt };
    expect(acceptsDeterministicResult(task, expected)).toBe(false);
  });
});

describe('local stage association and captured targets', () => {
  it('rejects unsafe or colliding local stage scope allocations', () => {
    const { hub, board } = fixture(); const choices = ['../unsafe', board.localStageIdentities!.wait!, 'unique-stage'];
    delete board.localStageIdentities!.done;
    expect(ensureLocalStageIdentity(board, 'done', () => choices.shift()!)).toBe('unique-stage');
    board.localStageIdentities!.done = board.localStageIdentities!.wait!;
    expect(HubStateSchema.safeParse(hub).success).toBe(false);
    expect(() => ensureLocalStageIdentity(board, 'done', () => 'unused')).toThrow();
  });
  it('preserves local scope through rename, first publication, and a later team rename', () => {
    const { hub, deps, task, board } = fixture(); task.deterministic!.phase = 'stopped';
    const identity = ensureLocalStageIdentity(board, 'done', deps.id);
    updateBoardStage(hub, 'board', { stageId: 'done', patch: { id: 'ready' } }, deps);
    expect(board.localStageIdentities?.ready).toBe(identity);
    expect(board.workflowYaml).not.toContain('key:');
    saveBoardWorkflow(hub, 'board', board.workflowYaml.replace('id: ready', 'id: ready, key: published-target'), deps);
    expect(board.localStageIdentities?.ready).toBe(identity);
    const next = parseWorkflow(board.workflowYaml.replaceAll('ready', 'shipped'));
    reconcileLocalStageIdentities(board, next); board.workflow = next;
    expect(resolveDeterministicTarget(board, { columnId: 'done', stageIdentity: identity })?.id).toBe('shipped');
  });
  it('freezes target identities with capture-pending intent, before any source I/O', () => {
    const { hub, deps, task, board } = fixture(); const targets = structuredClone(task.deterministic!.targets!);
    expect(targets.ok?.columnId).toBe('done'); expect(targets.ok?.stageIdentity).toBe(board.localStageIdentities?.done);
    task.deterministic!.phase = 'stopped';
    updateBoardStage(hub, 'board', { stageId: 'done', patch: { id: 'renamed' } }, deps);
    expect(task.deterministic!.targets).toEqual(targets);
    expect(resolveDeterministicTarget(board, targets.ok!)?.id).toBe('renamed');
  });
  it('does not inherit scope or route authority after removal and identifier reuse', () => {
    const { hub, deps, task, board } = fixture(); task.deterministic!.phase = 'stopped';
    const identity = ensureLocalStageIdentity(board, 'done', deps.id);
    const noTarget = 'columns: [{id: wait, label: Wait}]\n';
    saveBoardWorkflow(hub, 'board', noTarget, deps); saveBoardWorkflow(hub, 'board', YAML, deps);
    expect(ensureLocalStageIdentity(board, 'done', deps.id)).not.toBe(identity);
    expect(resolveDeterministicTarget(board, { columnId: 'done', stageIdentity: identity })).toBeUndefined();
  });
  it('migrates entry and handoff references without rewriting approved program bytes', () => {
    const { task } = fixture();
    const original = structuredClone(task.deterministic);
    task.deterministicHandoff = { id: 'handoff', entryId: task.stageEntry!.id, executionId: 'source', fromColumnId: 'done', columnId: 'wait', exit: 'ok', message: 'Wait', at: task.createdAt };
    renameTaskStage(task, 'wait', 'renamed');
    expect(task.stageEntry?.columnId).toBe('renamed'); expect(task.deterministicHandoff.columnId).toBe('renamed'); expect(task.deterministic).toEqual(original);
  });
});

describe('settled execution history', () => {
  it('rejects failed outcomes without their diagnostic instead of silently recording progress', async () => {
    const { task } = fixture(); const { taskHistorySchema } = await import('../../src/domain/task-history/entry.js');
    expect(taskHistorySchema.safeParse([{ kind: 'deterministic-execution', at: task.createdAt, executionId: 'run', columnId: 'wait', outcome: 'failed' }]).success).toBe(false);
    expect(taskHistorySchema.safeParse([{ kind: 'deterministic-handoff', at: task.createdAt, executionId: 'run', deliveryId: 'delivery', fromColumnId: 'wait', columnId: 'done', outcome: 'failed', exit: 'ok', message: 'Ready' }]).success).toBe(false);
  });
  it('dedupes recovered run outcomes and delivery receipts but retains separate Play runs', () => {
    const { task } = fixture(); const at = task.createdAt;
    for (const executionId of ['run-1','run-1','run-2']) recordDeterministicExecution(task, { at, executionId, columnId: 'wait', outcome: 'completed', exit: 'ok', message: 'Ready' });
    for (let i = 0; i < 2; i++) recordDeterministicHandoff(task, { at, executionId: 'run-1', deliveryId: 'delivery', fromColumnId: 'wait', columnId: 'done', outcome: 'accepted', exit: 'ok', message: 'Ready' });
    expect(task.history?.filter(value => value.kind === 'deterministic-execution')).toHaveLength(2);
    expect(task.history?.filter(value => value.kind === 'deterministic-handoff')).toHaveLength(1);
    expect(task.history?.filter(value => value.kind === 'created' || value.kind === 'stage')).toHaveLength(1);
    expect(persistedStageActivity(task)).toContain('a deterministic execution');
  });
});
