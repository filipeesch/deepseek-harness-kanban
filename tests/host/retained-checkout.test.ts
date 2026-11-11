import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fixture } from './helpers.js';
import { KanbanError } from '../../src/shared/errors.js';
import { CommandSchema } from '../../src/remote.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const value of active.splice(0).reverse()) await value.close(); });
async function setup() { const value = await fixture(); active.push(value); return value; }
async function setupWith(options: Parameters<typeof fixture>[0]) { const value = await fixture(options); active.push(value); return value; }
type F = Awaited<ReturnType<typeof setup>>;

const unavailable = (f: F) => new KanbanError('PATH_UNAVAILABLE', 'The directory cannot be resolved.', { path: f.projectPath });

/** Delete one task whose Git context cannot be resolved, so the host records its checkout as retained. */
async function retainCheckout(f: F, title: string): Promise<{ taskId: string; root: string }> {
  // Creating a checkout needs the resolvable project directory the deletion then loses.
  f.git.projectDirectoryFailure = undefined;
  const task = await f.app.createTask({ projectId: f.project.id, title, description: '' });
  const root = path.join(f.root, 'trees', title.replace(/\s+/g, '-'));
  await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: root, branchName: 'task/' + title.replace(/\s+/g, '-'), sourceBranch: 'main' });
  await f.app.createConversation(task.id);
  f.git.projectDirectoryFailure = unavailable(f);
  await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
  await f.app.worktrees.settle();
  return { taskId: task.id, root };
}

/** Delete a folder project's task while it still has a plain checkout binding. */
async function retainFolderCheckout(f: F, title: string): Promise<{ taskId: string; root: string }> {
  const saved = await f.app.command({ type: 'project.save', project: { name: 'Notes', projectPath: f.projectPath } });
  const folder = saved.state!.hubs[0]!.projects.find(project => project.name === 'Notes')!;
  const task = await f.app.createTask({ projectId: folder.id, title, description: '' });
  const root = path.join(f.root, 'plain-checkout');
  await (await import('node:fs/promises')).mkdir(root, { recursive: true });
  await f.store.transact(draft => {
    const current = draft.tasks.find(value => value.id === task.id)!;
    current.worktree = { path: root, branch: 'feature', owned: true, status: 'ready' };
  });
  await f.app.createConversation(task.id);
  await f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: root });
  await f.app.worktrees.settle();
  return { taskId: task.id, root };
}

describe('retained checkout dismissal', () => {
  it('removes a dismissed path from the next snapshot and leaves the directory untouched', async () => {
    const f = await setup();
    const { root } = await retainCheckout(f, 'Dismissed checkout');
    expect((await f.app.snapshot()).retainedCheckouts).toEqual([{ path: root, projectId: f.project.id, taskTitle: 'Dismissed checkout', reason: 'unresolved' }]);
    const dismissed = await f.app.command({ type: 'retainedCheckout.dismiss', paths: [root] });
    expect(dismissed.retainedCheckouts).toBeUndefined();
    expect((await f.app.snapshot()).retainedCheckouts).toBeUndefined();
    expect(f.git.removed).toEqual([]);
  });

  it('keeps the other retained paths when only one is dismissed', async () => {
    const f = await setup();
    const first = await retainCheckout(f, 'First kept checkout');
    const second = await retainCheckout(f, 'Second kept checkout');
    const dismissed = await f.app.command({ type: 'retainedCheckout.dismiss', paths: [first.root] });
    expect(dismissed.retainedCheckouts?.map(value => value.path)).toEqual([second.root]);
  });

  it('ignores an unknown path without reporting an error', async () => {
    const f = await setup();
    const { root } = await retainCheckout(f, 'Known checkout');
    const result = await f.app.command({ type: 'retainedCheckout.dismiss', paths: ['/worktrees/never-recorded'] });
    expect(result.retainedCheckouts?.map(value => value.path)).toEqual([root]);
    await expect(f.app.command({ type: 'retainedCheckout.dismiss', paths: [root, '/worktrees/never-recorded'] })).resolves.toBeDefined();
    expect((await f.app.snapshot()).retainedCheckouts).toBeUndefined();
  });

  it('records a folder project plain checkout with its own reason', async () => {
    const f = await setup();
    const { root } = await retainFolderCheckout(f, 'Plain checkout');
    expect(f.store.snapshot().tasks.some(task => task.title === 'Plain checkout')).toBe(false);
    expect(f.git.removed).toEqual([]);
    expect((await f.app.snapshot()).retainedCheckouts).toEqual([{ path: root, projectId: expect.any(String), taskTitle: 'Plain checkout', reason: 'folder' }]);
  });

  it('reports the persisted reason when a recorded folder deletion resumes after a restart', async () => {
    const f = await setup();
    const { taskId, root, projectId } = await recordedResumableFolderDeletion(f, 'Resumed plain checkout', 'folder');
    await f.app.worktrees.resumePending();
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === taskId)).toBe(false);
    expect((await f.app.snapshot()).retainedCheckouts).toEqual([{ path: root, projectId, taskTitle: 'Resumed plain checkout', reason: 'folder' }]);
  });

  it('falls back to an unresolved reason for a record that predates the persisted reason', async () => {
    const f = await setup();
    const { taskId, root, projectId } = await recordedResumableFolderDeletion(f, 'Legacy plain checkout');
    await f.app.worktrees.retry(taskId);
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks.some(value => value.id === taskId)).toBe(false);
    expect((await f.app.snapshot()).retainedCheckouts).toEqual([{ path: root, projectId, taskTitle: 'Legacy plain checkout', reason: 'unresolved' }]);
  });

  it('records the reason the checkout was kept', async () => {
    const f = await setup();
    const { root } = await retainCheckout(f, 'Reason checkout');
    expect((await f.app.snapshot()).retainedCheckouts?.[0]).toMatchObject({ path: root, reason: 'unresolved' });
  });
});

/**
 * Record a plain-checkout deletion that kept the checkout and then stopped while
 * archiving. Its request carries no expected worktree path, which is the shape that
 * can still resume after the first attempt released the binding.
 */
async function recordedResumableFolderDeletion(f: F, title: string, reason?: 'folder'): Promise<{ taskId: string; root: string; projectId: string }> {
  const saved = await f.app.command({ type: 'project.save', project: { name: 'Notes', projectPath: f.projectPath } });
  const folder = saved.state!.hubs[0]!.projects.find(project => project.name === 'Notes')!;
  const task = await f.app.createTask({ projectId: folder.id, title, description: '' });
  const root = path.join(f.root, 'plain-checkout-' + title.replace(/\s+/g, '-'));
  await (await import('node:fs/promises')).mkdir(root, { recursive: true });
  await f.app.createConversation(task.id);
  await f.store.transact(draft => {
    const current = draft.tasks.find(value => value.id === task.id)!;
    current.worktree = null;
    current.operation = {
      id: 'resume-' + task.id,
      request: { kind: 'delete', discardChanges: false },
      phase: 'archiving',
      targetPath: root,
      retainedCheckoutPath: root,
      ...(reason === undefined ? {} : { retainedCheckoutReason: reason }),
      previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [],
      gitCompleted: true, createdAt: '2026-01-01T00:00:00.000Z',
    };
  });
  return { taskId: task.id, root, projectId: folder.id };
}

describe('retained checkout pruning', () => {
  it('removes a retained checkout whose directory is gone without a user action', async () => {
    const missing = new Set<string>();
    const f = await setupWith({ retainedCheckoutExists: async value => !missing.has(value), retainedCheckoutPruneIntervalMs: 5 });
    const kept = await retainCheckout(f, 'Kept checkout');
    const gone = await retainCheckout(f, 'Gone checkout');
    missing.add(gone.root);
    await vi.waitFor(async () => {
      expect((await f.app.snapshot()).retainedCheckouts?.map(value => value.path)).toEqual([kept.root]);
    }, { timeout: 2_000 });
  });

  it('prunes on its own interval while the board is idle', async () => {
    const missing = new Set<string>();
    let checks = 0;
    const f = await setupWith({
      retainedCheckoutExists: async value => { checks += 1; return !missing.has(value); },
      retainedCheckoutPruneIntervalMs: 10,
    });
    const { root } = await retainCheckout(f, 'Idle checkout');
    await f.app.whenSettled();
    const baseline = checks;
    missing.add(root);
    // No snapshot is requested in this window, so only the periodic check can run.
    await vi.waitFor(() => expect(checks).toBeGreaterThan(baseline), { timeout: 2_000 });
    expect((await f.app.snapshot()).retainedCheckouts).toBeUndefined();
  });

  it('keeps a path recorded while the existence check is running', async () => {
    let release = (): void => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let blocked: string | undefined;
    const f = await setupWith({
      retainedCheckoutExists: async value => {
        if (value === blocked) { await gate; return false; }
        return true;
      },
      retainedCheckoutPruneIntervalMs: 5,
    });
    const first = await retainCheckout(f, 'Checked checkout');
    blocked = first.root;
    // Wait past the interval so the next check starts and blocks on the first path.
    await new Promise(resolve => setTimeout(resolve, 25));
    const second = await retainCheckout(f, 'Recorded during the check');
    release();
    await f.app.whenSettled();
    await vi.waitFor(async () => {
      expect((await f.app.snapshot()).retainedCheckouts?.map(value => value.path)).toEqual([second.root]);
    }, { timeout: 2_000 });
  });

  it('keeps an unreadable path instead of pruning it', async () => {
    const f = await setupWith({
      retainedCheckoutExists: async () => { throw Object.assign(new Error('Permission denied.'), { code: 'EACCES' }); },
      retainedCheckoutPruneIntervalMs: 5,
    });
    const kept = await retainCheckout(f, 'Unreadable checkout');
    await new Promise(resolve => setTimeout(resolve, 25));
    expect((await f.app.snapshot()).retainedCheckouts?.map(value => value.path)).toEqual([kept.root]);
  });
});

describe('retained checkout dismiss wire command', () => {
  it('accepts a paths payload and rejects an empty, duplicate, or unscoped shape', () => {
    const command = { type: 'retainedCheckout.dismiss' as const, paths: ['/trees/x'] };
    expect(CommandSchema.parse(command)).toEqual(command);
    expect(() => CommandSchema.parse({ type: 'retainedCheckout.dismiss', paths: [] })).toThrow();
    expect(() => CommandSchema.parse({ type: 'retainedCheckout.dismiss', paths: ['/trees/x', '/trees/x'] })).toThrow();
    expect(() => CommandSchema.parse({ ...command, hubId: 'hub-1' })).toThrow();
  });
});