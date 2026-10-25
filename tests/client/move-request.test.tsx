// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KanbanSnapshot, BoardState, Command } from '../../src/shared/types.js';
import { useMoveRequest } from '../../src/client/useMoveRequest.js';
import { fixture } from './helpers.js';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function restrictedState(): BoardState {
  const state = fixture().state;
  state.workflow.columns.push({ id: 'blocked', name: 'Blocked' });
  return state;
}

function column(state: BoardState, id: string) {
  return state.workflow.columns.find(value => value.id === id)!;
}

function anchoredState(): BoardState {
  const state = restrictedState();
  state.tasks[1]!.columnId = 'blocked';
  return state;
}

function busyState(): BoardState {
  const state = restrictedState();
  state.tasks[0]!.operation = { id: 'operation', request: { kind: 'return' }, phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-10-21T10:00:00Z' };
  return state;
}

function setup(initial = restrictedState()) {
  const run = vi.fn(async (_command: Command): Promise<KanbanSnapshot> => fixture());
  const onImmediateError = vi.fn();
  const hook = renderHook(({ state }: { state: BoardState }) => useMoveRequest({ state, run, onImmediateError }), { initialProps: { state: initial } });
  return { ...hook, run, onImmediateError };
}

describe('useMoveRequest', () => {
  it('moves an allowed transition immediately and omits the override flag', async () => {
    const { result, run } = setup();
    const state = restrictedState();
    let moved = false;
    await act(async () => { moved = await result.current.move(state.tasks[0]!, column(state, 'doing')); });
    expect(moved).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'doing', mode: 'move' });
    expect(result.current.confirmation).toBeNull();
    expect(result.current.optimistic).toBeNull();
  });

  it('moves a same-stage reorder immediately', async () => {
    const { result, run } = setup();
    const state = restrictedState();
    let moved = false;
    await act(async () => { moved = await result.current.move(state.tasks[0]!, column(state, 'intake'), null); });
    expect(moved).toBe(true);
    expect(run).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'intake', mode: 'move' });
  });

  it('opens a confirmation for a restricted move without running a command', async () => {
    const { result, run } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    expect(result.current.confirmation).toMatchObject({ taskId: 't1', taskTitle: 'Alpha task', fromColumnId: 'intake', toColumnId: 'blocked', fromName: 'Intake', toName: 'Blocked', workflowName: 'Delivery' });
    expect(result.current.optimistic).toBeNull();
    expect(run).not.toHaveBeenCalled();
    act(() => { result.current.cancel(); });
    await expect(pending).resolves.toBe(false);
    expect(result.current.confirmation).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('confirms a restricted move with the override flag and resolves the move promise', async () => {
    const { result, run } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    await act(async () => { await result.current.confirm(); });
    await expect(pending).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'blocked', mode: 'move', overrideTransition: true });
    expect(result.current.confirmation).toBeNull();
    expect(result.current.optimistic).toBeNull();
  });

  it('keeps the dialog open after a host rejection and retries with fresh state', async () => {
    const { result, run } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    run.mockRejectedValueOnce({ code: 'TASK_BUSY', message: 'The task is busy.' });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.error).toMatchObject({ code: 'TASK_BUSY', message: 'The task is busy.' });
    expect(result.current.canRetry).toBe(true);
    expect(result.current.confirmation).not.toBeNull();
    await act(async () => { await result.current.confirm(); });
    await expect(pending).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.current.confirmation).toBeNull();
  });

  it('rejects a stale source without running a command and offers only cancellation', async () => {
    const { result, run, rerender } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    const changed = restrictedState();
    changed.tasks[0]!.columnId = 'doing';
    rerender({ state: changed });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.error).toMatchObject({ code: 'MOVE_CONTEXT_CHANGED' });
    expect(result.current.canRetry).toBe(false);
    expect(run).not.toHaveBeenCalled();
    act(() => { result.current.cancel(); });
    await expect(pending).resolves.toBe(false);
  });

  it('rejects a missing destination without running a command', async () => {
    const { result, run, rerender } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    const changed = restrictedState();
    changed.workflow.columns = changed.workflow.columns.filter(value => value.id !== 'blocked');
    rerender({ state: changed });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.error).toMatchObject({ code: 'MOVE_CONTEXT_CHANGED' });
    expect(result.current.canRetry).toBe(false);
    expect(run).not.toHaveBeenCalled();
    act(() => { result.current.cancel(); });
    await expect(pending).resolves.toBe(false);
  });

  it('accepts a transition that became allowed while the confirmation was open', async () => {
    const { result, run, rerender } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    const allowed = restrictedState();
    allowed.workflow.columns[0]!.allowedTransitions = ['doing', 'review', 'blocked'];
    rerender({ state: allowed });
    await act(async () => { await result.current.confirm(); });
    await expect(pending).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'blocked', mode: 'move' });
  });

  it('reports a busy task immediately instead of opening a confirmation', async () => {
    const { result, run, onImmediateError } = setup(busyState());
    const state = busyState();
    let moved = true;
    await act(async () => { moved = await result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    expect(moved).toBe(false);
    expect(result.current.confirmation).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(onImmediateError).toHaveBeenCalledWith({ code: 'OPERATION_PENDING', message: expect.any(String) });
  });

  it('resolves an outstanding confirmation as not moved when the hook unmounts', async () => {
    const { result, run, unmount } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    unmount();
    await expect(pending).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('remains usable across a StrictMode effect replay', async () => {
    const run = vi.fn(async (_command: Command): Promise<KanbanSnapshot> => fixture());
    const onImmediateError = vi.fn();
    const state = restrictedState();
    const { result } = renderHook(() => useMoveRequest({ state, run, onImmediateError }), { wrapper: React.StrictMode });
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    act(() => { result.current.cancel(); });
    await expect(pending).resolves.toBe(false);
  });

  it('does not offer a retry when a host rejection finds a stale source', async () => {
    const { result, run, rerender } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    let rejectRun!: (error: unknown) => void;
    run.mockImplementationOnce(() => new Promise<KanbanSnapshot>((_resolve, reject) => { rejectRun = reject; }));
    let confirming!: Promise<void>;
    act(() => { confirming = result.current.confirm(); });
    await waitFor(() => expect(run).toHaveBeenCalled());
    const changed = restrictedState();
    changed.tasks[0]!.columnId = 'doing';
    rerender({ state: changed });
    await act(async () => { rejectRun({ code: 'REVISION_CONFLICT', message: 'Task moved during transition.' }); await confirming; });
    expect(result.current.error).toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(result.current.canRetry).toBe(false);
    act(() => { result.current.cancel(); });
    await expect(pending).resolves.toBe(false);
  });

  it('forwards the restricted drop anchor when the move is confirmed', async () => {
    const state = anchoredState();
    const { result, run } = setup(state);
    const anchor = state.tasks[1]!;
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked'), anchor.id); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    await act(async () => { await result.current.confirm(); });
    await expect(pending).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'blocked', mode: 'move', beforeTaskId: anchor.id, overrideTransition: true });
  });

  it('does not offer a retry when the confirmed drop anchor moved', async () => {
    const initial = anchoredState();
    const { result, run, rerender } = setup(initial);
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(initial.tasks[0]!, column(initial, 'blocked'), initial.tasks[1]!.id); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    const changed = anchoredState();
    changed.tasks[1]!.columnId = 'doing';
    rerender({ state: changed });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.error).toMatchObject({ code: 'MOVE_CONTEXT_CHANGED' });
    expect(result.current.canRetry).toBe(false);
    expect(run).not.toHaveBeenCalled();
    act(() => { result.current.cancel(); });
    await expect(pending).resolves.toBe(false);
  });

  it('guards a double confirm to one command and one settle', async () => {
    const { result, run } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    await act(async () => { await Promise.all([result.current.confirm(), result.current.confirm()]); });
    await expect(pending).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('clears optimistic placement after a deferred command and reports immediate failure', async () => {
    const { result, run, onImmediateError } = setup();
    const state = restrictedState();
    const gate = deferred<void>();
    run.mockImplementationOnce(async () => { await gate.promise; return fixture(); });
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'doing')); });
    expect(result.current.optimistic).toEqual({ taskId: 't1', columnId: 'doing', beforeTaskId: null });
    await act(async () => { gate.resolve(); await pending; });
    expect(result.current.optimistic).toBeNull();
    expect(onImmediateError).not.toHaveBeenCalled();

    run.mockRejectedValueOnce({ code: 'MOVE_FAILED', message: 'The move failed.' });
    let moved = true;
    await act(async () => { moved = await result.current.move(state.tasks[0]!, column(state, 'review')); });
    expect(moved).toBe(false);
    expect(result.current.optimistic).toBeNull();
    expect(onImmediateError).toHaveBeenCalledWith({ code: 'MOVE_FAILED', message: 'The move failed.' });
  });

  it('only emits task.move commands and never an agent instruction', async () => {
    const { result, run } = setup();
    const state = restrictedState();
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.move(state.tasks[0]!, column(state, 'blocked')); });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    await act(async () => { await result.current.confirm(); });
    await pending;
    expect(run.mock.calls.every(([command]) => command.type === 'task.move')).toBe(true);
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'task.runInstruction' }));
  });
});
