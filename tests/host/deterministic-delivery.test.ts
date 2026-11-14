import { describe, expect, it, vi } from 'vitest';
import { admitStageInstruction, type StageInstructionDeps } from '../../src/host/stage-instruction.js';
import { createStageDelivery } from '../../src/host/stage-delivery.js';
import type { Board, HubState, HubTask } from '../../src/shared/types.js';
import type { StageInstructionDelivery } from '../../src/shared/ports.js';
const at = '2026-11-01T00:00:00.000Z';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(ready => { resolve = ready; }); return { promise, resolve }; }
type WaitPoint = 'resolve-session' | 'execution-context' | 'native-resolve' | 'native-events';
function fixture(waitAt?: WaitPoint) {
  const task: HubTask = { id: 'task', boardId: 'board', projectId: 'project', title: 'Synthetic task', description: '', columnId: 'review', position: 0, sessionIds: ['session'], closedSessionIds: [], effectiveCwd: '/isolated', worktree: null, operation: null, createdAt: at, updatedAt: at,
    instructionPending: { columnId: 'review', enteredAt: 1 }, stageEntry: { id: 'entry', columnId: 'review', stageIdentity: 'stable-review', enteredAt: at },
    deterministicHandoff: { id: 'delivery', entryId: 'entry', executionId: 'source-run', fromColumnId: 'ci', columnId: 'review', exit: 'passed', message: 'Synthetic evidence [REDACTED]', instruction: 'Review it.', at } };
  const board: Board = { id: 'board', name: 'Board', workflowYaml: '', workflow: { name: 'Flow', initialColumnId: 'ci', columns: [{ id: 'ci', name: 'CI' }, { id: 'review', name: 'Review', onEnterPrompt: 'Review it.' }, { id: 'done', name: 'Done' }], groups: [] }, createdAt: at, updatedAt: at };
  const gate = deferred(); const started = deferred();
  async function wait(point: WaitPoint) { if (waitAt === point) { started.resolve(); await gate.promise; } }
  let logs: readonly unknown[] = [];
  let pending = false;
  const target = { pending: () => pending };
  const admitted: StageInstructionDelivery[] = [];
  const enqueue = vi.fn((_target: typeof target, delivery: StageInstructionDelivery) => { admitted.push(delivery); });
  const native = createStageDelivery({ resolve: async () => { await wait('native-resolve'); return target; }, events: async () => { await wait('native-events'); return logs; }, deliver: enqueue });
  const resolveSession = vi.fn(async () => { await wait('resolve-session'); return 'session'; });
  const transact = vi.fn(async (_hubId: string, change: (draft: HubState) => void) => { change({ tasks: [task] } as HubState); });
  const deps: StageInstructionDeps = { locate: () => ({ hubId: 'hub', task, board }), transact, resolveSession, assertExecutionContext: async () => { await wait('execution-context'); }, deliver: native };
  const run = () => admitStageInstruction(deps, { taskId: task.id, columnId: 'review', instruction: 'Review it.', expectedEntryId: 'entry', expectedEnteredAt: 1, requestId: 'delivery' });
  const replaceEntry = () => { task.stageEntry = { ...task.stageEntry!, id: 'later-entry' }; task.deterministicHandoff = { ...task.deterministicHandoff!, entryId: 'later-entry', id: 'later-delivery' }; };
  return { task, board, gate, started, deps, run, replaceEntry, admitted, enqueue, resolveSession, transact, setLogs: (events: readonly unknown[]) => { logs = events; }, setPending: (value: boolean) => { pending = value; } };
}
describe('combined deterministic instruction final admission guard', () => {
  it('admits one context containing destination instruction and separate result/provenance, not an agent reason', async () => {
    const f = fixture(); await f.run();
    expect(f.admitted).toHaveLength(1); const message = f.admitted[0]!;
    expect(message.requestId).toBe('delivery');
    expect(message.text).toBe('Review it.\n\nDeterministic result (from ci; exit: passed; execution: source-run):\nSynthetic evidence [REDACTED]');
    expect(message.text).not.toContain('Transition reason'); expect(message.summary).not.toContain('Synthetic evidence');
    expect(f.task.instructionPending).toBeUndefined(); expect(f.task.deterministicHandoff?.acceptedAt).toBeDefined();
    expect(f.task.recordedTransition).toBeUndefined(); expect(f.task.sessionIds).toEqual(['session']);
  });
  it('appends a bounded sent-parameters section and records the sent values on acceptance', async () => {
    const f = fixture();
    f.task.deterministicHandoff = { ...f.task.deterministicHandoff!, params: { pipeline: 'ci-main', commit: 'abc' } };
    await f.run();
    expect(f.admitted[0]!.text).toBe('Review it.\n\nDeterministic result (from ci; exit: passed; execution: source-run):\nSynthetic evidence [REDACTED]\n\nSent parameters:\npipeline: ci-main\ncommit: abc');
    expect(f.task.history?.find(value => value.kind === 'deterministic-handoff')).toMatchObject({ outcome: 'accepted', parameters: { pipeline: 'ci-main', commit: 'abc' } });
  });

  it('bounds the sent-parameters section so a large map cannot crowd the instruction', async () => {
    const f = fixture();
    f.task.deterministicHandoff = { ...f.task.deterministicHandoff!, params: { pipeline: 'x'.repeat(4096), commit: 'y'.repeat(4096) } };
    await f.run();
    expect(f.admitted[0]!.text).toContain('Sent parameters:');
    expect(f.admitted[0]!.text).toContain('[output truncated]');
  });

  it.each(['resolve-session', 'execution-context', 'native-resolve', 'native-events'] as const)('rejects move-away-and-back during awaited %s despite same stage id and no duplicate log', async point => {
    const f = fixture(point); const pending = f.run(); const observed = pending.then(value => ({ value }), error => ({ error }));
    await f.started.promise; f.replaceEntry(); f.gate.resolve();
    const result = await observed; expect(result).toHaveProperty('error');
    if ('error' in result) expect(result.error).toMatchObject({ code: 'TASK_MOVED' });
    expect(f.admitted).toEqual([]); expect(f.task.instructionPending).toBeDefined(); expect(f.task.deterministicHandoff?.acceptedAt).toBeUndefined();
  });
  it('rejects replaced handoff identity after native events read even while destination entry stays current', async () => {
    const f = fixture('native-events'); const pending = f.run(); const observed = pending.catch(error => error);
    await f.started.promise; f.task.deterministicHandoff = { ...f.task.deterministicHandoff!, id: 'replacement-delivery' }; f.gate.resolve();
    await expect(observed).resolves.toMatchObject({ code: 'STALE_HANDOFF' }); expect(f.enqueue).not.toHaveBeenCalled();
  });
  it.each(['user/message', 'agent/inbox/spliced'])('reconciles durable %s admission with the original identity rather than enqueueing again', async type => {
    const f = fixture(); const message = { source: { kind: 'stage-instruction', requestId: 'delivery' } };
    f.setLogs([{ type, data: type === 'user/message' ? message : { inserted: [message] } }]);
    await f.run(); expect(f.enqueue).not.toHaveBeenCalled(); expect(f.task.deterministicHandoff?.acceptedAt).toBeDefined(); expect(f.task.instructionPending).toBeUndefined();
  });
  it('retains a recorded delivery failure until an explicit retry, retaining the delivery identity', async () => {
    const f = fixture(); f.enqueue.mockImplementationOnce(() => { throw new Error('Native admission failed'); });
    await expect(f.run()).rejects.toThrow('Native admission failed');
    expect(f.task.instructionPending).toBeDefined(); expect(f.task.deterministicHandoff?.acceptedAt).toBeUndefined();
    expect(f.enqueue).toHaveBeenCalledTimes(1);
    await f.run(); expect(f.enqueue).toHaveBeenCalledTimes(2); expect(f.admitted[0]!.requestId).toBe('delivery');
  });
  it('uses the already resolved conversation without creating or selecting another one', async () => {
    const f = fixture(); await admitStageInstruction(f.deps, { taskId: 'task', columnId: 'review', instruction: 'Review it.', expectedEntryId: 'entry', requestId: 'delivery', sessionId: 'session' });
    expect(f.resolveSession).not.toHaveBeenCalled(); expect(f.enqueue).toHaveBeenCalledTimes(1);
  });
  it('does not clear a newer instruction marker when replacement occurs after an already accepted native enqueue', async () => {
    const f = fixture(); f.enqueue.mockImplementationOnce((_target, delivery) => { f.admitted.push(delivery); f.replaceEntry(); f.task.instructionPending = { columnId: 'review', enteredAt: 2 }; });
    await f.run(); expect(f.admitted).toHaveLength(1); expect(f.task.instructionPending?.enteredAt).toBe(2); expect(f.task.deterministicHandoff?.acceptedAt).toBeUndefined();
  });
});
