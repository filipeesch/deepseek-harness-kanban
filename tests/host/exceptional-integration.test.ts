import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { KanbanApp } from '../../src/host/app.js';
import { TURN_ADVANCE_SETTLE_MS } from '../../src/host/turn-advance.js';
import { fixture, RESTRICTED_WORKFLOW, taskWithConversation } from './helpers.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { vi.useRealTimers(); for (const f of active.splice(0)) await f.close(); });
async function setup(auto = false) {
  let open = true;
  const f = await fixture({ turnBoundary: { boundary: () => open ? { openTurnStartSeq: 1, lastTurn: 3 } : { openTurnStartSeq: null, lastTurn: 3 } } });
  active.push(f);
  await f.store.saveBoardWorkflow(f.board.id, RESTRICTED_WORKFLOW);
  const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Exceptional', description: '' });
  if (auto) await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
  const session = task.sessionIds[0]!;
  const exec = { signal: new AbortController().signal, agent: { id: session }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
  const set = productToolDefinitions(f.app).find(tool => tool.name === 'set_next_transition')!;
  return { ...f, task, session, set, exec, end: () => { open = false; } };
}

describe('exceptional transition integration', () => {
  for (const auto of [false, true]) it('admits the exact completed turn with auto mode ' + auto, async () => {
    const f = await setup(auto);
    const result = await f.set.execute({ column_id: 'done', reason: 'Requested by the user.', exception: true }, f.exec) as any;
    expect(result.recorded).toMatchObject({ columnId: 'done', exceptional: true, boundToOriginatingTurn: true });
    expect(result.armed).toBe(true);
    expect(result.recordedProblem).toBeUndefined();
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    vi.useFakeTimers();
    f.end(); f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20);
    vi.useRealTimers();
    await expect.poll(() => f.store.requireTask(f.task.id).columnId).toBe('done');
    expect(f.store.requireTask(f.task.id).autoMode?.enabled === true).toBe(auto);
  });
  for (const auto of [false, true]) it('preserves the owner route after another conversation becomes idle, auto mode ' + auto, async () => {
    const f = await setup(auto);
    await f.app.createConversation(f.task.id);
    const other = f.store.requireTask(f.task.id).sessionIds[1]!;
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    vi.useFakeTimers(); f.sessions.busy.add(f.session); f.sessions.busy.add(other);
    f.app.observe(other, { type: 'turn/start', seq: 1, data: { turn: 1 } });
    f.sessions.busy.delete(other);
    f.app.observe(other, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20);
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(f.task.id).recordedTransition?.exception).toBeDefined();
    f.sessions.busy.delete(f.session); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 4, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    await expect.poll(() => f.store.requireTask(f.task.id).columnId).toBe('done');
  });
  for (const kind of ['error', 'aborted']) it('keeps the normal pause when B settled while the owner ran, then the owner ends ' + kind, async () => {
    const f = await setup(true);
    await f.app.createConversation(f.task.id);
    const other = f.store.requireTask(f.task.id).sessionIds[1]!;
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    vi.useFakeTimers(); f.sessions.busy.add(f.session);
    f.app.observe(other, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 30);
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    f.sessions.busy.delete(f.session); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 4, data: { turn: 3, reason: { kind } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 30); vi.useRealTimers();
    await expect.poll(() => f.store.requireTask(f.task.id).autoMode?.pause?.reason).toBe(kind === 'error' ? 'turn-error' : 'turn-aborted');
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(f.task.id).autoMode?.enabled).toBe(true);
  });
  it('keeps automatic mode disabled when the owner fails after another completion', async () => {
    const f = await setup(false);
    await f.app.createConversation(f.task.id);
    const other = f.store.requireTask(f.task.id).sessionIds[1]!;
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    f.app.observe(other, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } });
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 4, data: { turn: 3, reason: { kind: 'aborted' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 30); vi.useRealTimers();
    await expect.poll(() => f.store.requireTask(f.task.id).recordedTransition).toBeUndefined();
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(f.task.id).autoMode?.enabled).not.toBe(true);
  });
  it('does not capture an exceptional advance from a conversation that does not own the stage', async () => {
    const f = await setup();
    await f.app.createConversation(f.task.id);
    const other = f.store.requireTask(f.task.id).sessionIds[1]!;
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    vi.useFakeTimers();
    // The side conversation's completed turn never captures the declaration.
    f.app.observe(other, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 30);
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(f.task.id).recordedTransition?.exception).toBeDefined();
    // The owner's completed turn does.
    f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 4, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 30);
    vi.useRealTimers();
    await expect.poll(() => f.store.requireTask(f.task.id).columnId).toBe('done');
  });
  it('ignores duplicate completion rather than automatically moving twice', async () => {
    const f = await setup(true);
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    const event = { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } };
    vi.useFakeTimers(); f.end(); f.app.observe(f.session, event);
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20);
    f.app.observe(f.session, event);
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    expect(f.store.requireTask(f.task.id).columnId).toBe('done');
    expect(f.store.requireTask(f.task.id).pendingTransition).toBeUndefined();
  });
  it('supports a legacy task with no persisted stage entry without inventing one', async () => {
    const f = await setup();
    await f.store.transact(draft => { delete draft.tasks.find(task => task.id === f.task.id)!.stageEntry; });
    const result = await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec) as any;
    expect(result.armed).toBe(true);
    expect(f.store.requireTask(f.task.id).stageEntry).toBeUndefined();
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    await expect.poll(() => f.store.requireTask(f.task.id).columnId).toBe('done');
  });
  it('marks a lost turn boundary unarmed and invalidates it without a turn end', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    f.end();
    const list = productToolDefinitions(f.app).find(tool => tool.name === 'list_allowed_transitions')!;
    const result = await list.execute({}, f.exec) as any;
    expect(result.armed).toBe(false);
    await expect.poll(() => f.store.requireTask(f.task.id).recordedTransition).toBeUndefined();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
  });
  it('does not restore an unadmitted exception after a host restart', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    await f.app.close();
    const reopened = new KanbanApp(f.hubs, f.sessions, f.git);
    try {
      const list = productToolDefinitions(reopened).find(tool => tool.name === 'list_allowed_transitions')!;
      const result = await list.execute({}, f.exec) as any;
      expect(result.recorded).toMatchObject({ columnId: 'done', exceptional: true });
      expect(result.armed).toBe(false);
      vi.useFakeTimers();
      reopened.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
      expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    } finally { await reopened.close(); }
  });
  it('discards an unfinalized exceptional preparation after a crash', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    await f.store.transact(draft => {
      const task = draft.tasks.find(value => value.id === f.task.id)!;
      task.pendingTransition = { id: 'prepared-id', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'waiting', origin: 'agent', reason: 'Requested.', transitionOverride: true, exceptionUnfinalized: task.recordedTransition!.exception!.id };
    });
    await f.app.close();
    const reopened = new KanbanApp(f.hubs, f.sessions, f.git);
    try {
      await reopened.initialize();
      const task = f.store.requireTask(f.task.id);
      expect(task.pendingTransition).toBeUndefined();
      expect(task.recordedTransition).toBeUndefined();
      expect(task.columnId).toBe('backlog');
    } finally { await reopened.close(); }
  });
  it('recovers a finalized exceptional admission after restart', async () => {
    const f = await setup();
    await f.store.transact(draft => {
      const task = draft.tasks.find(value => value.id === f.task.id)!;
      task.pendingTransition = { id: 'finalized-id', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'waiting', origin: 'agent', reason: 'Requested.', transitionOverride: true };
    });
    await f.app.close();
    const reopened = new KanbanApp(f.hubs, f.sessions, f.git);
    try {
      await reopened.initialize();
      await expect.poll(() => f.store.requireTask(f.task.id).columnId).toBe('done');
    } finally { await reopened.close(); }
  });
  it('discards interrupted preparation without deleting a newer same-destination declaration', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    await f.store.transact(draft => {
      const task = draft.tasks.find(value => value.id === f.task.id)!;
      const oldId = task.recordedTransition!.exception!.id;
      task.pendingTransition = { id: 'prepared-id', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'waiting', origin: 'agent', reason: 'Requested.', transitionOverride: true, exceptionUnfinalized: oldId };
      task.recordedTransition!.exception!.id = 'new-exception';
    });
    await f.app.close();
    const reopened = new KanbanApp(f.hubs, f.sessions, f.git);
    try {
      await reopened.initialize();
      const task = f.store.requireTask(f.task.id);
      expect(task.pendingTransition).toBeUndefined();
      expect(task.recordedTransition?.exception?.id).toBe('new-exception');
      expect(task.columnId).toBe('backlog');
    } finally { await reopened.close(); }
  });
  it('expires a failed originating turn without moving or restoring prior intent', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'plan', reason: 'Earlier route.' }, f.exec);
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    f.end(); f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'error' } } });
    await expect.poll(() => f.store.requireTask(f.task.id).recordedTransition).toBeUndefined();
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
  });
  it('expires when pending user work or another running conversation blocks admission', async () => {
    for (const blocker of ['pending', 'busy'] as const) {
      const f = await setup();
      await f.app.createConversation(f.task.id);
      const other = f.store.requireTask(f.task.id).sessionIds[1]!;
      await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
      if (blocker === 'pending') f.sessions.awaiting.add(other); else f.sessions.busy.add(other);
      vi.useFakeTimers(); f.end();
      f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
      await expect.poll(() => f.store.requireTask(f.task.id).recordedTransition).toBeUndefined();
      expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    }
  });
  it('revokes admission when another conversation changes at the pending-read barrier', async () => {
    for (const event of [
      { type: 'turn/start', seq: 11, data: { turn: 1 } },
      { type: 'agent/inbox/spliced', seq: 12, data: {} },
    ]) {
      const f = await setup();
      await f.app.createConversation(f.task.id);
      const other = f.store.requireTask(f.task.id).sessionIds[1]!;
      await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
      const read = f.sessions.facts.bind(f.sessions); let reads = 0;
      f.sessions.facts = async id => {
        const snapshot = await read(id);
        if (id === other && ++reads === 3) {
          f.sessions.awaiting.add(other);
          f.app.observe(other, event);
        }
        return snapshot;
      };
      vi.useFakeTimers(); f.end();
      f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
      await expect.poll(() => f.store.requireTask(f.task.id).recordedTransition).toBeUndefined();
      expect(reads).toBeGreaterThanOrEqual(3);
      expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
      expect(f.store.requireTask(f.task.id).pendingTransition).toBeUndefined();
    }
  });
  it('does not dispatch when another conversation starts before the settle is read', async () => {
    const f = await setup();
    await f.app.createConversation(f.task.id);
    const other = f.store.requireTask(f.task.id).sessionIds[1]!;
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    // Another conversation starts before the settle reads the task, so the admission
    // must not dispatch the prepared transition.
    f.sessions.busy.add(other);
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 30); vi.useRealTimers();
    await expect.poll(() => f.store.requireTask(f.task.id).pendingTransition).toBeUndefined();
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.sessions.sent).toHaveLength(0);
  });
  it('reconciles a failed finalization according to durable storage, not the thrown error', async () => {
    for (const wrote of [false, true]) {
      const f = await setup();
      await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
      const save = f.storage.saveHub.bind(f.storage); let failed = false;
      f.storage.saveHub = async state => {
        const pending = state.tasks.find(task => task.id === f.task.id)?.pendingTransition;
        if (!failed && pending?.transitionOverride === true && pending.exceptionUnfinalized === undefined) {
          failed = true;
          if (wrote) await save(state);
          throw Error('injected finalization save failure');
        }
        await save(state);
      };
      vi.useFakeTimers(); f.end();
      f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
      await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
      if (wrote) await expect.poll(() => f.store.requireTask(f.task.id).columnId).toBe('done');
      else {
        await expect.poll(() => f.store.requireTask(f.task.id).pendingTransition).toBeUndefined();
        expect(f.store.requireTask(f.task.id).recordedTransition).toBeUndefined();
        expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
      }
      expect(failed).toBe(true);
    }
  });
  it('fails closed without overwriting an inconclusive newer durable revision', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    const save = f.storage.saveHub.bind(f.storage); let failed = false;
    f.storage.saveHub = async state => {
      const pending = state.tasks.find(task => task.id === f.task.id)?.pendingTransition;
      if (!failed && pending?.transitionOverride === true && pending.exceptionUnfinalized === undefined) {
        failed = true;
        const external = structuredClone(state); external.revision++;
        external.tasks.find(task => task.id === f.task.id)!.title = 'External change';
        await save(external);
        throw Error('uncertain finalization');
      }
      await save(state);
    };
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    expect(failed).toBe(true);
    expect(f.storage.hubs.get(f.hub.id)!.tasks.find(task => task.id === f.task.id)!.title).toBe('External change');
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(f.task.id).pendingTransition?.exceptionUnfinalized).toBeDefined();
    expect(f.sessions.sent).toHaveLength(0);
    await expect(f.store.editTask(f.task.id, { title: 'Overwrite' })).rejects.toMatchObject({ code: 'EXCEPTION_COMMIT_UNCERTAIN' });
    expect(f.storage.hubs.get(f.hub.id)!.tasks.find(task => task.id === f.task.id)!.title).toBe('External change');
  });
  it('never trusts a stale cache after durable finalization returned an error', async () => {
    const f = await setup();
    Object.defineProperty(f.storage, 'verifiedReadAfterFailedSave', { value: undefined });
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    const save = f.storage.saveHub.bind(f.storage); let failed = false; let stale: any;
    const read = vi.fn(async () => stale);
    f.storage.saveHub = async state => {
      const pending = state.tasks.find(task => task.id === f.task.id)?.pendingTransition;
      if (!failed && pending?.transitionOverride === true && pending.exceptionUnfinalized === undefined) {
        failed = true;
        stale = { hubs: [...f.storage.hubs.values()].map(hub => structuredClone(hub)), meta: structuredClone(f.storage.meta) };
        await save(state);
        f.storage.loadAll = read;
        throw Error('directory sync failed after durable rename');
      }
      await save(state);
    };
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    expect(failed).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(f.store.requireTask(f.task.id).pendingTransition?.exceptionUnfinalized).toBeDefined();
    const durable = f.storage.hubs.get(f.hub.id)!.tasks.find(task => task.id === f.task.id)!;
    expect(durable.pendingTransition?.exceptionUnfinalized).toBeUndefined();
    expect(durable.pendingTransition?.columnId).toBe('done');
    await expect(f.store.editTask(f.task.id, { title: 'Unsafe overwrite' })).rejects.toMatchObject({ code: 'EXCEPTION_COMMIT_UNCERTAIN' });
    expect(f.storage.hubs.get(f.hub.id)!.tasks.find(task => task.id === f.task.id)!.pendingTransition?.exceptionUnfinalized).toBeUndefined();
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
  });
  it('quarantines a Hub when the adapter cannot verify a failed save', async () => {
    const f = await setup();
    Object.defineProperty(f.storage, 'verifiedReadAfterFailedSave', { value: undefined });
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    const save = f.storage.saveHub.bind(f.storage); let failed = false;
    f.storage.saveHub = async state => {
      const pending = state.tasks.find(task => task.id === f.task.id)?.pendingTransition;
      if (!failed && pending?.transitionOverride === true && pending.exceptionUnfinalized === undefined) {
        failed = true; throw Error('uncertain write');
      }
      await save(state);
    };
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    expect(failed).toBe(true);
    expect(f.store.requireTask(f.task.id).pendingTransition?.exceptionUnfinalized).toBeDefined();
    await expect(f.store.editTask(f.task.id, { title: 'Unsafe write' })).rejects.toMatchObject({ code: 'EXCEPTION_COMMIT_UNCERTAIN' });
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
  });
  it('quarantines a Hub when durable readback fails', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    const save = f.storage.saveHub.bind(f.storage); let failed = false;
    f.storage.saveHub = async state => {
      const pending = state.tasks.find(task => task.id === f.task.id)?.pendingTransition;
      if (!failed && pending?.transitionOverride === true && pending.exceptionUnfinalized === undefined) {
        failed = true; f.storage.failLoad = true; throw Error('uncertain write');
      }
      await save(state);
    };
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    expect(failed).toBe(true);
    await expect(f.store.editTask(f.task.id, { title: 'Unsafe write' })).rejects.toMatchObject({ code: 'EXCEPTION_COMMIT_UNCERTAIN' });
    expect(f.store.requireTask(f.task.id).pendingTransition?.exceptionUnfinalized).toBeDefined();
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
  });
  it('does not clear or consume a normal replacement during settling', async () => {
    const f = await setup();
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    vi.useFakeTimers(); f.end();
    f.app.observe(f.session, { type: 'turn/end', seq: 2, data: { turn: 3, reason: { kind: 'completed' } } });
    await f.set.execute({ column_id: 'plan', reason: 'Replacement.' }, f.exec);
    await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 20); vi.useRealTimers();
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(f.task.id).recordedTransition).toMatchObject({ columnId: 'plan', reason: 'Replacement.' });
  });
  it('does not let another conversation consume the exception', async () => {
    const f = await setup();
    await f.app.createConversation(f.task.id);
    const other = f.store.requireTask(f.task.id).sessionIds[1]!;
    await f.set.execute({ column_id: 'done', reason: 'Requested.', exception: true }, f.exec);
    f.app.observe(other, { type: 'turn/end', seq: 4, data: { turn: 3, reason: { kind: 'completed' } } });
    expect(f.store.requireTask(f.task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(f.task.id).recordedTransition?.exception?.sessionId).toBe(f.session);
  });
});
