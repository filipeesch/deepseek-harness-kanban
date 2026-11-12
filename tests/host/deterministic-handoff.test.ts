import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { registerDeterministicHandoffInjection, createDeterministicHandoffMessage, type HandoffInjectionPorts } from '../../src/host/deterministic-handoff.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import type { HubTask } from '../../src/shared/types.js';
const at = '2026-11-01T00:00:00.000Z';
const disposers: Array<() => void> = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(ready => { resolve = ready; }); return { promise, resolve }; }
function user(text = 'Explicit input') { return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }); }
function messages(value: unknown): UserMessage[] { const decision = value as { kind: string; messages: UserMessage[] }; expect(decision.kind).toBe('enter'); return decision.messages; }
function fixture(overrides: Partial<HandoffInjectionPorts> = {}) {
  const ctx = new Context();
  const task: HubTask = { id: 'task', boardId: 'board', projectId: 'project', title: 'Synthetic CI', description: '', columnId: 'manual', position: 0, sessionIds: ['s1', 's2'], closedSessionIds: [], effectiveCwd: '/isolated', worktree: null, operation: null, createdAt: at, updatedAt: at,
    stageEntry: { id: 'entry', columnId: 'manual', stageIdentity: 'stable', enteredAt: at },
    deterministicHandoff: { id: 'delivery', entryId: 'entry', executionId: 'run', fromColumnId: 'ci', columnId: 'manual', exit: 'passed', message: 'CI passed [REDACTED]', at } };
  const logs = new Map<string, readonly unknown[]>();
  const locks = new Set<string>();
  const events = vi.fn(async (sessionId: string) => logs.get(sessionId) ?? []);
  const unlock = vi.fn(() => { locks.delete(task.id); });
  const reserve = vi.fn((taskId: string, entryId: string, deliveryId: string) => {
    if (task.stageEntry?.id !== entryId || task.deterministicHandoff?.id !== deliveryId) throw new Error('STALE_HANDOFF');
    if (locks.has(taskId)) throw new Error('NATIVE_ADMISSION_PENDING');
    locks.add(taskId); return unlock;
  });
  const accept = vi.fn(async (_taskId: string, entryId: string, deliveryId: string) => { if (task.stageEntry?.id === entryId && task.deterministicHandoff?.id === deliveryId) task.deterministicHandoff.acceptedAt = at; });
  const report = vi.fn();
  const ports: HandoffInjectionPorts = { locateBySession: sessionId => task.sessionIds.includes(sessionId) ? { task } as LocatedTask : undefined, events, reserve, accept, report, ...overrides };
  const dispose = registerDeterministicHandoffInjection(ctx, ports); disposers.push(dispose);
  const step = (sessionId = 's1', controller = new AbortController(), input: UserMessage[] = [user()]) => ctx.waterfall('agent/pre-step', { agent: { id: SessionId(sessionId) } as Agent, turn: 7, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal: controller.signal, messages: input }, async () => ({ kind: 'enter' as const, messages: input }));
  const receipt = (sessionId = 's1', type = 'user/message') => {
    const message = createDeterministicHandoffMessage(task.deterministicHandoff!);
    const event = type === 'agent/inbox/spliced' ? { type, data: { inserted: [message] } } : { type, data: message };
    logs.set(sessionId, [...(logs.get(sessionId) ?? []), event]);
    ctx.emit('session/event', { id: SessionId(sessionId) } as never, event as never);
  };
  const move = () => { if (locks.has(task.id)) throw new Error('NATIVE_ADMISSION_PENDING'); task.stageEntry = { ...task.stageEntry!, id: 'new-entry' }; };
  return { ctx, task, logs, locks, events, reserve, unlock, accept, report, step, receipt, move, dispose };
}
describe('manual deterministic handoff native pre-step', () => {
  it('prepends identified context to the same explicit turn without mutating input or creating a conversation', async () => {
    const f = fixture(); const explicit = user('Keep composer text and attachment metadata untouched'); const input = [explicit];
    const output = messages(await f.step('s1', new AbortController(), input));
    expect(output).toHaveLength(2); expect(output[1]).toBe(explicit); expect(input).toEqual([explicit]);
    expect(output[0]!.source).toMatchObject({ kind: 'deterministic-handoff', form: 'notice', requestId: 'delivery', entryId: 'entry' });
    expect(output[0]!.content).toEqual([{ type: 'text', text: expect.stringContaining('exit: passed; execution: run') }]);
    expect(f.task.sessionIds).toEqual(['s1', 's2']); expect(f.accept).not.toHaveBeenCalled(); expect(f.locks.has('task')).toBe(true);
  });
  it.each(['user/message', 'agent/inbox/spliced'])('records a durable receipt on %s, then suppresses every conversation duplicate', async type => {
    const f = fixture(); await f.step(); f.receipt('s1', type);
    await vi.waitFor(() => expect(f.accept).toHaveBeenCalledWith('task', 'entry', 'delivery'));
    await vi.waitFor(() => expect(f.locks.size).toBe(0));
    expect(messages(await f.step('s2'))).toHaveLength(1); expect(f.reserve).toHaveBeenCalledTimes(1);
  });
  it('reconciles recorded admission from another conversation without injecting a second context', async () => {
    const f = fixture(); f.logs.set('s2', [{ type: 'agent/inbox/spliced', data: { inserted: [createDeterministicHandoffMessage(f.task.deterministicHandoff!)] } }]);
    expect(messages(await f.step('s1'))).toHaveLength(1); expect(f.accept).toHaveBeenCalledWith('task', 'entry', 'delivery'); expect(f.reserve).not.toHaveBeenCalled();
  });
  it('releases an aborted unaccepted admission and permits a retry with the same delivery identity', async () => {
    const f = fixture(); const controller = new AbortController();
    expect(messages(await f.step('s1', controller))).toHaveLength(2); controller.abort();
    expect(f.locks.size).toBe(0); expect(f.task.deterministicHandoff?.acceptedAt).toBeUndefined();
    const next = messages(await f.step()); expect(next).toHaveLength(2); expect(next[0]!.source).toMatchObject({ requestId: 'delivery' });
  });
  it('retains the handoff when native execution is rejected or has no input', async () => {
    const f = fixture(); expect(messages(await f.step('s1', new AbortController(), []))).toHaveLength(0);
    const agent = { id: SessionId('s1') } as Agent;
    const rejected = await f.ctx.waterfall('agent/pre-step', { agent, turn: 7, step: 1, modelSelection: { provider: 'fixture', model: 'fixture' }, signal: new AbortController().signal, messages: [user()] }, async () => ({ kind: 'reject' as const }));
    expect(rejected.kind).toBe('reject'); expect(f.events).not.toHaveBeenCalled(); expect(f.accept).not.toHaveBeenCalled();
  });
  it('rejects an old entry after leaving and returning to the same column during a history read', async () => {
    const gate = deferred<readonly unknown[]>(); const f = fixture({ events: () => gate.promise });
    const pending = f.step(); await Promise.resolve(); f.task.stageEntry = { ...f.task.stageEntry!, id: 'replacement-entry' }; gate.resolve([]);
    expect(messages(await pending)).toHaveLength(1); expect(f.reserve).not.toHaveBeenCalled(); expect(f.accept).not.toHaveBeenCalled();
  });
  it('holds placement reservation until durable native acceptance is recorded, not middleware return', async () => {
    const gate = deferred(); const f = fixture({ accept: () => gate.promise });
    await f.step(); expect(() => f.move()).toThrow('NATIVE_ADMISSION_PENDING');
    f.receipt(); expect(() => f.move()).toThrow('NATIVE_ADMISSION_PENDING');
    gate.resolve(); await vi.waitFor(() => expect(f.locks.size).toBe(0)); expect(() => f.move()).not.toThrow();
  });
  it('does not prepend standalone context for instructed or deterministic destinations', async () => {
    const f = fixture(); f.task.deterministicHandoff!.instruction = 'Destination instruction';
    expect(messages(await f.step())).toHaveLength(1); expect(f.events).not.toHaveBeenCalled();
  });
  it('waits for an already reserved conversation receipt before releasing another explicit turn', async () => {
    const f = fixture(); await f.step('s1');
    const second = f.step('s2'); f.receipt('s1');
    expect(messages(await second)).toHaveLength(1); expect(f.reserve).toHaveBeenCalledTimes(1);
  });
  it('recovers a failed receipt settlement from durable events without injecting another context', async () => {
    const accept = vi.fn().mockRejectedValueOnce(new Error('Store temporarily unavailable')).mockResolvedValue(undefined);
    const f = fixture({ accept }); await f.step(); f.receipt();
    await vi.waitFor(() => expect(f.report).toHaveBeenCalled());
    await vi.waitFor(() => expect(f.locks.size).toBe(0));
    expect(messages(await f.step('s2'))).toHaveLength(1); expect(accept).toHaveBeenCalledTimes(2); expect(f.reserve).toHaveBeenCalledTimes(1);
  });
  it('aborts during asynchronous history inspection without reserving or losing retryability', async () => {
    const gate = deferred<readonly unknown[]>(); const f = fixture({ events: () => gate.promise }); const controller = new AbortController();
    const pending = f.step('s1', controller); const observed = pending.catch(error => error);
    await Promise.resolve(); controller.abort(); gate.resolve([]);
    await expect(observed).resolves.toMatchObject({ name: 'AbortError' }); expect(f.reserve).not.toHaveBeenCalled();
    expect(messages(await f.step('s1'))).toHaveLength(2);
  });
  it('serializes concurrent conversations that both finish their history reads before admission', async () => {
    const gate = deferred<readonly unknown[]>(); const f = fixture({ events: () => gate.promise });
    const first = f.step('s1'); const second = f.step('s2');
    const secondResult = second.then(value => ({ value }), error => ({ error }));
    gate.resolve([]); await first; f.receipt('s1');
    const result = await secondResult;
    expect(result).not.toHaveProperty('error');
    if ('value' in result) expect(messages(result.value)).toHaveLength(1);
    expect(f.reserve).toHaveBeenCalledTimes(1);
  });
});
