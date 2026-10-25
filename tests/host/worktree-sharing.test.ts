import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorktreeSharingGuard } from '../../src/host/worktree-sharing.js';
import type { SessionTopologyPort } from '../../src/shared/ports.js';
import type { BoardState, Task } from '../../src/shared/types.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task', projectId: 'p', title: 'Task', description: '', columnId: 'c', position: 0,
    sessionIds: ['a'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function state(tasks: Task[], root: string): BoardState {
  return {
    schemaVersion: 2, revision: 1, workflowYaml: '', workflow: { name: 'C', initialColumnId: 'c', columns: [{ id: 'c', name: 'C' }], groups: [] },
    projects: [{ id: 'p', name: 'P', projectPath: root, gitRootPath: root }], tasks, notes: [],
  };
}

function store(tasks: Task[], root: string) {
  const value = state(tasks, root);
  return {
    locate: (taskId: string) => { const found = value.tasks.find(item => item.id === taskId); if (!found) throw new Error('Missing task'); return { task: found }; },
    allTasks: () => value.tasks,
  };
}

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-kanban-sharing-')));
  roots.push(root);
  await mkdir(path.join(root, 'sub'));
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-kanban-sharing-outside-')));
  roots.push(outside);
  return { root, outside };
}

describe('WorktreeSharingGuard', () => {
  it('ignores a task-owned direct subagent child', async () => {
    const f = await fixture();
    const sessions: SessionTopologyPort = { topology: vi.fn(async () => ({ related: [{ sessionId: 'a', directory: f.root }, { sessionId: 'child', directory: path.join(f.root, 'sub') }], lineage: [{ sessionId: 'child', parentSessionId: 'a', origin: 'subagent' as const }] })) };
    const guard = new WorktreeSharingGuard(store([task()], f.root), sessions);
    await expect(guard.assertExclusive('task', f.root)).resolves.toBeUndefined();
  });

  it('rejects a foreign native session', async () => {
    const f = await fixture();
    const sessions: SessionTopologyPort = { topology: vi.fn(async () => ({ related: [{ sessionId: 'outside', directory: path.join(f.root, 'sub') }], lineage: [] })) };
    const guard = new WorktreeSharingGuard(store([task()], f.root), sessions);
    await expect(guard.assertExclusive('task', f.root)).rejects.toMatchObject({ code: 'SHARED_WORKTREE', details: { sessionId: 'outside' } });
  });

  it('rejects a checkout associated with another task', async () => {
    const f = await fixture();
    const other = task({ id: 'other', title: 'Other task', worktree: { path: f.root, branch: 'other', owned: true, status: 'ready' } });
    const sessions: SessionTopologyPort = { topology: vi.fn(async () => ({ related: [], lineage: [] })) };
    const guard = new WorktreeSharingGuard(store([task(), other], f.root), sessions);
    await expect(guard.assertExclusive('task', f.root)).rejects.toMatchObject({ code: 'SHARED_WORKTREE', details: { taskId: 'other', taskTitle: 'Other task' } });
  });

  it('rejects a fork that has a parent link but no subagent origin', async () => {
    const f = await fixture();
    const sessions: SessionTopologyPort = { topology: vi.fn(async () => ({ related: [{ sessionId: 'fork', directory: path.join(f.root, 'sub') }], lineage: [{ sessionId: 'fork', parentSessionId: 'a' }] })) };
    const guard = new WorktreeSharingGuard(store([task()], f.root), sessions);
    await expect(guard.assertExclusive('task', f.root)).rejects.toMatchObject({ code: 'SHARED_WORKTREE', details: { sessionId: 'fork' } });
  });

  it('fails closed when a subagent parent is unknown', async () => {
    const f = await fixture();
    const sessions: SessionTopologyPort = { topology: vi.fn(async () => ({ related: [{ sessionId: 'child', directory: path.join(f.root, 'sub') }], lineage: [{ sessionId: 'child', parentSessionId: 'missing', origin: 'subagent' as const }] })) };
    const guard = new WorktreeSharingGuard(store([task()], f.root), sessions);
    await expect(guard.assertExclusive('task', f.root)).rejects.toMatchObject({ code: 'SHARED_WORKTREE', details: { sessionId: 'child' } });
  });

  it('does not read topology when the target is already absent', async () => {
    const f = await fixture();
    const topology = vi.fn(async () => ({ related: [], lineage: [] }));
    const guard = new WorktreeSharingGuard(store([task()], f.root), { topology });
    await expect(guard.assertExclusive('task', path.join(f.root, 'missing'))).resolves.toBeUndefined();
    expect(topology).not.toHaveBeenCalled();
  });

  it('ignores a related session whose current directory left the checkout', async () => {
    const f = await fixture();
    const sessions: SessionTopologyPort = { topology: vi.fn(async () => ({ related: [{ sessionId: 'moved', directory: f.outside }], lineage: [] })) };
    const guard = new WorktreeSharingGuard(store([task()], f.root), sessions);
    await expect(guard.assertExclusive('task', f.root)).resolves.toBeUndefined();
  });

  it('fails closed when topology cannot be read', async () => {
    const f = await fixture();
    const sessions: SessionTopologyPort = { topology: vi.fn(async () => { throw new Error('topology unavailable'); }) };
    const guard = new WorktreeSharingGuard(store([task()], f.root), sessions);
    await expect(guard.assertExclusive('task', f.root)).rejects.toThrow('topology unavailable');
  });
});
