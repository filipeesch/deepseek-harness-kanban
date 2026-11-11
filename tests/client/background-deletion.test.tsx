// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { deferred, fakeApi, fixture } from './helpers.js';

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

  it('closes the bulk confirmation and leaves selection mode before admission settles', async () => {
    const { user, command } = mount();
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha task' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta task' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete selected tasks' });
    const gate = deferred<ReturnType<typeof fixture>>();
    command.mockImplementation(() => gate.promise);
    await user.click(within(dialog).getByRole('button', { name: 'Delete selected' }));
    expect(screen.queryByRole('dialog', { name: 'Delete selected tasks' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Deletion results' })).toBeNull();
    // Selection mode is left immediately, while both admissions are still in flight.
    expect(screen.queryByText('2 selected')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select cards to delete' })).toBeTruthy();
    expect(command).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null });
    expect(command).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta' });
    await act(async () => { gate.resolve(fixture()); });
    expect(screen.queryByRole('dialog', { name: 'Deletion results' })).toBeNull();
  });

  it('reports a bulk admission rejection on the board without a result dialog', async () => {
    const { user, command } = mount();
    await screen.findByRole('button', { name: 'Open task Beta task' });
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha task' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta task' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    command.mockImplementation((input) => input.type === 'task.delete' && input.taskId === 't2'
      ? Promise.reject({ code: 'TASK_BUSY', message: 'Wait for Beta.' })
      : Promise.resolve(queuedSnapshot()));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete selected tasks' })).getByRole('button', { name: 'Delete selected' }));
    expect(await screen.findByText(/Could not start deletion for Beta task: Wait for Beta\./)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Deletion results' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open task Beta task' })).toBeTruthy();
  });

  it('names the queued preflight on the board notice and the card', async () => {
    const checking = fixture();
    checking.sequence += 1;
    checking.state.tasks[0]!.operation = operation({ phase: 'preflight' });
    mount(checking);
    const notice = await screen.findByRole('region', { name: 'Destructive operations' });
    expect(within(notice).getByText(/— Checking…$/)).toBeTruthy();
    expect(screen.getByText('Checking before deleting…')).toBeTruthy();
    expect(screen.queryByText(/preflight/)).toBeNull();
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

  it('presents a retained checkout only from the host projection and dismisses it on the host', async () => {
    const { user, command, publish, get } = mount(plainCheckoutFixture());
    await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    command.mockResolvedValueOnce(queuedPlainDeletion(plainCheckoutFixture()));
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete task' })).toBeNull());
    // The client no longer infers retention from its own successful deletion.
    expect(screen.queryByText(/was left on disk/)).toBeNull();
    const completed = queuedPlainDeletion(plainCheckoutFixture());
    completed.sequence = get().sequence + 1;
    completed.state.tasks = completed.state.tasks.filter(task => task.id !== 't1');
    completed.retainedCheckouts = [{ path: '/plain', projectId: 'p1', taskTitle: 'Alpha task', reason: 'folder' }];
    act(() => { publish(completed); });
    expect(await screen.findByText(/was left on disk/)).toBeTruthy();
    expect(screen.getByText(/not Git-managed/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss the retained checkout at /plain' }));
    await waitFor(() => expect(command).toHaveBeenLastCalledWith({ type: 'retainedCheckout.dismiss', paths: ['/plain'] }));
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
