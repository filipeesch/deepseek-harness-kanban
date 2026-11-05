// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Command, KanbanSnapshot } from '../../src/shared/types.js';
import { useBatchDeletion } from '../../src/client/useBatchDeletion.js';
import { deferred, fixture } from './helpers.js';

function tasks() { return fixture().state.tasks; }

function snapshot(): KanbanSnapshot { return fixture(); }

describe('useBatchDeletion', () => {
  it('dispatches every selected deletion before the first admission settles', async () => {
    const gate = deferred<KanbanSnapshot>();
    const run = vi.fn(() => gate.promise);
    const onRejected = vi.fn();
    const { result } = renderHook(() => useBatchDeletion({ run, onRejected }));
    act(() => { result.current.confirm(tasks()); });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null }, false);
    expect(run).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta' }, false);
    expect(result.current.pending).toBe(true);
    await act(async () => { gate.resolve(snapshot()); });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('reports only the admission rejections and keeps no result payload', async () => {
    const run = vi.fn((command: Command) => command.type === 'task.delete' && command.taskId === 't2'
      ? Promise.reject({ code: 'TASK_BUSY', message: 'Wait for Beta.' })
      : Promise.resolve(snapshot()));
    const onRejected = vi.fn();
    const { result } = renderHook(() => useBatchDeletion({ run, onRejected }));
    act(() => { result.current.confirm(tasks()); });
    await waitFor(() => expect(onRejected).toHaveBeenCalledTimes(1));
    expect(onRejected).toHaveBeenCalledWith([{ title: 'Beta task', problem: { code: 'TASK_BUSY', message: 'Wait for Beta.' } }]);
    expect(result.current.pending).toBe(false);
    expect(Object.keys(result.current).sort()).toEqual(['confirm', 'pending']);
  });

  it('ignores a repeated confirmation while a fan-out is in flight', async () => {
    const gate = deferred<KanbanSnapshot>();
    const run = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useBatchDeletion({ run, onRejected: vi.fn() }));
    act(() => { result.current.confirm(tasks()); });
    act(() => { result.current.confirm(tasks()); });
    expect(run).toHaveBeenCalledTimes(2);
    await act(async () => { gate.resolve(snapshot()); });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });
});
