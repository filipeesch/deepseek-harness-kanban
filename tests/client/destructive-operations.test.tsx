// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDestructiveOperations } from '../../src/client/destructive-operations.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

function queued(value = fixture()): KanbanSnapshot {
  value.sequence += 1;
  value.state.tasks[0]!.operation = {
    id: 'op', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: null }, phase: 'queued',
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-10-21T12:00:00Z',
  };
  return value;
}

function sharedFailure(value = fixture()): KanbanSnapshot {
  value.sequence += 1;
  value.state.tasks[0]!.operation = {
    id: 'op', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: null }, phase: 'failed', targetPath: '/tree',
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: '2026-10-21T12:00:00Z',
    error: { code: 'SHARED_WORKTREE', message: 'shared', details: { path: '/tree', blockers: [{ kind: 'session', sessionId: 's1', path: '/tree' }] } },
  };
  return value;
}

describe('destructive operation controller', () => {
  it('closes after acceptance into the background queue', async () => {
    const value = fixture(); const task = value.state.hubs[0]!.tasks[0]!;
    const run = vi.fn(async () => queued());
    const { result } = renderHook(() => useDestructiveOperations({ run, tasks: () => value.state.hubs[0]!.tasks }));
    act(() => result.current.open(task, value.state.hubs[0]!.projects[0], 'task.delete'));
    expect(result.current.state.view?.kind).toBe('confirm');
    await act(async () => { result.current.confirm(); });
    await waitFor(() => expect(result.current.state.view).toBeNull());
    expect(result.current.state.pending).toBe(false);
  });

  it('keeps the confirmation on a pre-admission failure', async () => {
    const value = fixture(); const task = value.state.hubs[0]!.tasks[0]!;
    const run = vi.fn(async () => { throw { code: 'TASK_BUSY', message: 'Wait for idle.' }; });
    const { result } = renderHook(() => useDestructiveOperations({ run, tasks: () => value.state.hubs[0]!.tasks }));
    act(() => result.current.open(task, value.state.hubs[0]!.projects[0], 'task.delete'));
    await act(async () => { result.current.confirm(); });
    await waitFor(() => expect(result.current.state.error).toMatchObject({ code: 'TASK_BUSY' }));
    expect(result.current.state.view?.kind).toBe('confirm');
  });

  it('opens and confirms force with the recorded blockers', async () => {
    const value = sharedFailure(); const task = value.state.hubs[0]!.tasks[0]!;
    const run = vi.fn(async () => queued());
    const { result } = renderHook(() => useDestructiveOperations({ run, tasks: () => value.state.hubs[0]!.tasks }));
    act(() => result.current.openForce(task.id));
    expect(result.current.state.view).toMatchObject({ kind: 'force', blockers: [{ kind: 'session', sessionId: 's1' }] });
    await act(async () => { result.current.confirmForce(); });
    await waitFor(() => expect(result.current.state.view).toBeNull());
    expect(run).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null, force: true }, false);
  });

  it('closes after a successful return clears the operation', async () => {
    const value = sharedFailure(); const task = value.state.hubs[0]!.tasks[0]!;
    const run = vi.fn(async () => fixture());
    const { result } = renderHook(() => useDestructiveOperations({ run, tasks: () => value.state.hubs[0]!.tasks }));
    act(() => result.current.open(task, value.state.hubs[0]!.projects[0], 'task.delete'));
    await act(async () => { result.current.returnToBase(); });
    await waitFor(() => expect(result.current.state.view).toBeNull());
  });
});
