// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1', request: { kind: 'delete' as const, discardChanges: false, expectedWorktreePath: null },
    phase: 'queued' as const, previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [],
    gitCompleted: false, createdAt: '2026-10-21T12:00:00Z', ...overrides,
  };
}

function queuedSnapshot(): ReturnType<typeof fixture> {
  const value = fixture(); value.sequence += 1;
  value.state.tasks[0]!.operation = operation();
  return value;
}

function failedSharedSnapshot(): ReturnType<typeof fixture> {
  const value = fixture();
  value.state.tasks[0]!.operation = operation({
    phase: 'failed',
    targetPath: '/trees/shared',
    error: { code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { path: '/trees/shared', blockers: [{ kind: 'task', taskId: 't2', title: 'Beta task', path: '/trees/shared' }] } },
  });
  return value;
}


function plainCheckoutFixture(): ReturnType<typeof fixture> {
  const value = fixture();
  value.state.hubs[0]!.projects[0]!.gitRootPath = undefined;
  const task = value.state.tasks[0]!;
  task.worktree = { path: '/plain', branch: 'plain', owned: true, status: 'ready' };
  task.effectiveCwd = '/plain';
  return value;
}

function queuedPlainDeletion(value: ReturnType<typeof fixture>, phase: 'queued' | 'failed' = 'queued'): ReturnType<typeof fixture> {
  value.sequence += 1;
  value.state.tasks[0]!.operation = operation({ phase, request: { kind: 'delete', discardChanges: false, expectedWorktreePath: '/plain' }, targetPath: '/plain', ...(phase === 'failed' ? { error: { code: 'ARCHIVE_FAILED', message: 'Archive failed.' } } : {}) });
  return value;
}

function mount(data = fixture()) {
  const mock = fakeApi(data);
  render(<BoardView api={mock.api} renderConversation={id => <div>Native {id}</div>} />);
  return { ...mock, user: userEvent.setup() };
}

describe('background destructive UX', () => {
  it('closes the confirmation on acceptance and leaves a queued card', async () => {
    const { user, command } = mount();
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    command.mockResolvedValueOnce(queuedSnapshot());
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete task' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Open task Alpha task' })).toBeTruthy();
    expect(screen.getByText('Queued to delete')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Destructive operations' })).toBeTruthy();
  });

  it('offers the force consent after a shared-worktree failure', async () => {
    const { user, command } = mount(failedSharedSnapshot());
    await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByRole('button', { name: 'Force remove checkout…' }));
    const dialog = screen.getByRole('dialog', { name: 'Force remove shared checkout?' });
    expect(within(dialog).getAllByText(/Beta task/).length).toBeGreaterThan(0);
    const confirm = within(dialog).getByRole('button', { name: 'Force remove checkout' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(within(dialog).getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(command).toHaveBeenLastCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null, force: true }));
  });

  it('shows failed destructive work in the board notice with recovery', async () => {
    const { user } = mount(failedSharedSnapshot());
    const notice = await screen.findByRole('region', { name: 'Destructive operations' });
    expect(within(notice).getByText('Task deletion needs attention: Alpha task')).toBeTruthy();
    expect(within(notice).getByRole('button', { name: 'Force remove checkout… — Alpha task' })).toBeTruthy();
    await user.click(within(notice).getByRole('button', { name: 'Force remove checkout… — Alpha task' }));
    expect(screen.getByRole('dialog', { name: 'Force remove shared checkout?' })).toBeTruthy();
  });

  it('reports bulk accepted tasks as queued and keeps skipped tasks selected', async () => {
    const { user, command } = mount();
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha task' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta task' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete selected tasks' });
    command.mockResolvedValueOnce(queuedSnapshot());
    command.mockRejectedValueOnce({ code: 'TASK_BUSY', message: 'Wait for Beta.' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete selected' }));
    const result = await screen.findByRole('dialog', { name: 'Deletion results' });
    expect(within(result).getByText('1 task queued for deletion.')).toBeTruthy();
    expect(within(result).getByText(/Wait for Beta/)).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('preserves force through the discard consent', async () => {
    const { user, command } = mount(failedSharedSnapshot());
    await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByRole('button', { name: 'Force remove checkout…' }));
    const force = screen.getByRole('dialog', { name: 'Force remove shared checkout?' });
    command.mockRejectedValueOnce({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.' });
    await user.click(within(force).getByRole('checkbox'));
    await user.click(within(force).getByRole('button', { name: 'Force remove checkout' }));
    const discard = await screen.findByRole('dialog', { name: 'Discard local worktree changes?' });
    await user.click(within(discard).getByRole('checkbox'));
    await user.click(within(discard).getByRole('button', { name: 'Discard changes and continue' }));
    await waitFor(() => expect(command).toHaveBeenLastCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null, force: true, discardChanges: true }));
  });

  it('explains a checkout removed externally on the other task binding', async () => {
    const value = fixture();
    value.state.tasks[1]!.worktree = { path: '/trees/beta', branch: 'beta', owned: true, status: 'error', error: { code: 'WORKTREE_REMOVED', message: "This checkout was removed by another task's forced deletion." } };
    const { user, command } = mount(value);
    await user.click(await screen.findByRole('button', { name: 'Open task Beta task' }));
    await user.click(screen.getByRole('tab', { name: 'Git' }));
    expect(await screen.findByText(/removed by another task/)).toBeTruthy();
    expect(screen.getByText('Checkout removed externally')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear removed checkout' }));
    await user.click(screen.getByRole('button', { name: 'Confirm worktree removal' }));
    await waitFor(() => expect(command).toHaveBeenLastCalledWith({ type: 'worktree.remove', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta' }));
  });

  it('reports a retained plain checkout only after the task is gone', async () => {
    const { user, command, publish } = mount(plainCheckoutFixture());
    await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    command.mockResolvedValueOnce(queuedPlainDeletion(plainCheckoutFixture()));
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete task' })).toBeNull());
    expect(screen.queryByText(/was left on disk/)).toBeNull();
    const completed = queuedPlainDeletion(plainCheckoutFixture());
    completed.state.tasks = completed.state.tasks.filter(task => task.id !== 't1');
    act(() => { publish(completed); });
    expect(await screen.findByText(/was left on disk/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/was left on disk/)).toBeNull();
  });

  it('never reports a retained checkout for a failed deletion', async () => {
    const { user, command, publish } = mount(plainCheckoutFixture());
    await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    command.mockResolvedValueOnce(queuedPlainDeletion(plainCheckoutFixture()));
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete task' })).toBeNull());
    const failed = queuedPlainDeletion(plainCheckoutFixture(), 'failed');
    act(() => { publish(failed); });
    expect(screen.queryByText(/was left on disk/)).toBeNull();
  });
});
