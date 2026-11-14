import { describe, expect, it } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { createDeterministicRouter } from '../../src/host/deterministic-routing.js';
import type { SupervisorRoute } from '../../src/host/deterministic-supervisor.js';
import { NO_PENDING_USER_WORK, type HubState, type HubTask, type PendingUserWork } from '../../src/shared/types.js';
import type { ConversationIdleReport } from '../../src/shared/conversation-idle.js';
import { MemoryHubStorage, operationDeps, sampleHub } from '../domain/hub-helpers.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { placeTask } from '../../src/domain/hub-operations.js';
import { KanbanError } from '../../src/shared/errors.js';

const at = '2026-11-12T07:00:00.000Z';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
function stageEntries(task: HubTask) { return (task.history ?? []).filter(entry => entry.kind === 'stage'); }
async function fixture(kind: 'manual' | 'agent' | 'script' = 'manual') {
  const storage = new MemoryHubStorage(); const hub = sampleHub(); const board = hub.boards[0]!;
  board.workflowYaml = 'name: Flow\ninitial_column: wait\ncolumns:\n  - id: wait\n    key: wait-key\n    label: Wait\n    deterministic: {language: typescript, code: "return input", exits: {passed: review, error: repair}}\n  - id: review\n    key: review-key\n    label: Review\n'
    + (kind === 'agent' ? '    on_enter_prompt: Review this result\n' : kind === 'script' ? '    deterministic: {language: bash, code: echo, exits: {done: repair}}\n' : '')
    + '  - id: repair\n    key: repair-key\n    label: Repair\n';
  board.workflow = parseWorkflow(board.workflowYaml);
  const definition = board.workflow.columns[0]!.deterministic!;
  const capture = { sourceRef: 'blob', fingerprint: 'approved', language: 'typescript' as const, directory: 'task' as const, executionDirectory: '/repo/app', source: { kind: 'inline' as const }, env: [], params: [], exits: { passed: { columnId: 'review', stageIdentity: 'review-key' }, error: { columnId: 'repair', stageIdentity: 'repair-key' } } };
  const result = { id: 'result', exit: 'passed', message: 'CI passed', at, target: capture.exits.passed, deliveryId: 'delivery', deliveryStatus: 'pending' as const };
  const task: HubTask = { id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'wait', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: null, operation: null, createdAt: at, updatedAt: at,
    stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'wait-key', enteredAt: at }, deterministic: { entryId: 'entry', executionId: 'execution', stageIdentity: 'wait-key', definition: structuredClone(definition), phase: 'delivering', startedAt: at, attempt: 1, attemptId: 'attempt', restartCount: 0, capture, result } };
  hub.tasks.push(task); storage.hubs.set(hub.id, hub); const hubs = await HubRepository.open(storage, operationDeps());
  const request: SupervisorRoute = { located: hubs.requireTask('task'), control: structuredClone(task.deterministic!), capture, result, signal: new AbortController().signal };
  let idle = true; let pending: PendingUserWork = NO_PENDING_USER_WORK; let reserved = false; let notified = 0;
  let idleHook: (() => Promise<void>) | undefined; let pendingHook: (() => Promise<void>) | undefined;
  let report: ConversationIdleReport | undefined; let reportError: unknown; let pendingError: unknown;
  const route = createDeterministicRouter({ hubs,
    sessions: {
      isIdle: async () => { await idleHook?.(); return idle; },
      idleReport: async () => { await idleHook?.(); if (reportError !== undefined) throw reportError; return report ?? { idle, blockers: [] }; },
    },
    pending: async () => { await pendingHook?.(); if (pendingError !== undefined) throw pendingError; return pending; },
    reserved: () => reserved, notify: () => { notified++; }, now: () => at });
  return { hubs, storage, request, route, task: () => hubs.requireTask('task').task,
    edit: (change: (hub: HubState) => void) => hubs.transact('hub', change),
    idle(value: boolean) { idle = value; }, pending(value: PendingUserWork) { pending = value; }, reserved(value: boolean) { reserved = value; }, notified: () => notified,
    report(value: ConversationIdleReport) { report = value; }, reportError(value: unknown) { reportError = value; }, pendingError(value: unknown) { pendingError = value; },
    idleHook(value: () => Promise<void>) { idleHook = value; }, pendingHook(value: () => Promise<void>) { pendingHook = value; }, close: () => hubs.close() };
}

describe('deterministic saved-result routing', () => {
  it.each(['manual', 'agent', 'script'] as const)('lands exactly at a %s target at top and preserves an entry-bound handoff without creating a conversation', async kind => {
    const f = await fixture(kind); await f.edit(hub => { const other = structuredClone(hub.tasks[0]!); other.id = 'other'; other.columnId = 'review'; other.position = 0; delete other.stageEntry; delete other.deterministic; hub.tasks.push(other); });
    expect(await f.route(f.request)).toEqual({ status: 'accepted' }); const task = f.task(); expect(task.columnId).toBe('review'); expect(task.position).toBe(0); expect(task.stageEntry?.id).not.toBe('entry'); expect(task.sessionIds).toEqual([]);
    expect(task.deterministicHandoff).toMatchObject({ id: 'delivery', entryId: task.stageEntry!.id, executionId: 'execution', fromColumnId: 'wait', columnId: 'review', exit: 'passed', message: 'CI passed' });
    if (kind === 'script') expect(task.deterministic?.phase).toBe('capture-pending'); else expect(task.deterministic).toBeUndefined();
    if (kind === 'agent') expect(task.deterministicHandoff!.instruction).toBe('Review this result'); else expect(task.deterministicHandoff!.instruction).toBeUndefined();
    expect(task.autoMode).toBeUndefined(); expect(f.notified()).toBe(1); await f.close();
  });
  it('binds the sent values by exact name for a deterministic destination', async () => {
    const f = await fixture('script');
    await f.edit(hub => {
      const board = hub.boards[0]!;
      board.workflowYaml = board.workflowYaml.replace('deterministic: {language: bash, code: echo, exits: {done: repair}}', 'deterministic: {language: bash, code: echo, params: [{name: pipeline}], exits: {done: repair}}');
      board.workflow = parseWorkflow(board.workflowYaml);
      hub.tasks[0]!.deterministic!.result!.params = { pipeline: 'ci-main', extra: 'ignored' };
    });
    f.request.result = { ...f.request.result, params: { pipeline: 'ci-main', extra: 'ignored' } };
    expect(await f.route(f.request)).toEqual({ status: 'accepted' });
    const task = f.task();
    expect(task.columnId).toBe('review');
    expect(task.deterministic?.parameters).toEqual({ pipeline: 'ci-main' });
    expect(task.deterministicHandoff).toMatchObject({ exit: 'passed', params: { pipeline: 'ci-main', extra: 'ignored' } });
    await f.close();
  });

  it('routes a partial sent map and leaves the missing declared name for admission repair', async () => {
    const f = await fixture('script');
    await f.edit(hub => {
      const board = hub.boards[0]!;
      board.workflowYaml = board.workflowYaml.replace('deterministic: {language: bash, code: echo, exits: {done: repair}}', 'deterministic: {language: bash, code: echo, params: [{name: pipeline}, {name: app}], exits: {done: repair}}');
      board.workflow = parseWorkflow(board.workflowYaml);
      hub.tasks[0]!.deterministic!.result!.params = { pipeline: 'ci-main' };
    });
    f.request.result = { ...f.request.result, params: { pipeline: 'ci-main' } };
    expect(await f.route(f.request)).toEqual({ status: 'accepted' });
    const task = f.task();
    expect(task.columnId).toBe('review');
    expect(task.deterministic?.parameters).toEqual({ pipeline: 'ci-main' });
    expect(task.deterministicHandoff).toMatchObject({ params: { pipeline: 'ci-main' } });
    await f.close();
  });

  it('uses the destination declaration as it is now, not the one captured by the source', async () => {
    const f = await fixture('script');
    await f.edit(hub => {
      const board = hub.boards[0]!;
      board.workflowYaml = board.workflowYaml.replace('deterministic: {language: bash, code: echo, exits: {done: repair}}', 'deterministic: {language: bash, code: echo, params: [{name: app}], exits: {done: repair}}');
      board.workflow = parseWorkflow(board.workflowYaml);
      hub.tasks[0]!.deterministic!.result!.params = { pipeline: 'ci-main' };
    });
    f.request.result = { ...f.request.result, params: { pipeline: 'ci-main' } };
    expect(await f.route(f.request)).toEqual({ status: 'accepted' });
    const task = f.task();
    expect(task.deterministic?.parameters).toBeUndefined();
    expect(task.deterministicHandoff).toMatchObject({ params: { pipeline: 'ci-main' } });
    await f.close();
  });

  it('keeps a sent value out of an entry whose destination declares none', async () => {
    const f = await fixture('script');
    await f.edit(hub => { hub.tasks[0]!.deterministic!.result!.params = { pipeline: 'ci-main' }; });
    f.request.result = { ...f.request.result, params: { pipeline: 'ci-main' } };
    expect(await f.route(f.request)).toEqual({ status: 'accepted' });
    const task = f.task();
    expect(task.deterministic?.parameters).toBeUndefined();
    expect(task.deterministicHandoff).toMatchObject({ params: { pipeline: 'ci-main' } });
    await f.close();
  });

  it('records the named script exit as the stage origin', async () => {
    const f = await fixture();
    expect(await f.route(f.request)).toEqual({ status: 'accepted' });
    expect(stageEntries(f.task())).toEqual([
      { kind: 'stage', at, fromColumnId: 'wait', columnId: 'review', origin: 'script:passed' },
    ]);
    await f.close();
  });
  it('records the reserved error route as the stage origin', async () => {
    const f = await fixture();
    const failed = { id: 'result', exit: 'error', message: 'The script could not run.', at, target: f.request.capture.exits.error!, deliveryId: 'delivery', deliveryStatus: 'pending' as const, synthetic: true };
    await f.edit(hub => { hub.tasks[0]!.deterministic!.result = structuredClone(failed); });
    f.request.result = structuredClone(failed);
    expect(await f.route(f.request)).toEqual({ status: 'accepted' });
    expect(f.task().columnId).toBe('repair');
    expect(stageEntries(f.task())).toEqual([
      { kind: 'stage', at, fromColumnId: 'wait', columnId: 'repair', origin: 'error:error' },
    ]);
    await f.close();
  });
  it('ignores latest exit remapping and resolves an identifier rename by captured stable target', async () => {
    const f = await fixture(); await f.edit(hub => { const board = hub.boards[0]!; board.workflowYaml = board.workflowYaml.replace('passed: review', 'passed: repair').replace('id: review', 'id: renamed-review'); board.workflow = parseWorkflow(board.workflowYaml); });
    expect(await f.route(f.request)).toEqual({ status: 'accepted' }); expect(f.task().columnId).toBe('renamed-review'); await f.close();
  });
  it('does not authorize a reused target identifier, choose a default or recursively follow error', async () => {
    const f = await fixture(); await f.edit(hub => { const board = hub.boards[0]!; board.workflowYaml = board.workflowYaml.replace('key: review-key', 'key: different-stage'); board.workflow = parseWorkflow(board.workflowYaml); });
    expect(await f.route(f.request)).toMatchObject({ status: 'failed', error: { code: 'DETERMINISTIC_TARGET_REMOVED' } }); expect(f.task().columnId).toBe('wait'); expect(f.task().deterministic?.result?.id).toBe('result'); await f.close();
  });
  it('does not require auto mode or recorded transition and never grants a human override', async () => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.autoMode = { enabled: false }; const board = hub.boards[0]!; board.workflowYaml = board.workflowYaml.replace('deterministic: {language: typescript, code: "return input", exits: {passed: review, error: repair}}', 'on_enter_prompt: Saved mode changed'); board.workflow = parseWorkflow(board.workflowYaml); });
    expect(await f.route(f.request)).toEqual({ status: 'accepted' }); expect(f.task().autoMode?.enabled).toBe(false); expect(f.task().recordedTransition).toBeUndefined(); await f.close();
  });
  it.each(['native-question', 'approval', 'queued-prompt'] as const)('holds for pending %s, names the work and retains the result for a later admission', async kind => {
    const f = await fixture(); f.pending({ kinds: [kind], queuedPrompts: kind === 'queued-prompt' ? 1 : 0 });
    expect(await f.route(f.request)).toMatchObject({ status: 'held', hold: { code: 'pending-user-work', at, pending: [kind] } }); expect(f.task().deterministic?.result?.id).toBe('result');
    f.pending(NO_PENDING_USER_WORK); expect(await f.route(f.request)).toEqual({ status: 'accepted' }); await f.close();
  });
  it('holds when task context is reserved and names the reservation', async () => {
    const f = await fixture(); f.reserved(true);
    expect(await f.route(f.request)).toMatchObject({ status: 'held', hold: { code: 'context-reserved', at } }); expect(f.task().columnId).toBe('wait'); await f.close();
  });
  it('holds for a running task conversation and does not inspect closed conversations', async () => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; }); f.idle(false);
    expect(await f.route(f.request)).toMatchObject({ status: 'held', hold: { code: 'conversation-active', at } });
    await f.edit(hub => { hub.tasks[0]!.closedSessionIds = ['session']; }); expect(await f.route(f.request)).toEqual({ status: 'accepted' }); await f.close();
  });
  it('names the background job that refuses delivery and keeps its identity for the next admission', async () => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; });
    f.report({ idle: false, blockers: [{ family: 'job', id: 'bash-1', label: 'find the home directory' }, { family: 'job', id: 'bash-2', label: 'second' }] });
    expect(await f.route(f.request)).toMatchObject({ status: 'held', hold: { code: 'background-work', at, background: [
      { kind: 'job', id: 'bash-1', label: 'find the home directory' }, { kind: 'job', id: 'bash-2', label: 'second' },
    ] } });
    expect(f.task().columnId).toBe('wait');
    f.report({ idle: true, blockers: [] });
    expect(await f.route(f.request)).toEqual({ status: 'accepted' });
    await f.close();
  });
  it('records an unreadable conversation or pending read instead of a silent refusal', async () => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; });
    f.reportError(new KanbanError('SESSION_STATE_UNAVAILABLE', 'Exact projections are unavailable.'));
    expect(await f.route(f.request)).toMatchObject({ status: 'held', hold: { code: 'conversation-unreadable', at } });
    expect(f.task().columnId).toBe('wait');
    f.reportError(undefined);
    f.pendingError(new KanbanError('SESSION_STATE_UNAVAILABLE', 'Exact projections are unavailable.'));
    expect(await f.route(f.request)).toMatchObject({ status: 'held', hold: { code: 'conversation-unreadable', at } });
    await f.close();
  });
  it('stops a request aborted during an awaited conversation read', async () => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; });
    const entered = deferred(); const gate = deferred(); f.idleHook(async () => { entered.resolve(); await gate.promise; });
    const controller = new AbortController(); const routing = f.route({ ...f.request, signal: controller.signal });
    await entered.promise; controller.abort(); gate.resolve();
    expect(await routing).toEqual({ status: 'held' });
    expect(f.task().columnId).toBe('wait'); expect(f.task().deterministicHandoff).toBeUndefined(); await f.close();
  });
  it('reads pending work after the awaited conversation reads so work admitted during them is seen', async () => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; });
    const entered = deferred(); const gate = deferred(); f.idleHook(async () => { entered.resolve(); await gate.promise; });
    const routing = f.route(f.request); await entered.promise;
    f.pending({ kinds: ['approval'], queuedPrompts: 0 }); gate.resolve();
    expect(await routing).toMatchObject({ status: 'held', hold: { code: 'pending-user-work', pending: ['approval'] } });
    expect(f.task().columnId).toBe('wait'); await f.close();
  });
  it.each(['idle', 'pending'] as const)('rejects move-away-and-back during the awaited %s boundary', async boundary => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; }); const gate = deferred(); const entered = deferred(); const hook = async () => { entered.resolve(); await gate.promise; };
    if (boundary === 'idle') f.idleHook(hook); else f.pendingHook(hook);
    const routing = f.route(f.request); await entered.promise;
    await f.edit(hub => { placeTask(hub, 'task', 'repair', 'start', Date.parse(at), { at }); placeTask(hub, 'task', 'wait', 'start', Date.parse(at), { at }); }); gate.resolve();
    expect(await routing).toEqual({ status: 'held' }); expect(f.task().deterministic?.executionId).not.toBe('execution'); expect(f.task().deterministicHandoff).toBeUndefined(); await f.close();
  });
  it('revalidates reservation inside the final transaction rather than only before awaited reads', async () => {
    const f = await fixture(); const gate = deferred(); const entered = deferred(); f.pendingHook(async () => { entered.resolve(); await gate.promise; }); const routing = f.route(f.request); await entered.promise;
    f.reserved(true); gate.resolve(); expect(await routing).toMatchObject({ status: 'held', hold: { code: 'context-reserved' } }); expect(f.task().columnId).toBe('wait'); await f.close();
  });
  it.each(['executionId', 'attemptId'] as const)('refuses stale %s and a stopped authority', async key => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.deterministic![key] = 'replacement'; });
    expect(await f.route(f.request)).toEqual({ status: 'held' }); expect(f.task().columnId).toBe('wait'); await f.close();
  });
  it('refuses changed result identity and does not use an altered request target', async () => {
    const f = await fixture(); f.request.result = { ...f.request.result, id: 'forged' };
    expect(await f.route(f.request)).toEqual({ status: 'held' }); expect(f.task().columnId).toBe('wait'); await f.close();
  });
  it('keeps source control untouched when transactional storage fails, then retries the same receipt', async () => {
    const f = await fixture(); f.storage.failSave = true; await expect(f.route(f.request)).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' }); expect(f.task().deterministic?.result?.id).toBe('result'); expect(f.task().columnId).toBe('wait'); f.storage.failSave = false; expect(await f.route(f.request)).toEqual({ status: 'accepted' }); await f.close();
  });
  it('persists consumed source and new destination handoff together through repository reopen, then rejects duplicate routing', async () => {
    const f = await fixture('script'); expect(await f.route(f.request)).toEqual({ status: 'accepted' }); const entry = f.task().stageEntry!.id; await f.close();
    const reopened = await HubRepository.open(f.storage, operationDeps()); const recovered = reopened.requireTask('task').task; expect(recovered.stageEntry!.id).toBe(entry); expect(recovered.deterministicHandoff?.id).toBe('delivery'); expect(recovered.deterministic?.executionId).not.toBe('execution');
    const route = createDeterministicRouter({ hubs: reopened, sessions: { isIdle: async () => true }, pending: async () => NO_PENDING_USER_WORK }); expect(await route(f.request)).toEqual({ status: 'held' }); expect(reopened.requireTask('task').task.stageEntry!.id).toBe(entry); await reopened.close();
  });
});
