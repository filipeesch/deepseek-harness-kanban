import { describe, expect, it, vi } from 'vitest';
import type { DeterministicCapture, DeterministicControl } from '../../src/shared/deterministic.js';
import type { Board, HubState, HubTask, Project } from '../../src/shared/types.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import { DeterministicSupervisor, type SupervisorExecution, type SupervisorPorts, type SupervisorRequest, type SupervisorRoute, type SupervisorRouteOutcome } from '../../src/host/deterministic-supervisor.js';
import { KanbanError } from '../../src/shared/errors.js';
import { failureDetail } from '../../src/domain/deterministic-failure.js';
import type { TaskHistoryEntry } from '../../src/shared/task-history.js';
import { createNativeSupervisorPorts } from '../../src/host/deterministic-control.js';
import type { DeterministicRuntime } from '../../src/host/deterministic/ports.js';

const at = '2026-11-12T07:00:00.000Z';
function deferred<T = void>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
function fixture(): LocatedTask {
  const definition = { language: 'typescript' as const, code: 'return {exit: "passed", message: "ok"}', directory: 'task' as const, exits: { passed: 'review' } };
  const task: HubTask = { id: 'task', boardId: 'board', projectId: 'project', title: 'Untrusted \$(rm -rf x)', description: 'data only', columnId: 'wait', position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/project', worktree: null, operation: null, createdAt: at, updatedAt: at,
    stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'wait-key', enteredAt: at },
    deterministic: { entryId: 'entry', executionId: 'execution', stageIdentity: 'wait-key', definition: structuredClone(definition), phase: 'capture-pending', startedAt: at, attempt: 0, restartCount: 0 } };
  const board = { id: 'board', name: 'Board', workflowYaml: '', workflow: { name: 'Flow', initialColumnId: 'wait', groups: [], columns: [{ id: 'wait', name: 'Wait', key: 'wait-key', deterministic: definition }, { id: 'review', name: 'Review', key: 'review-key' }] }, createdAt: at, updatedAt: at } as Board;
  const project: Project = { id: 'project', projectKey: 'project-key', name: 'Project', projectPath: '/project' };
  const hub: HubState = { id: 'hub', name: 'Hub', revision: 0, tasks: [task], boards: [board], projects: [project], notes: [], createdAt: at, updatedAt: at };
  return { hubId: hub.id, hub, task, board, project };
}
function harness(initial = fixture()) {
  let state = structuredClone(initial.hub);
  let serial = Promise.resolve(); let sequence = 0; let approved = true;
  const calls: SupervisorExecution[] = []; const captures: SupervisorRequest[] = []; const routes: SupervisorRoute[] = []; const reclaims: string[] = []; const errors: unknown[] = [];
  const blobs = new Map<string, string>();
  const snapshots: HubState[] = [];
  let afterCommit: (() => void) | undefined;
  let beforeCommit: ((state: HubState) => void) | undefined;
  let execute: (request: SupervisorExecution) => Promise<unknown> = async () => ({ exit: 'passed', message: 'ok' });
  let captureHook: ((request: SupervisorRequest) => Promise<void>) | undefined;
  let trustHook: (() => Promise<boolean>) | undefined;
  let reclaimHook: (() => Promise<void>) | undefined;
  let route: (request: SupervisorRoute) => Promise<SupervisorRouteOutcome> = async () => ({ status: 'held' });
  let variables: Record<string, string> = {};
  function locate(taskId: string, hub = state): LocatedTask | undefined { const task = hub.tasks.find(item => item.id === taskId); if (!task) return; return { hubId: hub.id, hub, task, board: hub.boards.find(value => value.id === task.boardId)!, project: hub.projects.find(value => value.id === task.projectId)! }; }
  const ports: SupervisorPorts = {
    locate: taskId => { const value = locate(taskId, structuredClone(state)); return value; }, all: () => state.tasks.map(task => ports.locate(task.id)!),
    transact<T>(taskId: string, change: (task: HubTask, located: LocatedTask) => T): Promise<T> {
      const value = serial.then(() => { const draft = structuredClone(state); const located = locate(taskId, draft)!; if (!located) throw new Error('missing task'); const output = change(located.task, located); beforeCommit?.(draft); state = draft; snapshots.push(structuredClone(state)); afterCommit?.(); return output; });
      serial = value.then(() => undefined, () => undefined); return value;
    },
    capture: {
      async capture(request) { captures.push({ ...request, located: structuredClone(request.located), control: structuredClone(request.control) }); await captureHook?.(request); const definition = request.control.definition; const ref = 'blob-' + ++sequence; blobs.set(ref, definition.code ?? 'external captured bytes');
        const capture: DeterministicCapture = { sourceRef: ref, fingerprint: ref, language: definition.language, directory: definition.directory, executionDirectory: '/project', source: { kind: definition.file ? 'file' : 'inline', ...(definition.file ? { path: definition.file } : {}) }, env: [...(definition.env ?? [])], params: (definition.params ?? []).map(parameter => parameter.name), exits: Object.fromEntries(Object.entries(definition.exits).map(([exit, columnId]) => [exit, { columnId, stageIdentity: columnId + '-key' }])) }; return capture; },
      async load(capture) { const code = blobs.get(capture.sourceRef); if (code === undefined) throw new KanbanError('CAPTURE_CORRUPT', 'Captured source is missing or corrupt.'); return code; },
    },
    runtime: { async reclaim(request) { reclaims.push(request.control.executionId); await reclaimHook?.(); }, async execute(request) { calls.push(request); expect(state.tasks.find(task => task.id === request.located.task.id)?.deterministic).toMatchObject({ phase: 'active', attemptId: request.control.attemptId }); return execute(request); } },
    trust: { isApproved: async () => trustHook ? trustHook() : approved },
    variable: { resolve: async () => ({ ...variables }) },
    async route(request) { routes.push(request); expect(state.tasks.find(task => task.id === request.located.task.id)?.deterministic?.result?.id).toBe(request.result.id); return route(request); },
    id: () => 'id-' + ++sequence, now: () => at, report: error => errors.push(error), recheckMs: 0,
  };
  const supervisors: DeterministicSupervisor[] = [];
  function supervisor() { const value = new DeterministicSupervisor(ports); supervisors.push(value); return value; }
  return { ports, calls, captures, routes, reclaims, errors, snapshots, blobs, supervisor,
    get state() { return state; }, get task() { return state.tasks[0]!; }, control: () => state.tasks[0]!.deterministic!,
    approved(value: boolean) { approved = value; }, variables(value: Record<string, string>) { variables = value; },
    execute(value: typeof execute) { execute = value; }, route(value: typeof route) { route = value; }, captureHook(value: typeof captureHook) { captureHook = value; }, trustHook(value: typeof trustHook) { trustHook = value; }, reclaimHook(value: typeof reclaimHook) { reclaimHook = value; },
    afterCommit(value: typeof afterCommit) { afterCommit = value; }, beforeCommit(value: typeof beforeCommit) { beforeCommit = value; },
    recheck(value: number) { ports.recheckMs = value; },
    async edit(change: (located: LocatedTask) => void) { await ports.transact('task', (_task, located) => change(located)); },
    async close() { for (const value of supervisors) value.dispose(); for (const value of supervisors) await value.settle(); },
  };
}
const identity = { taskId: 'task', entryId: 'entry', executionId: 'execution' };

describe('deterministic supervisor native composition and preview', () => {
  it('adapts native task/run ownership, target snapshots, trust scope and structured outcomes', async () => {
    const h = harness(); const scopeCalls: unknown[] = []; let executed: Parameters<DeterministicRuntime['execute']>[0] | undefined;
    await h.edit(value => { value.task.deterministic!.targets = { passed: { columnId: 'review-before-rename', stageIdentity: 'review-key' } }; });
    const capture: DeterministicCapture = { sourceRef: 'native-blob', fingerprint: 'native-fingerprint', language: 'typescript', directory: 'task', executionDirectory: '/project', source: { kind: 'inline' }, env: [], params: [], exits: {} };
    const native: DeterministicRuntime = { async capture(request) { expect(request.exits).toEqual(h.control().targets); return { ...capture, exits: request.exits }; }, async plan(request) { return { content: { ...capture, exits: request.exits }, code: 'return input', fingerprint: 'native-fingerprint' }; }, loadCapture: async () => 'return input', normalizeCapture: async capture => capture, releaseCapture: () => undefined, collectSources: async () => undefined, verify: async () => undefined, reclaim: async () => undefined,
      execute: async request => { executed = request; return { kind: 'completed', completion: { exit: 'passed', message: 'native success' }, diagnostics: [] }; },
      trust: { async isApproved(scope) { scopeCalls.push(scope); return true; }, approve: async () => undefined },
      variables: { resolve: async () => ({}), status: async () => [], set: async () => undefined, remove: async () => undefined } };
    const ports = createNativeSupervisorPorts({ ...h.ports, nativeRuntime: native }); const s = new DeterministicSupervisor(ports); s.start(); await s.settle();
    expect(executed).toMatchObject({ executionId: 'execution', taskId: 'task', scope: { hubId: 'hub', boardId: 'board', projectId: 'project', stageIdentity: 'wait-key' } });
    expect(scopeCalls).toEqual([{ hubId: 'hub', boardId: 'board', stageIdentity: 'wait-key' }]); expect(h.control().result?.message).toBe('native success'); s.dispose(); await s.settle(); await h.close();
  });
  it('configures local variables on a historical stage without creating entry intent', async () => {
    const h = harness(); await h.edit(value => { delete value.task.deterministic; delete value.task.stageEntry; }); const changes: unknown[] = [];
    h.ports.variable.set = async (located, stage, name, value) => { changes.push([located.project.id, stage, name, value]); };
    const s = h.supervisor();
    expect(h.task.stageEntry).toBeUndefined(); expect(h.task.deterministic).toBeUndefined(); expect(h.calls).toHaveLength(0);
    await s.variable('task', 'TOKEN', 'synthetic-value'); expect(changes).toEqual([['project', 'wait-key', 'TOKEN', 'synthetic-value']]); await h.close();
  });
  it('does not error-route uncertain predecessor ownership even when a captured error route exists', async () => {
    const h = harness(); h.approved(false); await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; }); const s = h.supervisor(); s.start(); await s.settle();
    await h.edit(value => { Object.assign(value.task.deterministic!, { phase: 'active', attempt: 1, attemptId: 'prior' }); }); h.approved(true); h.reclaimHook(async () => { throw new KanbanError('OWNERSHIP_UNCERTAIN', 'Native ownership is not confirmed.'); });
    const restored = h.supervisor(); restored.start(); await restored.settle(); expect(h.control().error?.code).toBe('OWNERSHIP_UNCERTAIN'); expect(h.control().phase).toBe('failed'); expect(h.routes).toHaveLength(0); expect(h.calls).toHaveLength(0); await expect(restored.play('task', 'entry')).rejects.toThrow(/ownership/); await h.close();
  });
  it('refuses recovery into a changed directory instead of redirecting captured code', async () => {
    const h = harness(); h.approved(false); const s = h.supervisor(); s.start(); await s.settle(); await h.edit(value => { value.task.effectiveCwd = '/changed-directory'; }); h.approved(true); s.reconcile('task'); await s.settle(); expect(h.control().error?.code).toBe('EXECUTION_CONTEXT_CHANGED'); expect(h.calls).toHaveLength(0); await h.close();
  });
});

describe('deterministic supervisor source collection and interrupted cleanup', () => {
  it('waits for verified capture reference admission before collecting auxiliary blobs', async () => {
    const h = harness(); const gate = deferred(); const collections: string[][] = []; h.approved(false); h.captureHook(async () => gate.promise); h.ports.capture.collectSources = async refs => { collections.push([...refs]); expect(h.control().capture?.sourceRef).toBeTruthy(); };
    const s = h.supervisor(); s.start(); await flush(); const collecting = s.collectSources(); await flush(); expect(collections).toHaveLength(0); gate.resolve(); await collecting; await s.settle(); expect(collections[0]).toContain(h.control().capture!.sourceRef); await h.close();
  });
  it('recovers an interrupted durable Stop by reclaiming before marking stopped', async () => {
    const h = harness(); await h.edit(value => { Object.assign(value.task.deterministic!, { phase: 'stopping', attempt: 1, attemptId: 'prior-attempt' }); }); const s = h.supervisor(); s.start(); await s.settle(); expect(h.reclaims).toEqual(['execution']); expect(h.control().phase).toBe('stopped'); expect(h.calls).toHaveLength(0); expect(h.task.history?.filter(value => value.kind === 'deterministic-execution')).toHaveLength(1); await h.close();
  });
  it('retains recoverable authority if a Stop transaction cannot be persisted', async () => {
    const h = harness(); const gate = deferred<unknown>(); h.execute(async () => gate.promise); const s = h.supervisor(); s.start(); await flush(); h.beforeCommit(state => { if (state.tasks[0]!.deterministic?.phase === 'stopping') throw new Error('disk full'); }); await expect(s.stop(identity)).rejects.toThrow(/disk full/); expect(h.calls[0]!.signal.aborted).toBe(false); expect(h.control().phase).toBe('active'); h.beforeCommit(undefined); gate.resolve({ exit: 'passed', message: 'still authorized' }); await s.settle(); expect(h.routes).toHaveLength(1); await h.close();
  });
  it('records one failed handoff receipt without rerunning or recursively following error', async () => {
    const h = harness(); h.route(async () => ({ status: 'failed', error: { code: 'TARGET_REMOVED', message: 'No stable target remains.' } })); const s = h.supervisor(); s.start(); await s.settle(); const first = h.task.history?.filter(value => value.kind === 'deterministic-handoff'); expect(first).toHaveLength(1); s.sync(); await s.settle(); expect(h.calls).toHaveLength(1); expect(h.task.history?.filter(value => value.kind === 'deterministic-handoff')).toEqual(first); await h.close();
  });
});

describe('deterministic delivery holds and delivery-only retries', () => {
  const jobHold = { code: 'background-work' as const, at, background: [{ kind: 'job' as const, id: 'bash-1', label: 'find the home directory' }] };
  const holds = (h: ReturnType<typeof harness>) => h.errors.filter(error => (error as { code?: string }).code === 'DETERMINISTIC_DELIVERY_HELD');

  it('persists the refusal reason until it changes and reports once per change', async () => {
    const h = harness(); h.route(async () => ({ status: 'held', hold: jobHold }));
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().phase).toBe('result-ready');
    expect(h.control().hold).toEqual(jobHold);
    expect(holds(h)).toHaveLength(1);
    s.reconcile('task'); await s.settle();
    expect(h.control().hold).toEqual(jobHold);
    expect(holds(h)).toHaveLength(1);
    h.route(async () => ({ status: 'held', hold: { code: 'pending-user-work', at, pending: ['approval'] } }));
    s.reconcile('task'); await s.settle();
    expect(h.control().hold).toMatchObject({ code: 'pending-user-work', pending: ['approval'] });
    expect(holds(h)).toHaveLength(2);
    h.route(async () => ({ status: 'accepted' }));
    s.reconcile('task'); await s.settle();
    expect(h.control().hold).toBeUndefined();
    expect(h.control().result?.deliveryStatus).toBe('accepted');
    await h.close();
  });

  it('keeps a plain hold silent instead of inventing a reason', async () => {
    const h = harness(); h.route(async () => ({ status: 'held' }));
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().hold).toBeUndefined();
    expect(holds(h)).toHaveLength(0);
    await h.close();
  });

  it('replays a pending saved delivery without executing the program again', async () => {
    const h = harness(); h.route(async () => ({ status: 'held', hold: jobHold }));
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.calls).toHaveLength(1);
    h.route(async () => ({ status: 'accepted' }));
    await s.retryDelivery(identity); await s.settle();
    expect(h.calls).toHaveLength(1);
    expect(h.control().result?.deliveryStatus).toBe('accepted');
    expect(h.control().hold).toBeUndefined();
    await expect(s.retryDelivery({ ...identity, executionId: 'other' })).rejects.toMatchObject({ code: 'STALE_EXECUTION' });
    await h.close();
  });

  it('persists the sent values with the saved result and reuses them on a delivery retry', async () => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.definition.env = ['TOKEN']; });
    h.variables({ TOKEN: 'synthetic-only-secret' });
    h.execute(async () => ({ exit: 'passed', message: 'ok', params: { pipeline: 'ci-main', token: 'synthetic-only-secret' } }));
    h.route(async request => { expect(request.result.params).toEqual({ pipeline: 'ci-main', token: '[REDACTED]' }); return { status: 'held', hold: jobHold }; });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result?.params).toEqual({ pipeline: 'ci-main', token: '[REDACTED]' });
    h.route(async request => { expect(request.result.params).toEqual({ pipeline: 'ci-main', token: '[REDACTED]' }); return { status: 'accepted' }; });
    await s.retryDelivery(identity); await s.settle();
    expect(h.calls).toHaveLength(1);
    expect(h.control().result?.deliveryStatus).toBe('accepted');
    await h.close();
  });

  it('records the sent values on a failed handoff receipt without rerunning', async () => {
    const h = harness(); h.execute(async () => ({ exit: 'passed', message: 'ok', params: { pipeline: 'ci-main' } }));
    h.route(async () => ({ status: 'failed', error: { code: 'TARGET_REMOVED', message: 'No stable target remains.' } }));
    const s = h.supervisor(); s.start(); await s.settle();
    const row = h.task.history?.find(value => value.kind === 'deterministic-handoff');
    expect(row).toMatchObject({ outcome: 'failed', parameters: { pipeline: 'ci-main' } });
    expect(h.calls).toHaveLength(1);
    await h.close();
  });

  it('schedules one coalesced re-check per refusal and stops it on dispose', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); h.recheck(1_000); h.route(async () => ({ status: 'held', hold: jobHold }));
      const s = h.supervisor(); s.start(); await flush();
      expect(h.routes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_000); await flush();
      expect(h.routes).toHaveLength(2);
      s.dispose();
      await vi.advanceTimersByTimeAsync(5_000); await flush();
      expect(h.routes).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('clears the re-check when the execution or the task ends', async () => {
    vi.useFakeTimers();
    try {
      const held = async () => {
        const h = harness(); h.recheck(1_000); h.route(async () => ({ status: 'held', hold: jobHold }));
        const s = h.supervisor(); s.start(); await flush();
        expect(vi.getTimerCount()).toBe(1);
        return { h, s };
      };
      const stopped = await held(); await stopped.s.stop(identity); expect(vi.getTimerCount()).toBe(0); await stopped.h.close();
      const replaced = await held(); replaced.h.route(async () => ({ status: 'accepted' })); await replaced.s.play('task', 'entry'); await flush(); expect(vi.getTimerCount()).toBe(0); await replaced.h.close();
      const removed = await held(); await removed.s.removeTask('task'); expect(vi.getTimerCount()).toBe(0); await removed.h.close();
      const accepted = await held(); accepted.h.route(async () => ({ status: 'accepted' })); accepted.s.reconcile('task'); await flush(); expect(vi.getTimerCount()).toBe(0); await accepted.h.close();
      const orphaned = await held(); await orphaned.h.edit(value => { value.task.deterministic = undefined; }); orphaned.s.sync(); await flush(); expect(vi.getTimerCount()).toBe(0); await orphaned.h.close();
    } finally { vi.useRealTimers(); }
  });
  it('allows a wake to supersede the scheduled re-check', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); h.recheck(1_000); h.route(async () => ({ status: 'held', hold: jobHold }));
      const s = h.supervisor(); s.start(); await flush();
      s.wake('task'); await flush();
      expect(h.routes).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5_000); await flush();
      expect(h.routes).toHaveLength(2);
      s.dispose();
    } finally { vi.useRealTimers(); }
  });
});

describe('deterministic supervisor persistence and authorization failure boundaries', () => {
  it.each(['awaiting-trust', 'active'] as const)('keeps prior intent when saving %s fails rather than error-routing a storage problem', async failingPhase => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; }); let fail = true;
    h.beforeCommit(state => { if (fail && state.tasks[0]!.deterministic?.phase === failingPhase) { fail = false; throw new Error('storage interruption'); } });
    const s = h.supervisor(); s.start(); await s.settle(); expect(h.errors).toHaveLength(1); expect(h.calls).toHaveLength(0); expect(h.routes).toHaveLength(0); expect(h.control().phase).toBe(failingPhase === 'active' ? 'awaiting-trust' : 'capture-pending'); expect(h.control().result).toBeUndefined(); h.beforeCommit(undefined); s.reconcile('task'); await s.settle(); expect(h.calls).toHaveLength(1); await h.close();
  });
  it('returns revoked native trust to an authorization wait without following error', async () => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; }); h.execute(async () => { throw new KanbanError('TRUST_REQUIRED', 'Approval was withdrawn before native execution.'); }); const s = h.supervisor(); s.start(); await s.settle(); expect(h.control().phase).toBe('awaiting-trust'); expect(h.control().result).toBeUndefined(); expect(h.routes).toHaveLength(0); expect(h.task.history).toBeUndefined(); await h.close();
  });
  it('defers context deletion and replacement when aborted native cleanup cannot be confirmed', async () => {
    const h = harness(); const gate = deferred<unknown>(); h.execute(request => { request.signal.addEventListener('abort', () => gate.resolve({ exit: 'passed', message: 'late' })); return gate.promise; }); h.reclaimHook(async () => { throw new KanbanError('OWNERSHIP_UNCERTAIN', 'The child tree was not confirmed stopped.'); });
    const s = h.supervisor(); s.start(); await flush(); await expect(s.stop(identity)).rejects.toMatchObject({ code: 'EXECUTION_OWNERSHIP_UNCERTAIN' }); expect(h.control().phase).toBe('failed'); await expect(s.beforeContextChange('task')).rejects.toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' }); await expect(s.play('task', 'entry')).rejects.toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' }); expect(h.calls).toHaveLength(1); h.reclaimHook(undefined); await h.close();
  });
});

describe('deterministic supervisor authenticated ownership repair', () => {
  it('marks the same failed execution safely stopped after authenticated reclaim without another terminal history fact', async () => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.phase = 'failed'; value.task.deterministic!.error = { code: 'OWNERSHIP_UNCERTAIN', message: 'Prior owner was unconfirmed.' }; value.task.history = [{ kind: 'deterministic-execution', at, executionId: 'execution', columnId: 'wait', outcome: 'failed' }]; });
    const originalHistory = structuredClone(h.task.history); const s = h.supervisor(); await s.beforeContextChange('task'); expect(h.reclaims).toEqual(['execution']); expect(h.control().phase).toBe('stopped'); expect(h.control().error).toBeUndefined(); expect(h.task.history).toEqual(originalHistory); expect(h.calls).toHaveLength(0); await h.close();
  });
  it('retains the failed ownership barrier when authenticated reclaim still fails', async () => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.phase = 'failed'; value.task.deterministic!.error = { code: 'EXECUTION_OWNERSHIP_UNCERTAIN', message: 'Cleanup was unconfirmed.' }; }); h.reclaimHook(async () => { throw new KanbanError('OWNERSHIP_UNCERTAIN', 'The predecessor remains unconfirmed.'); }); const s = h.supervisor(); await expect(s.beforeContextChange('task')).rejects.toMatchObject({ code: 'OWNERSHIP_UNCERTAIN' }); expect(h.control().phase).toBe('failed'); expect(h.control().error?.code).toBe('EXECUTION_OWNERSHIP_UNCERTAIN'); expect(h.task.history).toBeUndefined(); h.reclaimHook(undefined); await h.close();
  });
  it('rejects a context repair whose awaited reclaim outlives explicit Play replacement', async () => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.phase = 'failed'; value.task.deterministic!.error = { code: 'OWNERSHIP_UNCERTAIN', message: 'Cleanup was unconfirmed.' }; }); const entered = deferred(); const release = deferred(); let calls = 0; h.reclaimHook(async () => { if (++calls === 1) { entered.resolve(); await release.promise; } });
    const s = h.supervisor(); const repair = s.beforeContextChange('task'); await entered.promise; await s.play('task', 'entry'); await s.settle(); const replacement = h.control().executionId; release.resolve(); await expect(repair).rejects.toMatchObject({ code: 'STALE_EXECUTION' }); expect(h.control().executionId).toBe(replacement); expect(h.control().phase).not.toBe('stopped'); expect(h.calls).toHaveLength(1); await h.close();
  });
});

describe('deterministic supervisor delayed Stop command responses', () => {
  it('does not abort a replacement run when an older Stop response resumes after Play', async () => {
    const h = harness(); const stoppedCommit = deferred(); const releaseStop = deferred(); const old = deferred<unknown>(); const replacement = deferred<unknown>(); let pauseStop = true;
    const original = h.ports.transact;
    h.ports.transact = async <T>(taskId: string, change: (task: HubTask, located: LocatedTask) => T): Promise<T> => {
      const value = await original(taskId, change);
      if (pauseStop && h.control().phase === 'stopping') { pauseStop = false; stoppedCommit.resolve(); await releaseStop.promise; }
      return value;
    };
    h.execute(request => { if (request.control.executionId === 'execution') { request.signal.addEventListener('abort', () => old.resolve({ exit: 'passed', message: 'old' })); return old.promise; } return replacement.promise; });
    const s = h.supervisor(); h.afterCommit(() => s.sync()); s.start(); await flush(); const stopping = s.stop(identity); await stoppedCommit.promise; await flush();
    await s.play('task', 'entry'); await flush(); expect(h.calls).toHaveLength(2); const next = h.calls[1]!; releaseStop.resolve(); await stopping; expect(next.signal.aborted).toBe(false); replacement.resolve({ exit: 'passed', message: 'new' }); await s.settle(); expect(h.routes[0]!.result.message).toBe('new'); await h.close();
  });
});

describe('deterministic supervisor durable ordering', () => {
  it('captures the entry definition, saves active intent before spawn and result before routing without auto mode or chat', async () => {
    const h = harness(); await h.edit(value => { value.board.workflow.columns[0]!.deterministic!.code = 'new saved version'; });
    const s = h.supervisor(); h.afterCommit(() => s.sync()); s.start(); await s.settle();
    expect(h.captures[0]!.control.definition.code).not.toBe('new saved version'); expect(h.calls).toHaveLength(1); expect(h.calls[0]!.code).toContain('return');
    expect(h.control().phase).toBe('result-ready'); expect(h.routes).toHaveLength(1); expect(h.task.sessionIds).toEqual([]);
    expect(h.snapshots.findIndex(value => value.tasks[0]!.deterministic?.phase === 'active')).toBeLessThan(h.snapshots.findIndex(value => value.tasks[0]!.deterministic?.phase === 'result-ready'));
    expect(h.task.history?.filter(value => value.kind === 'deterministic-execution')).toHaveLength(1); await h.close();
  });
  it('waits for exact capture trust and resumes without recapturing', async () => {
    const h = harness(); h.approved(false); const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().phase).toBe('awaiting-trust'); expect(h.calls).toHaveLength(0);
    const capture = h.control().capture!; expect(capture.fingerprint).toBeTruthy();
    h.approved(true); s.reconcile('task'); await s.settle();
    expect(h.captures).toHaveLength(1); expect(h.calls).toHaveLength(1); await h.close();
  });
  it('wakes a waiting owner whose negative trust check is still draining', async () => {
    const h = harness(); h.approved(false);
    const gate = deferred<boolean>();
    h.trustHook(async () => gate.promise);
    const s = h.supervisor(); s.start();
    await expect.poll(() => h.captures.length).toBe(1);
    h.approved(true); s.wakeWaiting({ boardId: 'board', stageIdentity: 'wait-key', fingerprint: h.control().capture!.fingerprint });
    h.trustHook(undefined);
    gate.resolve(false);
    await expect.poll(() => h.calls.length).toBe(1);
    await s.settle(); await h.close();
  });
  it('keeps an unapproved capture waiting when the stage is reconciled again', async () => {
    const h = harness(); h.approved(false); const s = h.supervisor(); s.start(); await s.settle();
    s.reconcile('task'); await s.settle();
    expect(h.control().phase).toBe('awaiting-trust'); expect(h.calls).toHaveLength(0); expect(h.captures).toHaveLength(1); await h.close();
  });
  it('does not autoactivate a historical occupied stage', async () => { const h = harness(); await h.edit(value => { delete value.task.deterministic; delete value.task.stageEntry; }); const s = h.supervisor(); s.start(); await s.settle(); expect(h.captures).toHaveLength(0); expect(h.calls).toHaveLength(0); await h.close(); });
  it('preserves a genuine capture-pending request when interrupted before capture', async () => {
    const h = harness(); const gate = deferred(); h.captureHook(async () => gate.promise); const s = h.supervisor(); s.start(); await flush(); s.dispose(); gate.resolve(); await s.settle(); expect(h.control().phase).toBe('capture-pending');
    h.captureHook(undefined); const restored = h.supervisor(); restored.start(); await restored.settle(); expect(h.calls).toHaveLength(1); await h.close();
  });
  it('retains captured approved bytes after shutdown and primary-file changes', async () => {
    const h = harness(); h.approved(false); const s = h.supervisor(); s.start(); await s.settle(); const ref = h.control().capture!.sourceRef; s.dispose();
    await h.edit(value => { value.board.workflow.columns[0]!.deterministic!.code = 'changed'; }); h.approved(true); const restored = h.supervisor(); restored.start(); await restored.settle();
    expect(h.captures).toHaveLength(1); expect(h.calls[0]!.code).toBe(h.blobs.get(ref)); await h.close();
  });
  it('fails closed for a missing immutable blob without rereading the source', async () => { const h = harness(); h.approved(false); const s = h.supervisor(); s.start(); await s.settle(); h.blobs.clear(); h.approved(true); s.reconcile('task'); await s.settle(); expect(h.control().phase).toBe('failed'); expect(h.calls).toHaveLength(0); expect(h.captures).toHaveLength(1); await h.close(); });
  it('never treats a result persistence failure as a synthetic executor error', async () => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; }); h.beforeCommit(state => { if (state.tasks[0]!.deterministic?.phase === 'result-ready') throw new Error('storage failed'); });
    const s = h.supervisor(); s.start(); await s.settle(); expect(h.errors).toHaveLength(1); expect(h.calls).toHaveLength(1); expect(h.routes).toHaveLength(0); expect(h.control().phase).toBe('active'); expect(h.control().result).toBeUndefined(); await h.close();
  });
});

describe('deterministic supervisor cancellation and currency races', () => {
  it('revokes before abort, rejects late completion and waits for cleanup before Play', async () => {
    const h = harness(); const ended = deferred<unknown>(); const cleanup = deferred(); const aborted = deferred();
    h.execute(async request => { request.signal.addEventListener('abort', () => { expect(h.control().phase).toBe('stopping'); aborted.resolve(); }); const result = await ended.promise; await cleanup.promise; return result; });
    const s = h.supervisor(); s.start(); await flush(); const stopping = s.stop(identity); await aborted.promise;
    expect(h.control().phase).toBe('stopping'); ended.resolve({ exit: 'passed', message: 'late' }); await flush(); expect(h.routes).toHaveLength(0);
    await s.play('task', 'entry'); expect(h.control().executionId).not.toBe('execution'); await flush(); expect(h.calls).toHaveLength(1);
    h.execute(async () => ({ exit: 'passed', message: 'new' })); cleanup.resolve(); await stopping; await s.settle(); expect(h.calls).toHaveLength(2); expect(h.routes[0]!.result.message).toBe('new'); await h.close();
  });
  it('makes stopped state durable across restart and does not synthesize error', async () => {
    const h = harness(); const gate = deferred<unknown>(); h.execute(request => { request.signal.addEventListener('abort', () => gate.resolve({ exit: 'passed', message: 'late' })); return gate.promise; }); const s = h.supervisor(); s.start(); await flush(); await s.stop(identity); s.dispose(); const restored = h.supervisor(); restored.start(); await restored.settle(); expect(h.control().phase).toBe('stopped'); expect(h.calls).toHaveLength(1); expect(h.routes).toHaveLength(0); expect(h.task.history?.filter(value => value.kind === 'deterministic-execution')).toHaveLength(1); await h.close();
  });
  it('ignores stale Stop after the result transition has replaced its entry', async () => { const h = harness(); h.route(async () => { await h.edit(value => { value.task.stageEntry!.id = 'destination-entry'; delete value.task.deterministic; }); return { status: 'accepted' }; }); const s = h.supervisor(); s.start(); await s.settle(); await expect(s.stop(identity)).rejects.toThrow(/no longer owns/); await h.close(); });
  it('rejects a delayed result after moving away and returning to the same stage', async () => {
    const h = harness(); const gate = deferred<unknown>(); h.execute(async () => gate.promise); const s = h.supervisor(); s.start(); await flush();
    await h.edit(value => { value.task.stageEntry!.id = 'another-entry'; value.task.deterministic = { ...value.task.deterministic!, entryId: 'another-entry', executionId: 'another-execution', phase: 'stopped' }; }); s.sync(); gate.resolve({ exit: 'passed', message: 'stale' }); await s.settle(); expect(h.routes).toHaveLength(0); expect(h.control().executionId).toBe('another-execution'); await h.close();
  });
  it('same-stage reorder and saved agent-mode edits do not revoke current ownership', async () => {
    const h = harness(); const gate = deferred<unknown>(); h.execute(async () => gate.promise); const s = h.supervisor(); s.start(); await flush();
    await h.edit(value => { value.task.position = 42; delete value.board.workflow.columns[0]!.deterministic; value.board.workflow.columns[0]!.onEnterPrompt = 'new mode'; }); s.sync(); expect(h.calls[0]!.signal.aborted).toBe(false);
    gate.resolve({ exit: 'passed', message: 'old approved mode' }); await s.settle(); expect(h.routes).toHaveLength(1); await expect(s.play('task', 'entry')).rejects.toThrow(/Configure/); await h.close();
  });
  it.each(['capture', 'trust', 'variables'] as const)('rechecks identity after awaited %s', async boundary => {
    const h = harness(); const gate = deferred();
    if (boundary === 'capture') h.captureHook(async () => gate.promise);
    if (boundary === 'trust') h.trustHook(async () => { await gate.promise; return true; });
    if (boundary === 'variables') h.ports.variable.resolve = async () => { await gate.promise; return {}; };
    const s = h.supervisor(); s.start(); await flush(); await h.edit(value => { value.task.stageEntry!.id = 'replaced'; delete value.task.deterministic; }); s.sync(); gate.resolve(); await s.settle(); expect(h.calls).toHaveLength(0); expect(h.routes).toHaveLength(0); await h.close();
  });
  it('checks currency again inside the final result transaction', async () => {
    const h = harness(); h.execute(async () => { await h.edit(value => { value.task.deterministic!.phase = 'stopping'; }); return { exit: 'passed', message: 'too late' }; }); const s = h.supervisor(); s.start(); await s.settle(); expect(h.control().result).toBeUndefined(); expect(h.routes).toHaveLength(0); await h.close();
  });
  it('does not block an unrelated task while the first program waits indefinitely', async () => {
    const h = harness(); const gate = deferred<unknown>(); await h.edit(value => { const second = structuredClone(value.task); second.id = 'other'; second.stageEntry!.id = 'other-entry'; second.deterministic!.entryId = 'other-entry'; second.deterministic!.executionId = 'other-execution'; value.hub.tasks.push(second); });
    h.execute(request => request.located.task.id === 'task' ? gate.promise : Promise.resolve({ exit: 'passed', message: 'other finished' })); const s = h.supervisor(); s.start(); await flush(); expect(h.calls).toHaveLength(2); expect(h.routes[0]!.located.task.id).toBe('other');
    gate.resolve({ exit: 'passed', message: 'first finished' }); await s.settle(); await h.close();
  });
});

describe('deterministic supervisor restart, result delivery and errors', () => {
  it('restarts from the beginning with original logical identity/start and new attempt', async () => {
    const h = harness(); const gate = deferred<unknown>(); h.execute(request => { request.signal.addEventListener('abort', () => gate.reject(new Error('shutdown'))); return gate.promise; }); const s = h.supervisor(); s.start(); await flush(); const first = structuredClone(h.control()); s.dispose(); await s.settle(); expect(h.control().phase).toBe('active');
    h.execute(async () => ({ exit: 'passed', message: 'recovered' })); const restored = h.supervisor(); restored.start(); await restored.settle(); const second = h.calls[1]!.control;
    expect(second.executionId).toBe(first.executionId); expect(second.startedAt).toBe(first.startedAt); expect(second.entryId).toBe(first.entryId); expect(second.attemptId).not.toBe(first.attemptId); expect(second.restartCount).toBe(1); expect(h.captures).toHaveLength(1); expect(h.reclaims).toContain(first.executionId); await h.close();
  });
  it('refuses uncertain predecessor ownership before recovery spawn', async () => { const h = harness(); h.approved(false); const s = h.supervisor(); s.start(); await s.settle(); await h.edit(value => { Object.assign(value.task.deterministic!, { phase: 'active', attempt: 1, attemptId: 'dead-attempt' }); }); h.approved(true); h.reclaimHook(async () => { throw new Error('ownership uncertain'); }); const restored = h.supervisor(); restored.start(); await restored.settle(); expect(h.calls).toHaveLength(0); expect(h.control().phase).toBe('failed'); await h.close(); });
  it.each(['stopped', 'failed'] as const)('never autorestarts %s', async phase => { const h = harness(); await h.edit(value => { value.task.deterministic!.phase = phase; }); const s = h.supervisor(); s.start(); await s.settle(); expect(h.calls).toHaveLength(0); expect(h.captures).toHaveLength(0); await h.close(); });
  it.each([undefined, {}, { exit: '', message: 'x' }, { exit: 'passed', message: '' }, { exit: 'passed', message: 'x', extra: true }, { exit: 'passed', message: 'x', params: { 'bad name': 'x' } }, { exit: 'unmapped', message: 'x' }, { exit: 'passed', message: 'x'.repeat(70_000) }])('rejects invalid protocol completion %# without a default route', async raw => { const h = harness(); h.execute(async () => raw); const s = h.supervisor(); s.start(); await s.settle(); expect(h.control().phase).toBe('failed'); expect(h.routes).toHaveLength(0); expect(h.task.history?.filter(value => value.kind === 'deterministic-execution')).toHaveLength(1); await h.close(); });
  it('uses captured optional error mapping once and redacts known secrets before persistence', async () => {
    const h = harness(); await h.edit(value => { value.task.deterministic!.definition.env = ['TOKEN']; value.task.deterministic!.definition.exits.error = 'review'; }); h.variables({ TOKEN: 'synthetic-secret' }); h.execute(async () => { throw new Error('failed synthetic-secret'); }); const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result).toMatchObject({ exit: 'error', synthetic: true, target: { stageIdentity: 'review-key' } });
    expect(h.control().result?.message).toContain('Infrastructure failure: failed [REDACTED]'); expect(JSON.stringify(h.state)).not.toContain('synthetic-secret'); expect(h.routes).toHaveLength(1); await h.close();
  });
  it('never follows error mapping before trust or after explicit cancellation', async () => { const h = harness(); await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; }); h.approved(false); const s = h.supervisor(); s.start(); await s.settle(); expect(h.control().phase).toBe('awaiting-trust'); expect(h.routes).toHaveLength(0); await s.stop(identity); expect(h.routes).toHaveLength(0); await h.close(); });
  it('passes only authorized variables and structured task/handoff input', async () => { const h = harness(); await h.edit(value => { value.task.deterministicHandoff = { id: 'incoming', entryId: 'entry', executionId: 'source', fromColumnId: 'before', columnId: 'wait', exit: 'ready', message: 'incoming', at }; }); const s = h.supervisor(); s.start(); await s.settle(); expect(h.calls[0]!.input).toMatchObject({ task: { title: h.task.title }, handoff: { id: 'incoming' }, executionId: 'execution' }); expect(h.calls[0]!.variables).toEqual({}); await h.close(); });
  it('rejects implicit credential widening and changed execution directories', async () => { const h = harness(); h.variables({ UNAUTHORIZED: 'synthetic-only' }); const s = h.supervisor(); s.start(); await s.settle(); expect(h.calls).toHaveLength(0); expect(h.control().error?.code).toBe('VARIABLE_SCOPE_INVALID'); await h.close(); });
  it('holds a terminal result across restart without rerunning source or changing delivery identity', async () => { const h = harness(); const s = h.supervisor(); s.start(); await s.settle(); const result = structuredClone(h.control().result); s.dispose(); const restored = h.supervisor(); restored.start(); await restored.settle(); expect(h.calls).toHaveLength(1); expect(h.routes).toHaveLength(2); expect(h.routes[1]!.result).toEqual(result); expect(h.task.history?.filter(value => value.kind === 'deterministic-execution')).toHaveLength(1); await h.close(); });
  it('reconciles interrupted delivering with the same identity', async () => { const h = harness(); const s = h.supervisor(); s.start(); await s.settle(); await h.edit(value => { value.task.deterministic!.phase = 'delivering'; }); s.dispose(); h.route(async () => ({ status: 'accepted' })); const restored = h.supervisor(); restored.start(); await restored.settle(); expect(h.calls).toHaveLength(1); expect(h.routes[1]!.result.deliveryId).toBe(h.routes[0]!.result.deliveryId); expect(h.control().result?.deliveryStatus).toBe('accepted'); await h.close(); });
  it('preserves explicit delivery failure across restart and retries only delivery on request', async () => { const h = harness(); h.route(async () => ({ status: 'failed', error: { code: 'TARGET_REMOVED', message: 'Captured stable target was removed.' } })); const s = h.supervisor(); s.start(); await s.settle(); const delivery = h.control().result!.deliveryId; s.dispose(); const restored = h.supervisor(); restored.start(); await restored.settle(); expect(h.routes).toHaveLength(1); expect(h.calls).toHaveLength(1); h.route(async () => ({ status: 'accepted' })); await restored.retryDelivery(identity); await restored.settle(); expect(h.routes).toHaveLength(2); expect(h.control().result!.deliveryId).toBe(delivery); expect(h.calls).toHaveLength(1); await h.close(); });
  it('keeps captured exact stable routes after the saved workflow mapping changes', async () => { const h = harness(); const gate = deferred<unknown>(); h.execute(async () => gate.promise); const s = h.supervisor(); s.start(); await flush(); await h.edit(value => { value.board.workflow.columns[0]!.deterministic!.exits.passed = 'new-target'; value.board.workflow.columns[1]!.id = 'renamed-review'; }); gate.resolve({ exit: 'passed', message: 'ok' }); await s.settle(); expect(h.routes[0]!.result.target).toEqual({ columnId: 'review', stageIdentity: 'review-key' }); await h.close(); });
  it('drains scripts before irreversible context changes and clears task-owned auxiliary sources only afterward', async () => { const h = harness(); const gate = deferred<unknown>(); const removed: string[] = []; h.execute(request => { request.signal.addEventListener('abort', () => gate.resolve({ exit: 'passed', message: 'late' })); return gate.promise; }); h.ports.capture.removeTask = async id => { expect(h.control().phase).toBe('stopped'); removed.push(id); }; const s = h.supervisor(); s.start(); await flush(); await s.removeTask('task'); expect(removed).toEqual(['task']); expect(h.routes).toHaveLength(0); await h.close(); });
});

describe('deterministic stage parameters', () => {
  async function declare(h: ReturnType<typeof harness>, params: Array<{ name: string; description?: string }>): Promise<void> {
    await h.edit(value => {
      value.board.workflow.columns[0]!.deterministic!.params = structuredClone(params);
      value.task.deterministic!.definition.params = structuredClone(params);
    });
  }

  it('settles a missing parameter as a configuration refusal without running, routing, or recording', async () => {
    const h = harness();
    await declare(h, [{ name: 'pipeline', description: 'CI workflow' }]);
    await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().phase).toBe('failed');
    expect(h.control().error).toMatchObject({ code: 'PARAMETERS_REQUIRED' });
    expect(h.control().error?.message).toContain('pipeline');
    expect(h.calls).toHaveLength(0);
    expect(h.routes).toHaveLength(0);
    expect(h.task.history).toBeUndefined();
    await h.close();
  });

  it('fails in place without an error route', async () => {
    const h = harness();
    await declare(h, [{ name: 'pipeline' }]);
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().phase).toBe('failed');
    expect(h.control().error?.code).toBe('PARAMETERS_REQUIRED');
    expect(h.routes).toHaveLength(0);
    expect(h.task.history).toBeUndefined();
    await h.close();
  });

  it('passes only declared values to the program and records the values used', async () => {
    const h = harness();
    await declare(h, [{ name: 'pipeline' }, { name: 'app' }]);
    await h.edit(value => { value.task.deterministic!.parameters = { pipeline: 'ci-main', app: 'checkout', extra: 'ignored' }; });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.calls[0]!.input.params).toEqual({ pipeline: 'ci-main', app: 'checkout' });
    const row = h.task.history?.find(value => value.kind === 'deterministic-execution');
    expect(row).toMatchObject({ outcome: 'completed', parameters: { pipeline: 'ci-main', app: 'checkout' } });
    expect(JSON.stringify(row)).not.toContain('ignored');
    await h.close();
  });

  it('revalidates a changed declaration on Play and repairs the entry before starting', async () => {
    const h = harness();
    await declare(h, [{ name: 'pipeline' }]);
    await h.edit(value => { value.task.deterministic!.parameters = { pipeline: 'ci-main' }; });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.calls).toHaveLength(1);
    await h.edit(value => {
      value.board.workflow.columns[0]!.deterministic!.params = [{ name: 'pipeline' }, { name: 'app' }];
      value.task.deterministic!.definition.params = [{ name: 'pipeline' }, { name: 'app' }];
    });
    await s.play('task', 'entry'); await s.settle();
    expect(h.calls).toHaveLength(1);
    expect(h.control().error).toMatchObject({ code: 'PARAMETERS_REQUIRED' });
    expect(h.control().error?.message).toContain('app');
    await expect(s.parameters('task', 'entry', { pipeline: 'ci-main' })).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
    await expect(s.parameters('task', 'entry', { pipeline: 'ci-main', app: 'checkout', extra: 'x' })).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
    await s.parameters('task', 'entry', { pipeline: 'ci-main', app: 'checkout' });
    expect(h.control().parameters).toEqual({ pipeline: 'ci-main', app: 'checkout' });
    await s.play('task', 'entry'); await s.settle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.input.params).toEqual({ pipeline: 'ci-main', app: 'checkout' });
    await h.close();
  });

  it('rejects repair for an active, stale, or undeclared entry', async () => {
    const h = harness();
    await declare(h, [{ name: 'pipeline' }]);
    await h.edit(value => { value.task.deterministic!.parameters = { pipeline: 'ci' }; });
    const gate = deferred<unknown>();
    h.execute(async () => gate.promise);
    const s = h.supervisor(); s.start(); await flush();
    expect(h.control().phase).toBe('active');
    await expect(s.parameters('task', 'entry', { pipeline: 'ci' })).rejects.toMatchObject({ code: 'EXECUTION_ACTIVE' });
    gate.resolve({ exit: 'passed', message: 'done' }); await s.settle();
    await expect(s.parameters('task', 'other-entry', { pipeline: 'ci' })).rejects.toMatchObject({ code: 'STALE_EXECUTION' });
    await h.edit(value => { delete value.board.workflow.columns[0]!.deterministic; });
    await expect(s.parameters('task', 'entry', { pipeline: 'ci' })).rejects.toMatchObject({ code: 'DETERMINISTIC_CONFIGURATION_REQUIRED' });
    expect(h.control().parameters).toEqual({ pipeline: 'ci' });
    await h.close();
  });

  it('recovers with the entry values instead of the saved declaration', async () => {
    const h = harness();
    await declare(h, [{ name: 'pipeline' }]);
    await h.edit(value => { value.task.deterministic!.parameters = { pipeline: 'ci-main' }; });
    const gate = deferred<unknown>();
    h.execute(request => { request.signal.addEventListener('abort', () => gate.reject(new Error('shutdown'))); return gate.promise; });
    const s = h.supervisor(); s.start(); await flush();
    s.dispose(); await s.settle();
    await h.edit(value => { value.board.workflow.columns[0]!.deterministic!.params = [{ name: 'pipeline' }, { name: 'app' }]; });
    h.execute(async () => ({ exit: 'passed', message: 'recovered' }));
    const restored = h.supervisor(); restored.start(); await restored.settle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.input.params).toEqual({ pipeline: 'ci-main' });
    await h.close();
  });

  it('captures the declared parameter names into the executable version', async () => {
    const h = harness();
    h.approved(false);
    await declare(h, [{ name: 'pipeline', description: 'CI workflow' }]);
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().capture!.params).toEqual(['pipeline']);
    await h.close();
  });
});

describe('deterministic failure settlement by origin', () => {
  const guard = { admission: 'not-admitted' as const, exitCode: 125, signal: null, timedOut: false, aborted: false, elapsedMs: 20, stdoutBytes: 0, stdoutHead: '', stderrBytes: 0, stderrTail: '' };

  it('routes an infrastructure failure to the reserved destination before error', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.exits.infrastructure = 'review'; value.task.deterministic!.definition.exits.error = 'review'; });
    h.execute(async () => { throw new KanbanError('BASH_PROTOCOL', 'The isolated Bash guard did not return a valid result.\n    at bindingFailure (/Users/someone/bootstrap.ts:246:61)', { origin: 'infrastructure', attempts: [{ attempt: 1, code: 'BASH_PROTOCOL', guard }], guard }); });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result).toMatchObject({ exit: 'infrastructure', synthetic: true, target: { columnId: 'review', stageIdentity: 'review-key' } });
    expect(h.control().result?.message).toContain('Infrastructure failure');
    expect(h.control().result?.message).toContain('1 attempt');
    expect(h.control().result?.message).not.toContain('    at ');
    expect(h.routes).toHaveLength(1);
    await h.close();
  });

  it('keeps a configuration failure in its stage even when both reserved destinations exist', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.exits.infrastructure = 'review'; value.task.deterministic!.definition.exits.error = 'review'; });
    h.execute(async () => { throw new KanbanError('EXECUTION_CONTEXT_CHANGED', 'The captured execution directory is unavailable or changed.', { origin: 'configuration' }); });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().phase).toBe('failed');
    expect(h.control().error).toMatchObject({ code: 'EXECUTION_CONTEXT_CHANGED', details: { origin: 'configuration' } });
    expect(h.control().result).toBeUndefined();
    expect(h.routes).toHaveLength(0);
    await h.close();
  });

  it('routes a work failure to error and never to the reserved infrastructure destination', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.exits.infrastructure = 'review'; value.task.deterministic!.definition.exits.error = 'review'; });
    h.execute(async () => { throw new KanbanError('TYPESCRIPT_EXCEPTION', 'Error: boom\\n    at run (/Users/someone/wait.ts:2:1)', { origin: 'script' }); });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result).toMatchObject({ exit: 'error', synthetic: true });
    expect(h.control().result?.message).toContain('boom');
    await h.close();
  });

  it('reports one settled history row that carries the origin and every attempt', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; });
    const attempts = [1, 2, 3].map(attempt => ({ attempt, code: 'BASH_PROTOCOL', guard: { ...guard, elapsedMs: attempt * 10 } }));
    h.execute(async () => { throw new KanbanError('BASH_PROTOCOL', 'The isolated Bash guard did not admit the command.', { origin: 'infrastructure', attempts, guard }); });
    const s = h.supervisor(); s.start(); await s.settle();
    const rows = (h.task.history ?? []).filter((value): value is Extract<TaskHistoryEntry, { kind: 'deterministic-execution' }> => value.kind === 'deterministic-execution');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'failed', exit: 'error', error: { code: 'BASH_PROTOCOL', details: { origin: 'infrastructure' } } });
    // The stored row must still decode through the real redaction boundary.
    const stored = failureDetail(rows[0]?.error?.details);
    expect(stored?.attempts).toHaveLength(3);
    expect(stored?.attempts?.[0]?.guard?.admission).toBe('not-admitted');
    expect(stored?.attempts?.[2]?.guard?.elapsedMs).toBe(30);
    expect(stored?.guard?.exitCode).toBe(125);
    expect(h.calls).toHaveLength(1);
    await h.close();
  });

  it('redacts a secret before a cause message is bounded', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.env = ['TOKEN']; value.task.deterministic!.definition.exits.error = 'review'; });
    h.variables({ TOKEN: 'synthetic-secret' });
    // The value sits exactly where a truncation would cut it, so bound-before-redact
    // would persist a recognizable fragment.
    h.execute(async () => { throw new KanbanError('EXECUTOR_FAILED', 'x'.repeat(487) + 'synthetic-secret' + 'y'.repeat(100), { origin: 'infrastructure' }); });
    const s = h.supervisor(); s.start(); await s.settle();
    const persisted = JSON.stringify({ result: h.control().result, error: h.control().error, history: h.task.history });
    expect(persisted).not.toContain('synthetic-secret');
    expect(persisted).not.toContain('secret');
    await h.close();
  });

  it('redacts a secret before a structured cause detail is bounded', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.env = ['TOKEN']; value.task.deterministic!.definition.exits.error = 'review'; });
    h.variables({ TOKEN: 'QUARANTINE-MARK' });
    // The value sits where the codec's 512-byte cause bound would cut it, so decoding
    // before redacting would persist a recognizable fragment.
    h.execute(async () => { throw new KanbanError('TYPESCRIPT_EXCEPTION', 'boom', { origin: 'script', cause: { code: 'BASH_PROTOCOL', message: 'x'.repeat(505) + 'QUARANTINE-MARK' } }); });
    const s = h.supervisor(); s.start(); await s.settle();
    const persisted = JSON.stringify({ result: h.control().result, error: h.control().error, history: h.task.history });
    expect(persisted).not.toContain('QUARANTINE');
    expect(persisted).not.toContain('QUAR');
    await h.close();
  });

  it('redacts a secret before a long program message is bounded', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.env = ['TOKEN']; value.task.deterministic!.definition.exits.error = 'review'; });
    h.variables({ TOKEN: 'synthetic-secret' });
    h.execute(async () => { throw new KanbanError('TYPESCRIPT_EXCEPTION', 'x'.repeat(4090) + 'synthetic-secret', { origin: 'script' }); });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result?.message).not.toContain('synthetic-secret');
    expect(h.control().result?.message).not.toContain('synthe');
    await h.close();
  });

  it('delivers a controlled sentence for a provider failure and keeps its text as the cause', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.exits.infrastructure = 'review'; value.task.deterministic!.definition.exits.error = 'review'; });
    h.execute(async () => { throw new KanbanError('TYPESCRIPT_PROTOCOL', 'provider exploded at /Users/someone/ptc.ts', { origin: 'infrastructure' }); });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result?.message).toContain('The TypeScript execution provider returned an invalid result.');
    expect(h.control().result?.message).not.toContain('/Users/someone');
    expect(failureDetail(h.control().result?.error?.details)?.cause?.message).toContain('/Users/someone/ptc.ts');
    await h.close();
  });

  it('routes a program-returned reserved exit as an ordinary mapped exit', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.exits.infrastructure = 'review'; });
    h.execute(async () => ({ exit: 'infrastructure', message: 'the script reports a tool failure' }));
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result).toMatchObject({ exit: 'infrastructure', target: { columnId: 'review', stageIdentity: 'review-key' } });
    expect(h.control().result?.synthetic).toBeUndefined();
    await h.close();
  });

  it('records one settled row for a configuration failure that stays in the stage', async () => {
    const h = harness();
    await h.edit(value => { value.task.deterministic!.definition.exits.error = 'review'; });
    h.execute(async () => { throw new KanbanError('POLICY_DENIED', 'Native execution denied an operation.', { origin: 'configuration' }); });
    const s = h.supervisor(); s.start(); await s.settle();
    expect(h.control().result).toBeUndefined();
    expect(h.routes).toHaveLength(0);
    const rows = h.task.history?.filter(value => value.kind === 'deterministic-execution') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'failed', error: { details: { origin: 'configuration' } } });
    await h.close();
  });
});

