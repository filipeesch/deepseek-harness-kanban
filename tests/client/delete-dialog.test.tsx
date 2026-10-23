// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DeleteTaskDialog, type DestructiveRequest } from '../../src/client/destructive-dialogs.js';
import { EMPTY_ATTENTION } from '../../src/shared/types.js';
import { task } from './helpers.js';

afterEach(cleanup);

const project = { id: 'p1', name: 'API', projectPath: '/repo/apps/api', gitRootPath: '/repo' };
const base = task('t1', 'Alpha task', 'p1', 'intake');
const withWorktree = {
  ...base,
  effectiveCwd: '/trees/alpha/apps/api',
  worktree: { path: '/trees/alpha', branch: 'alpha', owned: true, status: 'ready' as const },
  unclaimedWorktrees: [{ path: '/manual/checkout', branch: 'manual', error: { code: 'DETACHED', message: 'Detached.' } }],
};
const request: DestructiveRequest = {
  command: { type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: '/trees/alpha' },
  taskId: 't1', title: 'Alpha task', path: '/trees/alpha', expectedWorktreePath: '/trees/alpha', branch: 'alpha', owned: true,
};

function mount(overrides: Partial<React.ComponentProps<typeof DeleteTaskDialog>> = {}) {
  const onCancel = vi.fn(); const onConfirm = vi.fn(); const onRetry = vi.fn(); const onReturn = vi.fn();
  const view = render(<DeleteTaskDialog request={request} task={withWorktree} project={project} attention={EMPTY_ATTENTION} pending={false} problem={null} onCancel={onCancel} onConfirm={onConfirm} onRetry={onRetry} onReturn={onReturn} {...overrides} />);
  return { ...view, onCancel, onConfirm, onRetry, onReturn };
}

describe('DeleteTaskDialog', () => {
  it('shows scannable consequences and focuses Cancel', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(within(dialog).getByText(/2 conversations/)).toBeTruthy();
    expect(within(dialog).getByText('/trees/alpha')).toBeTruthy();
    expect(within(dialog).getByText(/created by Kanban/)).toBeTruthy();
    expect(within(dialog).getByRole('note', { name: 'Unclaimed checkout deletion warning' })).toBeTruthy();
    expect(within(dialog).getByText('/manual/checkout')).toBeTruthy();
    expect(within(dialog).getByText(/branch is kept/i)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('identifies an attached checkout and a running conversation', () => {
    mount({ request: { ...request, owned: false }, attention: { running: true, unread: false, awaitingReply: false, failed: false } });
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(within(dialog).getByText(/attached externally/)).toBeTruthy();
    expect(within(dialog).getByText(/A conversation is running/)).toBeTruthy();
  });

  it('omits worktree consequences for a task without a worktree', () => {
    mount({ request: { ...request, path: null, expectedWorktreePath: null, branch: null }, task: base });
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(within(dialog).getByText(/project folder is not removed/i)).toBeTruthy();
    expect(within(dialog).queryByText(/will be removed/)).toBeNull();
  });

  it('keeps a failure inline with details and recovery', () => {
    const failedTask = { ...withWorktree, operation: { id: 'op', request: { kind: 'delete' as const, discardChanges: false, expectedWorktreePath: '/trees/alpha' }, phase: 'failed' as const, targetPath: '/trees/alpha', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now', error: { code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { sessionId: 'child', path: '/trees/alpha' } } } };
    mount({ task: failedTask, problem: failedTask.operation.error });
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(within(dialog).getByText('Another DSH conversation is using this checkout.')).toBeTruthy();
    expect(within(dialog).getByText('Details')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Retry deletion' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Return chats to project' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).toBeNull();
  });

  it('keeps an accepted operation in the confirmation surface and hides the destructive action', () => {
    const operation = { id: 'op', request: { kind: 'delete' as const, discardChanges: false, expectedWorktreePath: '/trees/alpha' }, phase: 'waiting' as const, targetPath: '/trees/alpha', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now' };
    mount({ task: { ...withWorktree, operation } });
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Retry deletion' })).toBeTruthy();
    expect(within(dialog).getByText(/Waiting for every conversation/)).toBeTruthy();
  });

  it('hides Return once archiving has started and disables actions while busy', () => {
    const failedTask = { ...withWorktree, operation: { id: 'op', request: { kind: 'delete' as const, discardChanges: false, expectedWorktreePath: '/trees/alpha' }, phase: 'failed' as const, targetPath: '/trees/alpha', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: ['s1'], gitCompleted: true, createdAt: 'now' } };
    mount({ task: failedTask, pending: true });
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(within(dialog).queryByRole('button', { name: 'Return chats to project' })).toBeNull();
    expect((within(dialog).getByRole('button', { name: 'Working…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'Close Delete task' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not claim a branch is preserved for a detached checkout', () => {
    mount({ request: { ...request, branch: 'HEAD' } });
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(within(dialog).getByText(/no branch to preserve/i)).toBeTruthy();
    expect(within(dialog).queryByText(/branch is kept/i)).toBeNull();
  });

  it('calls the destructive and cancel actions', async () => {
    const { onCancel, onConfirm } = mount();
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    (within(dialog).getByRole('button', { name: 'Delete task' }) as HTMLButtonElement).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
