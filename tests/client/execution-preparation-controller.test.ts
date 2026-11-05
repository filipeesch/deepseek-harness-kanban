import { describe, expect, it, vi } from 'vitest';
import { ExecutionPreparationController, type PreparationPorts } from '../../src/client/execution-preparation/controller.js';
import type { PreparationRequest } from '../../src/client/execution-preparation/contract.js';
import type { CreateWorktree, Project, Task } from '../../src/shared/types.js';

const now = '2026-10-21T12:00:00Z';
const gitProject: Project = { id: 'p1', name: 'API', projectPath: '/repo/apps/api', gitRootPath: '/repo', defaultBranch: 'main' };
const folderProject: Project = { id: 'p1', name: 'Folder', projectPath: '/repo/apps/api' };
const column = { id: 'review', name: 'Review', onEnterPrompt: 'Review carefully.' };

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1', projectId: 'p1', title: 'Alpha task', description: '', columnId: 'intake', position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/apps/api',
    worktree: null, operation: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function request(overrides: Partial<PreparationRequest> = {}): PreparationRequest {
  return { kind: 'move', task: task(), column, project: gitProject, ...overrides };
}

interface FakePorts extends PreparationPorts {
  calls: string[];
  defaults: ReturnType<typeof vi.fn>;
  createWorktree: ReturnType<typeof vi.fn>;
  dismissWorktree: ReturnType<typeof vi.fn>;
  createConversation: ReturnType<typeof vi.fn>;
  retainSession: ReturnType<typeof vi.fn>;
  releaseSession: ReturnType<typeof vi.fn>;
}

function ports(overrides: Partial<PreparationPorts> = {}): FakePorts {
  const calls: string[] = [];
  const fakeDefs = {
    calls,
    defaults: vi.fn(async () => { calls.push('defaults'); return { branchName: 'alpha-task', path: '/trees/alpha-task' }; }),
    createWorktree: vi.fn(async (_taskId: string, _draft: CreateWorktree) => { calls.push('createWorktree'); }),
    dismissWorktree: vi.fn(async () => { calls.push('dismissWorktree'); }),
    createConversation: vi.fn(async () => { calls.push('createConversation'); return 'session-new'; }),
    retainSession: vi.fn(async () => { calls.push('retainSession'); }),
    releaseSession: vi.fn((sessionId: string) => { calls.push('release:' + sessionId); }),
    seatAvailable: () => false,
  };
  return Object.assign(fakeDefs, overrides);
}

function controllerWith(fake: FakePorts): ExecutionPreparationController {
  const controller = new ExecutionPreparationController();
  controller.configure(fake);
  return controller;
}

async function atPhase(controller: ExecutionPreparationController, phase: string): Promise<void> {
  await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe(phase));
}

describe('ExecutionPreparationController', () => {
  it('proceeds without a dialog when the task already has a conversation', async () => {
    const fake = ports();
    const controller = controllerWith(fake);
    await expect(controller.open(request({ task: task({ sessionIds: ['session-1'] }) }))).resolves.toBe(true);
    expect(controller.getSnapshot().phase).toBe('closed');
    expect(fake.calls).toEqual([]);
  });

  it('proceeds without a dialog when nothing applies', async () => {
    const fake = ports();
    const controller = controllerWith(fake);
    await expect(controller.open(request({ project: folderProject, task: task({ worktree: { path: '/trees/a', branch: 'a', owned: true, status: 'ready' } }) }))).resolves.toBe(true);
    expect(fake.calls).toEqual([]);
  });

  it('asks for the worktree and provisions from the derived defaults', async () => {
    const fake = ports();
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await vi.waitFor(() => expect(controller.getSnapshot().draft).not.toBeNull());
    expect(controller.getSnapshot().destinationMissing).toBe(false);
    controller.answerWorktree(true);
    await expect(pending).resolves.toBe(true);
    expect(fake.createWorktree).toHaveBeenCalledWith('t1', { mode: 'new', branchName: 'alpha-task', path: '/trees/alpha-task', sourceBranch: 'main' });
    expect(fake.createConversation).toHaveBeenCalledWith('t1');
    expect(controller.getSnapshot().phase).toBe('closed');
  });

  it('records the base-project choice instead of creating a worktree', async () => {
    const fake = ports();
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await vi.waitFor(() => expect(controller.getSnapshot().draft).not.toBeNull());
    controller.answerWorktree(false);
    await expect(pending).resolves.toBe(true);
    expect(fake.dismissWorktree).toHaveBeenCalledWith('t1');
    expect(fake.createWorktree).not.toHaveBeenCalled();
    expect(fake.createConversation).toHaveBeenCalledWith('t1');
  });

  it('disables creating a worktree when no destination can be derived', async () => {
    const fake = ports({ defaults: vi.fn(async () => ({ branchName: 'alpha-task', path: '' })) });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await vi.waitFor(() => expect(controller.getSnapshot().destinationMissing).toBe(true));
    controller.answerWorktree(true);
    expect(fake.createWorktree).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('worktree');
    controller.answerWorktree(false);
    await expect(pending).resolves.toBe(true);
  });

  it('reports a defaults failure and retries it without closing the question', async () => {
    const defaults = vi.fn()
      .mockRejectedValueOnce(new Error('Defaults failed.'))
      .mockResolvedValueOnce({ branchName: 'alpha-task', path: '/trees/alpha-task' });
    const fake = ports({ defaults });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await vi.waitFor(() => expect(controller.getSnapshot().failedStep).toBe('defaults'));
    expect(controller.getSnapshot().phase).toBe('worktree');
    expect(controller.getSnapshot().error?.message).toBe('Defaults failed.');
    controller.retry();
    await vi.waitFor(() => expect(controller.getSnapshot().draft).not.toBeNull());
    controller.answerWorktree(false);
    await expect(pending).resolves.toBe(true);
  });

  it('keeps a failed worktree creation in the dialog and retries it', async () => {
    const createWorktree = vi.fn()
      .mockRejectedValueOnce({ code: 'WORKTREE_TARGET_EXISTS', message: 'The destination already exists.' })
      .mockResolvedValueOnce(undefined);
    const fake = ports({ createWorktree });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await vi.waitFor(() => expect(controller.getSnapshot().draft).not.toBeNull());
    controller.answerWorktree(true);
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe('error'));
    expect(controller.getSnapshot().failedStep).toBe('worktree');
    expect(controller.getSnapshot().error?.code).toBe('WORKTREE_TARGET_EXISTS');
    controller.retry();
    await expect(pending).resolves.toBe(true);
    expect(createWorktree).toHaveBeenCalledTimes(2);
    expect(fake.createConversation).toHaveBeenCalledTimes(1);
  });

  it('retries only the conversation after a failed conversation creation', async () => {
    const createConversation = vi.fn()
      .mockRejectedValueOnce({ code: 'CREATION_FAILED', message: 'The conversation could not be created.' })
      .mockResolvedValueOnce('session-new');
    const fake = ports({ createConversation });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await vi.waitFor(() => expect(controller.getSnapshot().draft).not.toBeNull());
    controller.answerWorktree(true);
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe('error'));
    expect(controller.getSnapshot().failedStep).toBe('conversation');
    controller.retry();
    await expect(pending).resolves.toBe(true);
    expect(fake.createWorktree).toHaveBeenCalledTimes(1);
    expect(createConversation).toHaveBeenCalledTimes(2);
  });

  it('presents the native model stage and releases the session when the move proceeds', async () => {
    const fake = ports({ seatAvailable: () => true });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await vi.waitFor(() => expect(controller.getSnapshot().draft).not.toBeNull());
    controller.answerWorktree(false);
    await atPhase(controller, 'model');
    expect(controller.getSnapshot().sessionId).toBe('session-new');
    expect(fake.retainSession).toHaveBeenCalledWith('session-new');
    controller.confirmModel();
    await expect(pending).resolves.toBe(true);
    expect(fake.releaseSession).toHaveBeenCalledWith('session-new');
    expect(controller.getSnapshot().phase).toBe('closed');
  });

  it('releases the session and resolves cancel from the model stage', async () => {
    const fake = ports({ seatAvailable: () => true });
    const controller = controllerWith(fake);
    const pending = controller.open(request({ task: task({ worktreeDismissed: true }) }));
    await atPhase(controller, 'model');
    controller.cancel();
    await expect(pending).resolves.toBe(false);
    expect(fake.releaseSession).toHaveBeenCalledWith('session-new');
  });

  it('proceeds without the model stage when the native seat cannot be retained', async () => {
    const retainSession = vi.fn().mockRejectedValue(new Error('No scope.'));
    const fake = ports({ seatAvailable: () => true, retainSession });
    const controller = controllerWith(fake);
    const pending = controller.open(request({ task: task({ worktreeDismissed: true }) }));
    await expect(pending).resolves.toBe(true);
    expect(retainSession).toHaveBeenCalledWith('session-new');
    expect(controller.getSnapshot().phase).toBe('closed');
  });

  it('blocks a task whose worktree binding is not ready and provisions nothing', async () => {
    const fake = ports();
    const controller = controllerWith(fake);
    const pending = controller.open(request({ task: task({ worktree: { path: '/trees/a', branch: 'a', owned: true, status: 'error' } }) }));
    await atPhase(controller, 'blocked');
    expect(controller.getSnapshot().worktree).toBe('blocked');
    controller.cancel();
    await expect(pending).resolves.toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('accepts the base-project choice while the worktree defaults are still loading', async () => {
    let releaseDefaults: ((value: { branchName: string; path: string }) => void) | undefined;
    const defaults = vi.fn(() => new Promise<{ branchName: string; path: string }>(resolve => { releaseDefaults = resolve; }));
    const fake = ports({ defaults });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    expect(controller.getSnapshot().pending).toBe(true);
    controller.answerWorktree(false);
    await expect(pending).resolves.toBe(true);
    expect(fake.dismissWorktree).toHaveBeenCalledWith('t1');
    expect(fake.createConversation).toHaveBeenCalledTimes(1);
    releaseDefaults?.({ branchName: 'late', path: '/trees/late' });
    await Promise.resolve();
    expect(controller.getSnapshot().phase).toBe('closed');
    expect(controller.getSnapshot().draft).toBeNull();
  });

  it('ignores a late defaults response after the dialog is cancelled', async () => {
    let releaseDefaults: ((value: { branchName: string; path: string }) => void) | undefined;
    const defaults = vi.fn(() => new Promise<{ branchName: string; path: string }>(resolve => { releaseDefaults = resolve; }));
    const fake = ports({ defaults });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    controller.cancel();
    await expect(pending).resolves.toBe(false);
    releaseDefaults?.({ branchName: 'late', path: '/trees/late' });
    await Promise.resolve();
    expect(controller.getSnapshot().phase).toBe('closed');
    expect(controller.getSnapshot().draft).toBeNull();
  });

  it('refuses a second preparation while one is open', async () => {
    const fake = ports();
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await expect(controller.open(request())).resolves.toBe(false);
    controller.cancel();
    await pending;
  });

  it('ignores worktree answers received outside the question stage', async () => {
    let releaseCreate: (() => void) | undefined;
    const createWorktree = vi.fn(() => new Promise<void>(resolve => { releaseCreate = resolve; }));
    const fake = ports({ createWorktree });
    const controller = controllerWith(fake);
    const pending = controller.open(request());
    await atPhase(controller, 'worktree');
    await vi.waitFor(() => expect(controller.getSnapshot().draft).not.toBeNull());
    controller.answerWorktree(true);
    await atPhase(controller, 'provisioning');
    controller.answerWorktree(false);
    releaseCreate?.();
    await expect(pending).resolves.toBe(true);
    expect(fake.dismissWorktree).not.toHaveBeenCalled();
    expect(fake.createConversation).toHaveBeenCalledTimes(1);
  });
});
