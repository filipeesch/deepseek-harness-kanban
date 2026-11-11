import { afterEach, describe, expect, it, vi } from 'vitest';
import { KanbanApp } from '../../src/host/app.js';
import { AUTO_ADVANCE_SETTLE_MS } from '../../src/host/auto-advance.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import type { HubState } from '../../src/shared/types.js';
import { fixture, taskWithConversation } from './helpers.js';

let active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { vi.useRealTimers(); for (const value of active.splice(0)) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }

function order(state: HubState, columnId: string, boardId: string) {
  return state.tasks.filter(task => task.boardId === boardId && task.columnId === columnId)
    .sort((left, right) => left.position - right.position).map(task => task.title);
}

async function create(app: KanbanApp, projectId: string, title: string) {
  return app.createTask({ projectId, title, description: '' });
}

describe('move placement', () => {
  it('records the stage entry, and none for a reorder inside the destination', async () => {
    const f = await setup();
    const task = await create(f.app, f.project.id, 'Recorded');
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan' });
    const moved = f.store.requireTask(task.id);
    expect((moved.history ?? []).filter(entry => entry.kind === 'stage')).toEqual([
      { kind: 'stage', at: expect.any(String), fromColumnId: 'backlog', columnId: 'plan' },
    ]);
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'plan', beforeTaskId: null });
    expect((f.store.requireTask(task.id).history ?? []).filter(entry => entry.kind === 'stage')).toHaveLength(1);
  });

  it('places an unanchored move at the top of the destination', async () => {
    const f = await setup();
    const first = await create(f.app, f.project.id, 'First');
    await create(f.app, f.project.id, 'Second');
    await f.app.command({ type: 'task.move', taskId: first.id, columnId: 'plan' });
    const second = f.store.snapshot().tasks.find(task => task.title === 'Second')!;
    await f.app.command({ type: 'task.move', taskId: second.id, columnId: 'plan' });
    expect(order(f.store.snapshot(), 'plan', f.board.id)).toEqual(['Second', 'First']);
    expect(f.store.requireTask(second.id).position).toBe(0);
    expect(f.store.requireTask(first.id).position).toBe(1);
  });

  it('keeps an explicit null anchor at the end of the destination', async () => {
    const f = await setup();
    const first = await create(f.app, f.project.id, 'First');
    const second = await create(f.app, f.project.id, 'Second');
    await f.app.command({ type: 'task.move', taskId: first.id, columnId: 'plan' });
    await f.app.command({ type: 'task.move', taskId: second.id, columnId: 'plan', beforeTaskId: null });
    expect(order(f.store.snapshot(), 'plan', f.board.id)).toEqual(['First', 'Second']);
  });

  it('keeps an explicit task anchor before that task', async () => {
    const f = await setup();
    const first = await create(f.app, f.project.id, 'First');
    const second = await create(f.app, f.project.id, 'Second');
    const third = await create(f.app, f.project.id, 'Third');
    await f.app.command({ type: 'task.move', taskId: first.id, columnId: 'plan' });
    await f.app.command({ type: 'task.move', taskId: second.id, columnId: 'plan' });
    await f.app.command({ type: 'task.move', taskId: third.id, columnId: 'plan', beforeTaskId: first.id });
    expect(order(f.store.snapshot(), 'plan', f.board.id)).toEqual(['Second', 'Third', 'First']);
  });

  it('places a persisted transition without an anchor at the top after a restart', async () => {
    const f = await setup();
    const first = await create(f.app, f.project.id, 'First');
    const second = await create(f.app, f.project.id, 'Second');
    await f.app.command({ type: 'task.move', taskId: first.id, columnId: 'plan' });
    await f.app.close();
    await f.store.transact(draft => {
      const task = draft.tasks.find(value => value.id === second.id)!;
      task.pendingTransition = { id: 'legacy-pending', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'waiting' };
    });
    const reopened = await HubRepository.open(f.storage, { id: (() => { let n = 0; return () => `restart-${++n}`; })(), now: () => new Date().toISOString() });
    const restarted = new KanbanApp(reopened, f.sessions, f.git, { probe: f.probe }, f.workspaces);
    try {
      await restarted.initialize();
      const reloaded = reopened.defaultHub();
      expect(reloaded.requireTask(second.id).columnId).toBe('plan');
      expect(order(reloaded.snapshot(), 'plan', f.board.id)).toEqual(['Second', 'First']);
      expect(reloaded.requireTask(second.id).position).toBe(0);
      expect(reloaded.requireTask(second.id).pendingTransition).toBeUndefined();
    } finally {
      await restarted.close();
    }
  });

  it('places an automatic advance at the top of the destination', async () => {
    const f = await setup();
    await f.store.setWorkflow([
      'name: Auto flow',
      'initial_column: backlog',
      'columns:',
      '  - id: backlog',
      '    label: Backlog',
      '  - id: plan',
      '    label: Plan',
      '    on_enter_prompt: Plan it.',
      '  - id: done',
      '    label: Done',
      '',
    ].join('\n'));
    const existing = await create(f.app, f.project.id, 'Existing');
    await f.app.command({ type: 'task.move', taskId: existing.id, columnId: 'plan' });
    const advancing = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Advancing', description: '' });
    await f.app.command({ type: 'task.autoMode', taskId: advancing.id, enabled: true });
    vi.useFakeTimers();
    try {
      f.app.observe(advancing.sessionIds[0]!, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } });
      await vi.advanceTimersByTimeAsync(AUTO_ADVANCE_SETTLE_MS + 25);
    } finally {
      vi.useRealTimers();
    }
    await expect.poll(() => f.store.requireTask(advancing.id).columnId).toBe('plan');
    expect(order(f.store.snapshot(), 'plan', f.board.id)).toEqual(['Advancing', 'Existing']);
  });
});