import { useCallback, useRef, useState } from 'react';
import type { Command, KanbanSnapshot, Problem, Project, Task } from '../shared/types.js';
import type { DestructiveRequest } from './destructive-dialogs.js';
import { canForceSharedRemoval, sharedWorktreeBlockers, type SharedWorktreeBlocker } from '../shared/worktree-blockers.js';
import { asProblem } from './ui.js';
import { isGitProject } from '../shared/project.js';

export type DestructiveView =
  | { kind: 'confirm'; request: DestructiveRequest }
  | { kind: 'force'; request: DestructiveRequest; blockers: SharedWorktreeBlocker[] }
  | { kind: 'discard'; request: DestructiveRequest };

export interface DestructiveState {
  view: DestructiveView | null;
  pending: boolean;
  error: Problem | null;
}

export interface DestructiveOptions {
  run: (command: Command, allowDiscard?: boolean) => Promise<KanbanSnapshot>;
  tasks: () => readonly Task[];
  retained?: (path: string) => void;
  closed?: (taskId: string) => void;
}

export function destructiveRequestFor(task: Task, project: Project | undefined, type: 'task.delete' | 'worktree.remove'): DestructiveRequest {
  return {
    command: { type, taskId: task.id, confirmed: true, expectedWorktreePath: task.worktree?.path ?? null },
    taskId: task.id, title: task.title, path: task.worktree?.path ?? null,
    expectedWorktreePath: task.worktree?.path ?? null,
    branch: task.worktree?.branch ?? null, owned: task.worktree?.owned,
    ...(project !== undefined && !isGitProject(project) && task.worktree !== null ? { plainCheckout: true } : {}),
  };
}

/** Build the request that repeats a recorded failed destructive operation. */
export function destructiveRequestFromOperation(task: Task): DestructiveRequest | null {
  const operation = task.operation;
  if (!operation || (operation.request.kind !== 'delete' && operation.request.kind !== 'remove')) return null;
  const request = operation.request;
  const expected = request.expectedWorktreePath !== undefined ? request.expectedWorktreePath : operation.targetPath ?? task.worktree?.path ?? null;
  return {
    command: {
      type: operation.request.kind === 'delete' ? 'task.delete' : 'worktree.remove',
      taskId: task.id, confirmed: true, expectedWorktreePath: expected,
      ...(request.discardChanges ? { discardChanges: true } : {}),
      ...(request.force === true ? { force: true } : {}),
    },
    taskId: task.id, title: task.title, path: expected,
    expectedWorktreePath: expected,
    branch: task.worktree?.branch ?? null, owned: task.worktree?.owned,
    ...(operation.error ? { error: operation.error } : {}),
  };
}

function acceptedTask(result: KanbanSnapshot, taskId: string, command: Command): { accepted: boolean; task: Task | undefined } {
  const task = result.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === taskId);
  // A recovery command can resolve the operation entirely instead of leaving it queued.
  const recovery = command.type === 'operation.retry' || command.type === 'operation.return';
  return { accepted: !task || Boolean(task.operation) || recovery, task };
}

/**
 * Owns the destructive confirmation state machine. Acceptance is decided from
 * the command result: the host records the operation and returns before the
 * cleanup, so the dialog closes without waiting for the lifecycle.
 */
export function useDestructiveOperations(options: DestructiveOptions) {
  const [state, setState] = useState<DestructiveState>({ view: null, pending: false, error: null });
  const optionsRef = useRef(options); optionsRef.current = options;
  const pendingRef = useRef(false);
  const pendingRetained = useRef(new Map<string, string>());

  const close = useCallback(() => {
    if (pendingRef.current) return;
    setState({ view: null, pending: false, error: null });
  }, []);

  const settle = useCallback((result: KanbanSnapshot, request: DestructiveRequest, command: Command) => {
    const outcome = acceptedTask(result, request.taskId, command);
    if (outcome.accepted) {
      if (request.plainCheckout && request.path) {
        if (outcome.task) pendingRetained.current.set(request.taskId, request.path);
        else optionsRef.current.retained?.(request.path);
      }
      if (request.command.type === 'task.delete') optionsRef.current.closed?.(request.taskId);
      setState({ view: null, pending: false, error: null });
      return;
    }
    setState(previous => ({ ...previous, pending: false }));
  }, []);

  const execute = useCallback(async (request: DestructiveRequest, command: Command, discardAllowed = false) => {
    if (pendingRef.current) return;
    const forced = (command.type === 'task.delete' || command.type === 'worktree.remove') && command.force === true;
    if (!forced && (command.type === 'task.delete' || command.type === 'worktree.remove')) {
      const task = optionsRef.current.tasks().find(value => value.id === request.taskId);
      const currentPath = task?.worktree?.path ?? null;
      if (!task || currentPath !== request.expectedWorktreePath) {
        setState(previous => ({ ...previous, error: { code: 'CONTEXT_CHANGED', message: 'The task worktree changed while confirmation was open. Cancel and review the current target before trying again.' } }));
        return;
      }
    }
    pendingRef.current = true;
    setState(previous => ({ ...previous, pending: true, error: null }));
    try {
      const result = await optionsRef.current.run(command, discardAllowed);
      settle(result, request, command);
    } catch (error) {
      const problem = asProblem(error);
      if (!discardAllowed && problem.code === 'DISCARD_REQUIRED') {
        const next = { ...request, error: problem };
        setState(previous => ({ ...previous, pending: false, error: null, view: { kind: 'discard', request: next } }));
      } else {
        setState(previous => ({ ...previous, pending: false, error: problem }));
      }
    } finally {
      pendingRef.current = false;
    }
  }, [settle]);

  const confirm = useCallback(() => {
    const view = state.view;
    if (view?.kind !== 'confirm') return;
    void execute(view.request, view.request.command);
  }, [state.view, execute]);

  const retry = useCallback(() => {
    const view = state.view;
    if (!view) return;
    void execute({ ...view.request, command: { ...view.request.command } }, { type: 'operation.retry', taskId: view.request.taskId });
  }, [state.view, execute]);

  const returnToBase = useCallback(() => {
    const view = state.view;
    if (!view) return;
    void execute(view.request, { type: 'operation.return', taskId: view.request.taskId });
  }, [state.view, execute]);

  /** Report a retained plain checkout only after the task actually disappears; drop it on failure. */
  const reconcile = useCallback((tasks: readonly Task[]) => {
    for (const [taskId, path] of [...pendingRetained.current]) {
      const task = tasks.find(value => value.id === taskId);
      if (!task) { pendingRetained.current.delete(taskId); optionsRef.current.retained?.(path); continue; }
      if (!task.operation || task.operation.phase === 'failed') pendingRetained.current.delete(taskId);
    }
  }, []);

  const openForce = useCallback((taskId: string) => {
    const task = optionsRef.current.tasks().find(value => value.id === taskId);
    const request = task ? destructiveRequestFromOperation(task) : null;
    if (!task || !request || task.operation?.phase !== 'failed' || !canForceSharedRemoval(task.operation.error)) return;
    setState({ view: { kind: 'force', request: { ...request, command: { ...request.command, force: true } }, blockers: sharedWorktreeBlockers(task.operation.error) }, pending: false, error: null });
  }, []);

  const confirmForce = useCallback(() => {
    const view = state.view;
    if (view?.kind !== 'force') return;
    void execute(view.request, view.request.command);
  }, [state.view, execute]);

  const retryTask = useCallback(async (taskId: string) => {
    try { await optionsRef.current.run({ type: 'operation.retry', taskId }, false); }
    catch { /* the recorded operation keeps the failure */ }
  }, []);

  const openDiscard = useCallback((request: DestructiveRequest) => {
    setState({ view: { kind: 'discard', request }, pending: false, error: null });
  }, []);

  const open = useCallback((task: Task, project: Project | undefined, type: 'task.delete' | 'worktree.remove') => {
    setState({ view: { kind: 'confirm', request: destructiveRequestFor(task, project, type) }, pending: false, error: null });
  }, []);

  return {
    state,
    close,
    open,
    openDiscard,
    confirm,
    retry,
    returnToBase,
    openForce,
    confirmForce,
    reconcile,
    retryTask,
    setError: (error: Problem | null) => setState(previous => ({ ...previous, error })),
  };
}
