import { describe, expect, it } from 'vitest';
import { resolveDeletionTarget } from '../../src/host/deletion-target.js';
import { KanbanError } from '../../src/shared/errors.js';
import type { GitPort } from '../../src/shared/ports.js';
import type { Project, Task } from '../../src/shared/types.js';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/apps/web', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

const gitProject: Project = { id: 'project', projectKey: 'project', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const folderProject: Project = { id: 'project', projectKey: 'project', name: 'Notes', projectPath: '/plain/notes' };
const binding = { path: '/trees/task', branch: 'task', owned: true, status: 'ready' as const };
const unavailable = new KanbanError('PATH_UNAVAILABLE', 'The directory cannot be resolved.', { path: '/repo/apps/web' });

function git(answer: string | Error): { port: Pick<GitPort, 'projectDirectory'>; calls: () => number } {
  const state = { calls: 0 };
  return {
    port: {
      async projectDirectory(): Promise<string> {
        state.calls += 1;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
    calls: () => state.calls,
  };
}

describe('deletion target resolution', () => {
  it('needs no base resolution for a task without a worktree', async () => {
    const fake = git('/repo/apps/web');
    await expect(resolveDeletionTarget({ task: task(), project: gitProject, git: fake.port })).resolves.toEqual({ checkout: 'none' });
    expect(fake.calls()).toBe(0);
  });

  it('lets a folder project keep its plain checkout through the existing path', async () => {
    const fake = git('/plain/notes');
    await expect(resolveDeletionTarget({ task: task({ worktree: binding }), project: folderProject, git: fake.port })).resolves.toEqual({ checkout: 'none' });
    expect(fake.calls()).toBe(0);
  });

  it('removes a checkout whose base project directory resolves', async () => {
    const fake = git('/repo/apps/web');
    await expect(resolveDeletionTarget({ task: task({ worktree: binding }), project: gitProject, git: fake.port })).resolves.toEqual({ directoryTarget: '/repo/apps/web', checkout: 'remove' });
  });

  it('retains a checkout when the project directory is unavailable', async () => {
    const fake = git(unavailable);
    await expect(resolveDeletionTarget({ task: task({ worktree: binding }), project: gitProject, git: fake.port })).resolves.toEqual({ checkout: 'retain', retainedPath: '/trees/task' });
  });

  it('propagates an unexpected Git failure instead of retaining silently', async () => {
    const fake = git(new KanbanError('PROJECT_OUTSIDE_GIT_ROOT', 'Outside.', {}));
    await expect(resolveDeletionTarget({ task: task({ worktree: binding }), project: gitProject, git: fake.port })).rejects.toMatchObject({ code: 'PROJECT_OUTSIDE_GIT_ROOT' });
  });
});
