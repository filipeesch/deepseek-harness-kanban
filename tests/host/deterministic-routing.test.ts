import { describe, expect, it } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { createDeterministicRouter } from '../../src/host/deterministic-routing.js';
import type { SupervisorRoute } from '../../src/host/deterministic-supervisor.js';
import { NO_PENDING_USER_WORK, type HubState, type HubTask, type PendingUserWork } from '../../src/shared/types.js';
import { MemoryHubStorage, operationDeps, sampleHub } from '../domain/hub-helpers.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { placeTask } from '../../src/domain/hub-operations.js';

const at = '2026-11-12T07:00:00.000Z';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
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
  const route = createDeterministicRouter({ hubs, sessions: { isIdle: async () => { await idleHook?.(); return idle; } }, pending: async () => { await pendingHook?.(); return pending; }, reserved: () => reserved, notify: () => { notified++; }, now: () => at });
  return { hubs, storage, request, route, task: () => hubs.requireTask('task').task,
    edit: (change: (hub: HubState) => void) => hubs.transact('hub', change), idle(value: boolean) { idle = value; }, pending(value: PendingUserWork) { pending = value; }, reserved(value: boolean) { reserved = value; }, notified: () => notified,
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
  it.each(['native-question', 'approval', 'queued-prompt'] as const)('holds for pending %s and retains result for a later admission', async kind => {
    const f = await fixture(); f.pending({ kinds: [kind], queuedPrompts: kind === 'queued-prompt' ? 1 : 0 }); expect(await f.route(f.request)).toEqual({ status: 'held' }); expect(f.task().deterministic?.result?.id).toBe('result');
    f.pending(NO_PENDING_USER_WORK); expect(await f.route(f.request)).toEqual({ status: 'accepted' }); await f.close();
  });
  it('holds when task context is reserved', async () => { const f = await fixture(); f.reserved(true); expect(await f.route(f.request)).toEqual({ status: 'held' }); expect(f.task().columnId).toBe('wait'); await f.close(); });
  it('holds for a running task conversation and does not inspect closed conversations', async () => { const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; }); f.idle(false); expect(await f.route(f.request)).toEqual({ status: 'held' }); await f.edit(hub => { hub.tasks[0]!.closedSessionIds = ['session']; }); expect(await f.route(f.request)).toEqual({ status: 'accepted' }); await f.close(); });
  it.each(['idle', 'pending'] as const)('rejects move-away-and-back during the awaited %s boundary', async boundary => {
    const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.sessionIds = ['session']; }); const gate = deferred(); const entered = deferred(); const hook = async () => { entered.resolve(); await gate.promise; };
    if (boundary === 'idle') f.idleHook(hook); else f.pendingHook(hook);
    const routing = f.route(f.request); await entered.promise;
    await f.edit(hub => { placeTask(hub, 'task', 'repair', 'start', Date.parse(at), { at }); placeTask(hub, 'task', 'wait', 'start', Date.parse(at), { at }); }); gate.resolve();
    expect(await routing).toEqual({ status: 'held' }); expect(f.task().deterministic?.executionId).not.toBe('execution'); expect(f.task().deterministicHandoff).toBeUndefined(); await f.close();
  });
  it('revalidates reservation inside the final transaction rather than only before awaited reads', async () => {
    const f = await fixture(); const gate = deferred(); const entered = deferred(); f.pendingHook(async () => { entered.resolve(); await gate.promise; }); const routing = f.route(f.request); await entered.promise;
    f.reserved(true); gate.resolve(); expect(await routing).toEqual({ status: 'held' }); expect(f.task().columnId).toBe('wait'); await f.close();
  });
  it.each(['executionId', 'attemptId'] as const)('refuses stale %s and a stopped authority', async key => { const f = await fixture(); await f.edit(hub => { hub.tasks[0]!.deterministic![key] = 'replacement'; }); expect(await f.route(f.request)).toEqual({ status: 'held' }); expect(f.task().columnId).toBe('wait'); await f.close(); });
  it('refuses changed result identity and does not use an altered request target', async () => { const f = await fixture(); f.request.result = { ...f.request.result, id: 'forged' }; expect(await f.route(f.request)).toEqual({ status: 'held' }); expect(f.task().columnId).toBe('wait'); await f.close(); });
  it('keeps source control untouched when transactional storage fails, then retries the same receipt', async () => { const f = await fixture(); f.storage.failSave = true; await expect(f.route(f.request)).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' }); expect(f.task().deterministic?.result?.id).toBe('result'); expect(f.task().columnId).toBe('wait'); f.storage.failSave = false; expect(await f.route(f.request)).toEqual({ status: 'accepted' }); await f.close(); });
  it('persists consumed source and new destination handoff together through repository reopen, then rejects duplicate routing', async () => {
    const f = await fixture('script'); expect(await f.route(f.request)).toEqual({ status: 'accepted' }); const entry = f.task().stageEntry!.id; await f.close();
    const reopened = await HubRepository.open(f.storage, operationDeps()); const recovered = reopened.requireTask('task').task; expect(recovered.stageEntry!.id).toBe(entry); expect(recovered.deterministicHandoff?.id).toBe('delivery'); expect(recovered.deterministic?.executionId).not.toBe('execution');
    const route = createDeterministicRouter({ hubs: reopened, sessions: { isIdle: async () => true }, pending: async () => NO_PENDING_USER_WORK }); expect(await route(f.request)).toEqual({ status: 'held' }); expect(reopened.requireTask('task').task.stageEntry!.id).toBe(entry); await reopened.close();
  });
});
