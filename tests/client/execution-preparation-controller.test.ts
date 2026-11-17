import { describe, expect, it, vi } from 'vitest';
import { ExecutionPreparationController } from '../../src/client/execution-preparation/controller.js';
import { NO_PREPARATION, type PreparationRequest } from '../../src/client/execution-preparation/contract.js';
import type { Column, Project, Task } from '../../src/shared/types.js';

const gitProject: Project = { id: 'p', projectKey: 'p', name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo' };
const review: Column = { id: 'review', name: 'Review', onEnterPrompt: 'Review carefully.' };

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', projectId: 'p', title: 'Alpha task', description: '', columnId: 'intake', position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/apps/web', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function request(overrides: Partial<PreparationRequest> = {}): PreparationRequest {
  return { kind: 'move', task: task(), column: review, project: gitProject, ...overrides };
}

describe('ExecutionPreparationController', () => {
  it('needs no preparation when no worktree decision applies', async () => {
    const controller = new ExecutionPreparationController();
    const decision = await controller.open(request({ task: task({ worktreeDismissed: true }) }));
    expect(decision).toEqual(NO_PREPARATION);
    expect(controller.getSnapshot().phase).toBe('closed');
  });

  it('asks the worktree question and answers it', async () => {
    const controller = new ExecutionPreparationController();
    const listener = vi.fn();
    controller.subscribe(listener);
    const pending = controller.open(request());
    expect(controller.getSnapshot()).toEqual({ phase: 'worktree', kind: 'move', taskId: 't1', taskTitle: 'Alpha task', stageName: 'Review' });
    controller.answerWorktree(true);
    await expect(pending).resolves.toEqual({ proceed: true, worktree: 'create' });
    expect(controller.getSnapshot().phase).toBe('closed');
    expect(listener).toHaveBeenCalled();
  });

  it('records the base-project answer without provisioning anything', async () => {
    const controller = new ExecutionPreparationController();
    const pending = controller.open(request({ kind: 'run' }));
    controller.answerWorktree(false);
    await expect(pending).resolves.toEqual({ proceed: true, worktree: 'base' });
  });

  it('cancels a question without a decision', async () => {
    const controller = new ExecutionPreparationController();
    const pending = controller.open(request());
    controller.cancel();
    await expect(pending).resolves.toEqual({ proceed: false, worktree: 'none' });
    expect(controller.getSnapshot().phase).toBe('closed');
  });

  it('explains a binding that is not ready and refuses the execution', async () => {
    const controller = new ExecutionPreparationController();
    const pending = controller.open(request({ task: task({ worktree: { path: '/trees/a', branch: 'a', owned: true, status: 'preparing' } }) }));
    expect(controller.getSnapshot().phase).toBe('blocked');
    controller.cancel();
    await expect(pending).resolves.toEqual({ proceed: false, worktree: 'none' });
  });

  it('creates the derived default without asking under Always create', async () => {
    const controller = new ExecutionPreparationController();
    const decision = await controller.open(request({ project: { ...gitProject, worktreePolicy: 'always' } }));
    expect(decision).toEqual({ proceed: true, worktree: 'create' });
    expect(controller.getSnapshot().phase).toBe('closed');
  });

  it('refuses a second preparation while one is open', async () => {
    const controller = new ExecutionPreparationController();
    const first = controller.open(request());
    await expect(controller.open(request())).resolves.toEqual({ proceed: false, worktree: 'none' });
    controller.cancel();
    await first;
  });
});
