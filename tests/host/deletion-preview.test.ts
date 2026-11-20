import { describe, expect, it } from 'vitest';
import { previewDeletion } from '../../src/host/deletion-preview.js';
import { resolveDeletionTarget } from '../../src/host/deletion-target.js';
import type { GitPort } from '../../src/shared/ports.js';
import type { GitProject, HubState, HubTask, Project } from '../../src/shared/types.js';

/** One stored card, filled in enough for the preview to read it. */
function card(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task-1', boardId: 'board', projectId: 'project', title: 'A card', description: '',
    columnId: 'todo', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repos/app',
    worktree: null, operation: null, createdAt: '2026-11-20T09:00:00.000Z', updatedAt: '2026-11-20T09:00:00.000Z',
    ...overrides,
  };
}

/** One Hub holding the given cards, their notes, and their relations. */
function hubWith(tasks: readonly HubTask[], input: { notes?: number; relations?: Array<{ from: string; to: string }> } = {}): HubState {
  const notes = Array.from({ length: input.notes ?? 0 }, (_value, index) => ({
    id: 'note-' + index, taskId: tasks[0]!.id, content: 'note', tags: [],
    createdAt: '2026-11-20T09:00:00.000Z', updatedAt: '2026-11-20T09:00:00.000Z',
  }));
  const relations = (input.relations ?? []).map((relation, index) => ({ id: 'relation-' + index, type: 'epic' as const, ...relation }));
  return {
    id: 'hub', name: 'Hub', revision: 1, projects: [], boards: [], tasks: [...tasks], notes, relations,
    createdAt: '2026-11-20T09:00:00.000Z', updatedAt: '2026-11-20T09:00:00.000Z',
  };
}

const gitProject: GitProject = { id: 'project', projectKey: 'app', name: 'App', projectPath: '/repos/app', gitRootPath: '/repos/app' };
const folderProject: Project = { id: 'project', projectKey: 'app', name: 'App', projectPath: '/repos/app' };

/** A Git port that answers the local-change read, or fails it. */
function gitPort(answer: boolean | Error): Pick<GitPort, 'localChanges'> {
  return {
    localChanges: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe('the deletion preview', () => {
  it('counts conversations, notes, and relations for a card without a worktree', async () => {
    const task = card({ sessionIds: ['s1', 's2', 's3'], closedSessionIds: ['s3'] });
    const other = card({ id: 'task-2' });
    const hub = hubWith([task, other], { notes: 2, relations: [{ from: task.id, to: other.id }] });
    const preview = await previewDeletion({
      hub, task, project: gitProject,
      resolveTarget: async () => ({ checkout: 'none' }),
      git: gitPort(false),
    });
    expect(preview.conversations).toEqual({ total: 3, closed: 1 });
    expect(preview.notes).toBe(2);
    expect(preview.relations).toBe(1);
    expect(preview.checkout).toBeUndefined();
    expect(preview.unclaimedCheckouts).toEqual([]);
  });

  it('reports a removable checkout with its branch and local changes', async () => {
    const task = card({ worktree: { path: '/trees/app', branch: 'task/a', owned: true, status: 'ready' } });
    const hub = hubWith([task]);
    const preview = await previewDeletion({
      hub, task, project: gitProject,
      resolveTarget: async () => ({ checkout: 'remove', directoryTarget: '/repos/app' }),
      git: gitPort(true),
    });
    expect(preview.checkout).toEqual({
      path: '/trees/app', branch: 'task/a', owned: true, branchKept: true, plainFolder: false, disposition: 'remove', localChanges: 'changes',
    });
  });

  it('reports a plain folder checkout as retained without reading local changes', async () => {
    const task = card({ worktree: { path: '/trees/app', branch: 'task/a', owned: false, status: 'ready' } });
    const hub = hubWith([task]);
    const preview = await previewDeletion({
      hub, task, project: folderProject,
      resolveTarget: async () => ({ checkout: 'retain', retainedPath: '/trees/app', retainReason: 'folder' }),
      git: gitPort(new Error('Git should not be read')),
    });
    expect(preview.checkout).toMatchObject({ plainFolder: true, owned: false, localChanges: 'not-applicable' });
  });

  it('reports local changes as unavailable when the read fails', async () => {
    const task = card({ worktree: { path: '/trees/app', branch: 'task/a', owned: true, status: 'ready' } });
    const hub = hubWith([task]);
    const preview = await previewDeletion({
      hub, task, project: gitProject,
      resolveTarget: async () => ({ checkout: 'remove', directoryTarget: '/repos/app' }),
      git: gitPort(new Error('Git is unavailable')),
    });
    expect(preview.checkout?.localChanges).toBe('unavailable');
  });

  it('reports a detached checkout as having no branch to keep', async () => {
    const task = card({ worktree: { path: '/trees/app', branch: 'HEAD', owned: true, status: 'ready' } });
    const hub = hubWith([task]);
    const preview = await previewDeletion({
      hub, task, project: gitProject,
      resolveTarget: async () => ({ checkout: 'remove', directoryTarget: '/repos/app' }),
      git: gitPort(false),
    });
    expect(preview.checkout?.branchKept).toBe(false);
  });

  it('lists the unclaimed checkouts the deletion leaves on disk', async () => {
    const task = card({
      unclaimedWorktrees: [{ path: '/trees/orphan', branch: 'task/orphan', error: { code: 'UNCLAIMED', message: 'Left behind.' } }],
    });
    const hub = hubWith([task]);
    const preview = await previewDeletion({
      hub, task, project: gitProject,
      resolveTarget: async () => ({ checkout: 'none' }),
      git: gitPort(false),
    });
    expect(preview.unclaimedCheckouts).toEqual([{ path: '/trees/orphan', branch: 'task/orphan' }]);
  });

  it('changes nothing in the Hub or on the card', async () => {
    const task = card({ worktree: { path: '/trees/app', branch: 'task/a', owned: true, status: 'ready' } });
    const hub = hubWith([task], { notes: 1 });
    const before = JSON.stringify(hub);
    await previewDeletion({
      hub, task, project: gitProject,
      resolveTarget: async () => resolveDeletionTarget({ task, project: gitProject, git: { projectDirectory: async () => '/repos/app' } }),
      git: gitPort(false),
    });
    expect(JSON.stringify(hub)).toBe(before);
    expect(task.operation).toBeNull();
  });

  it('reports an unresolvable checkout as unavailable instead of failing the call', async () => {
    const task = card({ worktree: { path: '/trees/app', branch: 'task/a', owned: true, status: 'ready' } });
    const hub = hubWith([task]);
    const preview = await previewDeletion({
      hub, task, project: gitProject,
      resolveTarget: async () => { throw new Error('INVALID_DIRECTORY'); },
      git: gitPort(false),
    });
    expect(preview.checkout).toMatchObject({ disposition: 'unavailable', localChanges: 'unavailable' });
  });
});
