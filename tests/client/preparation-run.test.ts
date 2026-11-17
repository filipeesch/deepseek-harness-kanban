import { describe, expect, it, vi } from 'vitest';
import { PreparationRunController } from '../../src/client/execution-preparation/preparation-run.js';
import type { PreparationEntry } from '../../src/client/execution-preparation/contract.js';
import type { Task } from '../../src/shared/types.js';

const entry: PreparationEntry = { taskId: 't1', columnId: 'review', enteredAt: 7, instruction: 'Review carefully.' };

type MinimalTask = Pick<Task, 'id' | 'columnId' | 'instructionPending' | 'worktree' | 'operation' | 'worktreeDismissed'>;

function task(overrides: Partial<MinimalTask> = {}): MinimalTask {
  return { id: 't1', columnId: 'review', instructionPending: { columnId: 'review', enteredAt: 7 }, worktree: null, operation: null, ...overrides };
}

function harness(initial: MinimalTask) {
  let current: MinimalTask | undefined = initial;
  const createWorktree = vi.fn(async () => {});
  const dismissWorktree = vi.fn(async () => {});
  const createConversation = vi.fn(async () => {});
  const controller = new PreparationRunController({
    createWorktree,
    dismissWorktree,
    createConversation,
    task: () => current as Task | undefined,
  });
  return {
    controller, createWorktree, dismissWorktree, createConversation,
    set(next: MinimalTask | undefined) { current = next; },
    observe() { controller.observe(current === undefined ? [] : [current as Task]); },
  };
}

describe('PreparationRunController', () => {
  it('waits for the admitted worktree before creating the first conversation', async () => {
    const h = harness(task());
    const running = h.controller.start(entry, 'create');
    await Promise.resolve();
    expect(h.createWorktree).toHaveBeenCalledWith('t1');
    expect(h.createConversation).not.toHaveBeenCalled();
    h.set(task({ operation: { id: 'op', request: { kind: 'create', mode: 'new', path: '/t', branchName: 'b' }, phase: 'queued', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now' } as never, worktree: { path: '/t', branch: 'b', owned: true, status: 'preparing' } }));
    h.observe();
    expect(h.createConversation).not.toHaveBeenCalled();
    h.set(task({ worktree: { path: '/t', branch: 'b', owned: true, status: 'ready' } }));
    h.observe();
    await expect(running).resolves.toBeUndefined();
    expect(h.createConversation).toHaveBeenCalledWith('t1');
  });

  it('reports a failed creation and creates no conversation', async () => {
    const h = harness(task());
    const running = h.controller.start(entry, 'create');
    await Promise.resolve();
    h.set(task({ operation: { id: 'op', phase: 'failed', error: { code: 'WORKTREE_TARGET_EXISTS', message: 'The destination exists.' } } as never }));
    h.observe();
    await expect(running).rejects.toMatchObject({ code: 'WORKTREE_TARGET_EXISTS' });
    expect(h.createConversation).not.toHaveBeenCalled();
  });

  it('abandons the run when the instructed entry moved on', async () => {
    const h = harness(task());
    const running = h.controller.start(entry, 'create');
    await Promise.resolve();
    h.set(task({ columnId: 'doing', instructionPending: undefined }));
    h.observe();
    await expect(running).rejects.toMatchObject({ code: 'PREPARATION_ABANDONED' });
    expect(h.createConversation).not.toHaveBeenCalled();
  });

  it('records the base-project choice and creates the conversation at once', async () => {
    const h = harness(task({ worktreeDismissed: true }));
    await h.controller.start(entry, 'base');
    expect(h.dismissWorktree).toHaveBeenCalledWith('t1');
    expect(h.createConversation).toHaveBeenCalledWith('t1');
  });

  it('creates the first conversation when no worktree answer applies', async () => {
    const h = harness(task());
    await h.controller.start(entry, 'none');
    expect(h.createWorktree).not.toHaveBeenCalled();
    expect(h.dismissWorktree).not.toHaveBeenCalled();
    expect(h.createConversation).toHaveBeenCalledWith('t1');
  });

  it('skips a checkout that another surface already made ready', async () => {
    const h = harness(task({ worktree: { path: '/t', branch: 'b', owned: true, status: 'ready' } }));
    await h.controller.start(entry, 'create');
    expect(h.createWorktree).not.toHaveBeenCalled();
    expect(h.createConversation).toHaveBeenCalledWith('t1');
  });

  it('abandons the run when the board unmounts while the creation command is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    let current: Task | undefined = task() as Task;
    const createWorktree = vi.fn(async () => { await gate; });
    const createConversation = vi.fn(async () => {});
    const controller = new PreparationRunController({ createWorktree, dismissWorktree: vi.fn(async () => {}), createConversation, task: () => current });
    const running = controller.start(entry, 'create');
    await Promise.resolve();
    controller.dispose();
    release();
    await expect(running).rejects.toMatchObject({ code: 'PREPARATION_ABANDONED' });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('replaces a pending wait when a newer preparation targets the same entry', async () => {
    const h = harness(task());
    const first = h.controller.start(entry, 'create');
    await Promise.resolve();
    const second = h.controller.start(entry, 'create');
    await Promise.resolve();
    await expect(first).rejects.toMatchObject({ code: 'PREPARATION_ABANDONED' });
    h.set(task({ worktree: { path: '/t', branch: 'b', owned: true, status: 'ready' } }));
    h.observe();
    await expect(second).resolves.toBeUndefined();
  });

  it('rejects a pending wait when the board disposes the run', async () => {
    const h = harness(task());
    const running = h.controller.start(entry, 'create');
    await Promise.resolve();
    h.controller.dispose();
    await expect(running).rejects.toMatchObject({ code: 'PREPARATION_ABANDONED' });
  });
});
