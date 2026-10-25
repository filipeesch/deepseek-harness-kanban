import { afterEach, describe, expect, it } from 'vitest';
import { KanbanApp } from '../../src/host/app.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { fixture, RESTRICTED_WORKFLOW } from './helpers.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
let active: Fixture[] = [];
afterEach(async () => { for (const value of active.splice(0)) await value.close(); });

async function setup(): Promise<Fixture> {
  const value = await fixture();
  active.push(value);
  await value.store.setWorkflow(RESTRICTED_WORKFLOW);
  return value;
}

async function createTask(value: Fixture, title = 'Implement feature') {
  return value.app.createTask({ projectId: value.project.id, title, description: 'Task description' });
}

function pendingFlags(value: Fixture, taskId: string): { stop: () => void; values: Array<boolean | undefined> } {
  const values: Array<boolean | undefined> = [];
  const stop = value.store.subscribe(state => values.push(state.tasks.find(task => task.id === taskId)?.pendingTransition?.transitionOverride));
  return { stop, values };
}

describe('restricted move admission', () => {
  it('rejects a restricted move without explicit consent and changes nothing', async () => {
    const f = await setup(); const task = await createTask(f);
    const before = f.store.snapshot();
    await expect(f.app.command({ type: 'task.move', taskId: task.id, columnId: 'done', mode: 'move' })).rejects.toMatchObject({ code: 'TRANSITION_NOT_ALLOWED' });
    expect(f.store.snapshot()).toEqual(before);
    expect(f.sessions.sent).toEqual([]);
  });

  it('does not apply the override flag to legacy run-mode transitions', async () => {
    const f = await setup(); const task = await createTask(f);
    await expect(f.app.command({ type: 'task.move', taskId: task.id, columnId: 'review', mode: 'run', expectedInstruction: 'Review carefully.', overrideTransition: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
  });

  it('admits a confirmed restricted move and persists the consent on the pending transition', async () => {
    const f = await setup(); const task = await createTask(f);
    const workflow = f.store.snapshot().workflow;
    const capture = pendingFlags(f, task.id);
    try {
      await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'done', mode: 'move', overrideTransition: true });
    } finally {
      capture.stop();
    }
    expect(f.store.requireTask(task.id).columnId).toBe('done');
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
    expect(f.store.snapshot().workflow).toEqual(workflow);
    expect(f.sessions.sent).toEqual([]);
    expect(capture.values).toContain(true);
  });

  it('does not persist the flag for allowed or same-stage moves', async () => {
    const f = await setup(); const first = await createTask(f, 'First task'); const second = await createTask(f, 'Second task');
    const allowedCapture = pendingFlags(f, first.id);
    try {
      await f.app.command({ type: 'task.move', taskId: first.id, columnId: 'plan', mode: 'move', overrideTransition: true });
    } finally {
      allowedCapture.stop();
    }
    expect(f.store.requireTask(first.id).columnId).toBe('plan');
    expect(allowedCapture.values).not.toContain(true);

    const reorderCapture = pendingFlags(f, second.id);
    try {
      await f.app.command({ type: 'task.move', taskId: second.id, columnId: 'backlog', mode: 'move', beforeTaskId: null, overrideTransition: true });
    } finally {
      reorderCapture.stop();
    }
    expect(f.store.requireTask(second.id).columnId).toBe('backlog');
    expect(reorderCapture.values).not.toContain(true);
  });

  it('moves into an instructed restricted stage without sending an agent instruction', async () => {
    const f = await setup(); const task = await createTask(f);
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'review', mode: 'move', overrideTransition: true });
    const current = f.store.requireTask(task.id);
    expect(current.columnId).toBe('review');
    expect(current.instructionPending?.columnId).toBe('review');
    expect(f.sessions.sent).toEqual([]);
  });

  it('does not bypass a busy task', async () => {
    const f = await setup(); const task = await createTask(f);
    await f.store.transact(state => { state.tasks[0]!.operation = { id: 'operation', request: { kind: 'return' }, phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-10-21T10:00:00.000Z' }; });
    await expect(f.app.command({ type: 'task.move', taskId: task.id, columnId: 'done', mode: 'move', overrideTransition: true })).rejects.toMatchObject({ code: 'CONTEXT_OPERATION_PENDING' });
    expect(f.store.requireTask(task.id).columnId).toBe('backlog');
  });
});

describe('pending override completion', () => {
  it('retries a failed confirmed pending move', async () => {
    const f = await setup(); const task = await createTask(f);
    await f.store.transact(state => { state.tasks[0]!.pendingTransition = { id: 'pending-override', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'failed', transitionOverride: true }; });
    await f.app.command({ type: 'operation.retry', taskId: task.id });
    expect(f.store.requireTask(task.id).columnId).toBe('done');
    expect(f.store.requireTask(task.id).pendingTransition).toBeUndefined();
  });

  it('keeps the confirmed override across a restart', async () => {
    const f = await setup(); const task = await createTask(f);
    await f.app.close();
    await f.store.transact(state => { state.tasks[0]!.pendingTransition = { id: 'pending-restart', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'waiting', transitionOverride: true }; });
    const reopened = await HubRepository.open(f.storage, { id: (() => { let n = 0; return () => `restart-${++n}`; })(), now: () => new Date().toISOString() });
    const app = new KanbanApp(reopened, f.sessions, f.git, {}, f.workspaces);
    try {
      await app.initialize();
      const current = reopened.defaultHub().requireTask(task.id);
      expect(current.columnId).toBe('done');
      expect(current.pendingTransition).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('keeps the workflow recheck for a non-override pending move', async () => {
    const f = await setup(); const task = await createTask(f);
    await f.store.transact(state => { state.tasks[0]!.pendingTransition = { id: 'pending-normal', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'failed' }; });
    await f.app.command({ type: 'operation.retry', taskId: task.id });
    const current = f.store.requireTask(task.id);
    expect(current.columnId).toBe('backlog');
    expect(current.pendingTransition).toMatchObject({ status: 'failed', error: { code: 'TRANSITION_NOT_ALLOWED' } });
  });

  it('refuses an override when the source stage changed', async () => {
    const f = await setup(); const task = await createTask(f);
    await f.store.transact(state => { state.tasks[0]!.pendingTransition = { id: 'pending-source', fromColumnId: 'backlog', columnId: 'done', mode: 'move', status: 'failed', transitionOverride: true }; state.tasks[0]!.columnId = 'plan'; });
    await f.app.command({ type: 'operation.retry', taskId: task.id });
    const current = f.store.requireTask(task.id);
    expect(current.columnId).toBe('plan');
    expect(current.pendingTransition).toMatchObject({ status: 'failed', error: { code: 'REVISION_CONFLICT' } });
  });

  it('places a confirmed restricted move at the requested position', async () => {
    const f = await setup(); const first = await createTask(f, 'First destination'); const second = await createTask(f, 'Second destination'); const moving = await createTask(f, 'Moving task');
    await f.store.transact(state => {
      for (const id of [first.id, second.id]) { const task = state.tasks.find(value => value.id === id)!; task.columnId = 'done'; }
      state.tasks.find(value => value.id === first.id)!.position = 0;
      state.tasks.find(value => value.id === second.id)!.position = 1;
    });
    await f.app.command({ type: 'task.move', taskId: moving.id, columnId: 'done', mode: 'move', beforeTaskId: second.id, overrideTransition: true });
    const done = f.store.snapshot().tasks.filter(task => task.columnId === 'done').sort((left, right) => left.position - right.position);
    expect(done.map(task => task.id)).toEqual([first.id, moving.id, second.id]);
  });
});
