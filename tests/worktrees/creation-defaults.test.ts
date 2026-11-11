import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { GitAdapter } from '../../src/host/git.js';
import { WorktreeCoordinator } from '../../src/host/worktrees.js';
import type { WorktreeDefaults } from '../../src/shared/types.js';
import { board, cleanup, fixture, LocalExecutor, MemoryStore, Sessions } from './helpers.js';

afterEach(cleanup);

async function setup(answer: (root: string, taskId: string) => Promise<WorktreeDefaults> | WorktreeDefaults) {
  const f = await fixture();
  const store = new MemoryStore(board(f.project));
  const sessions = new Sessions(f.project.projectPath);
  const requested: string[] = [];
  const coordinator = new WorktreeCoordinator(store, sessions, new GitAdapter(new LocalExecutor()), {
    worktreeDefaults: {
      derive: async taskId => { requested.push(taskId); return answer(f.root, taskId); },
    },
  });
  return { ...f, store, sessions, coordinator, requested };
}

describe('worktree creation derives the defaults it omits', () => {
  it('derives the branch and destination and binds the created checkout', async () => {
    const derivedPath = { value: '' };
    const f = await setup((root) => { derivedPath.value = path.join(root, 'trees', 'derived-branch'); return { kind: 'derived', branchName: 'derived-branch', path: derivedPath.value, sourceBranch: 'main' }; });
    await f.coordinator.request('task', { kind: 'create', mode: 'new' });
    const task = f.store.snapshot().tasks[0]!;
    expect(f.requested).toEqual(['task']);
    expect(task.worktree?.branch).toBe('derived-branch');
    expect(task.worktree?.path).toBe(derivedPath.value);
    expect(task.worktree?.status).toBe('ready');
  });

  it('asks for the defaults again on a later creation instead of reusing an earlier answer', async () => {
    let index = 0;
    const f = await setup(root => { index += 1; return { kind: 'derived', branchName: 'derived-' + index, path: path.join(root, 'trees', 'derived-' + index) }; });
    await f.coordinator.request('task', { kind: 'create', mode: 'new' });
    await f.coordinator.request('task', { kind: 'remove', discardChanges: false });
    await f.coordinator.request('task', { kind: 'create', mode: 'new' });
    expect(f.requested).toEqual(['task', 'task']);
    expect(f.store.snapshot().tasks[0]!.worktree?.branch).toBe('derived-2');
  });

  it('never consults the derivation when the request supplies both values', async () => {
    const f = await setup(root => ({ kind: 'derived', branchName: 'derived-branch', path: path.join(root, 'trees', 'derived-branch') }));
    await f.coordinator.request('task', { kind: 'create', mode: 'new', path: f.tree, branchName: 'supplied' });
    expect(f.requested).toEqual([]);
    expect(f.store.snapshot().tasks[0]!.worktree).toMatchObject({ branch: 'supplied', path: f.tree });
  });

  it('reports an unavailable derivation without touching Git', async () => {
    const f = await setup(() => ({ kind: 'unavailable', reason: { code: 'WORKTREE_NAME_UNAVAILABLE', message: 'No name.' } }));
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'new' })).rejects.toMatchObject({ code: 'WORKTREE_NAME_UNAVAILABLE' });
    expect(f.store.snapshot().tasks[0]!.operation).toBeNull();
    expect(f.store.snapshot().tasks[0]!.worktree).toBeNull();
  });

  it('refuses an existing-branch creation that omits the branch or destination', async () => {
    const f = await setup(() => ({ kind: 'derived', branchName: 'derived-branch', path: path.join('/tmp', 'unused') }));
    await expect(f.coordinator.request('task', { kind: 'create', mode: 'existing' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.requested).toEqual([]);
  });
});
