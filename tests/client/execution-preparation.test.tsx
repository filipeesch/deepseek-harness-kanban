// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture, restrictedInstructedFixture, type TestSnapshot } from './helpers.js';

afterEach(cleanup);

function mount(data: TestSnapshot = fixture()) {
  const mock = fakeApi(data);
  const view = render(<BoardView api={mock.api} renderConversation={id => <div data-testid={'native-' + id} />} />);
  return { ...mock, ...view, user: userEvent.setup() };
}

async function openAlpha(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
}

function firstTaskWithoutConversation(overrides: Partial<TestSnapshot['state']['tasks'][number]> = {}): TestSnapshot {
  const value = fixture();
  const task = value.state.tasks[0]!;
  task.sessionIds = [];
  task.closedSessionIds = [];
  Object.assign(task, overrides);
  return value;
}

describe('first-execution preparation', () => {
  it('asks for the worktree before moving and completes in the background after the move', async () => {
    const { user, command, get } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    expect(within(dialog).getByText('Alpha task')).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
    expect(get().state.tasks[0]!.columnId).toBe('intake');
    await user.click(within(dialog).getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(get().state.tasks[0]!.columnId).toBe('review'));
    // The move leads, and the preparation that needs the host follows it.
    await waitFor(() => expect(command.mock.calls.map(([value]) => value.type)).toEqual(['task.move', 'worktree.dismiss', 'conversation.create']));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Cancel automatic Review instruction' }).length).toBeGreaterThan(0));
  });

  it('creates the worktree in the background after the move and arms the countdown once the conversation exists', async () => {
    const initial = firstTaskWithoutConversation();
    initial.state.settings = { revision: 2, worktreeBasePath: '/trees' };
    const { user, command, get } = mount(initial);
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    await user.click(within(dialog).getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(command.mock.calls.map(([value]) => value.type)).toEqual(['task.move', 'worktree.create', 'conversation.create']));
    expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', background: true });
    await waitFor(() => expect(get().state.tasks[0]!.worktree?.status).toBe('ready'));
    expect(get().state.tasks[0]!.columnId).toBe('review');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Cancel automatic Review instruction' }).length).toBeGreaterThan(0));
  });

  it('reports a refused worktree creation on the card after the move', async () => {
    const mock = fakeApi(firstTaskWithoutConversation());
    const original = mock.command.getMockImplementation()!;
    mock.command.mockImplementation(async input => {
      if (input.type === 'worktree.create') throw { code: 'WORKTREE_NAME_UNAVAILABLE', message: 'No worktree name can be derived.' };
      return original(input);
    });
    const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    await user.click(within(dialog).getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(screen.getAllByText('No worktree name can be derived.').length).toBeGreaterThan(0));
    expect(mock.get().state.tasks[0]!.columnId).toBe('review');
    expect(mock.get().state.tasks[0]!.sessionIds).toEqual([]);
  });

  it('moves to an uninstructed stage without a preparation for a task without a conversation', async () => {
    const { user, command } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'doing');
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'doing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels without moving or creating anything', async () => {
    const { user, command, get } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(command).not.toHaveBeenCalled();
    expect(get().state.tasks[0]!.columnId).toBe('intake');
    expect(get().state.tasks[0]!.sessionIds).toEqual([]);
  });

  it('blocks the first execution while the worktree binding is not ready', async () => {
    const initial = firstTaskWithoutConversation();
    initial.state.tasks[0]!.worktree = { path: '/trees/alpha', branch: 'alpha', owned: true, status: 'error', error: { code: 'WORKTREE_CREATE_FAILED', message: 'Injected.' } };
    const { user, command, get } = mount(initial);
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Resolve the worktree binding first' });
    expect(within(dialog).queryByRole('button', { name: 'Create worktree' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Continue in base project' })).toBeNull();
    expect(within(dialog).getByText(/Resolve it in the Git section/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(command).not.toHaveBeenCalled();
    expect(get().state.tasks[0]!.columnId).toBe('intake');
  });

  it('prepares the first execution before the card run action sends', async () => {
    const initial = firstTaskWithoutConversation({ columnId: 'review', instructionPending: { columnId: 'review', enteredAt: 1 } });
    const { user, command } = mount(initial);
    await screen.findByRole('button', { name: 'Run Review instruction' });
    await user.click(screen.getByRole('button', { name: 'Run Review instruction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    expect(command).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.runInstruction', taskId: 't1', columnId: 'review', expectedEnteredAt: 1, expectedInstruction: 'Review **carefully**.' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(command.mock.calls.map(([value]) => value.type)).toEqual(['worktree.dismiss', 'conversation.create', 'task.runInstruction']);
  });

  it('cancels on Escape without moving', async () => {
    const { user, command, get } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    await screen.findByRole('dialog', { name: 'Create a worktree?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(command).not.toHaveBeenCalled();
    expect(get().state.tasks[0]!.columnId).toBe('intake');
  });

  it('reports a move rejected after the answer and leaves the card in place', async () => {
    const { user, command, get } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    const original = command.getMockImplementation()!;
    command.mockImplementation(async input => {
      if (input.type === 'task.move') throw { code: 'TASK_BUSY', message: 'The task is busy.' };
      return original(input);
    });
    await user.click(within(dialog).getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect(screen.getByText('The task is busy.')).toBeTruthy());
    expect(get().state.tasks[0]!.columnId).toBe('intake');
    // The preparation never starts when the move it follows was refused.
    expect(command.mock.calls.map(([value]) => value.type)).toEqual(['task.move']);
    expect(get().state.tasks[0]!.sessionIds).toEqual([]);
  });

  it('runs immediately for a task that already has a conversation, even with an errored binding', async () => {
    const initial = fixture();
    const task = initial.state.tasks[0]!;
    task.columnId = 'review';
    task.instructionPending = { columnId: 'review', enteredAt: 1 };
    task.worktree = { path: '/trees/alpha', branch: 'alpha', owned: true, status: 'error', error: { code: 'WORKTREE_CREATE_FAILED', message: 'Injected.' } };
    const { user, command } = mount(initial);
    await user.click(await screen.findByRole('button', { name: 'Run Review instruction' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.runInstruction', taskId: 't1', columnId: 'review', expectedEnteredAt: 1, expectedInstruction: 'Review **carefully**.' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels after a restricted confirmation without moving', async () => {
    const initial = restrictedInstructedFixture();
    const task = initial.state.tasks[0]!;
    task.sessionIds = [];
    task.closedSessionIds = [];
    const { user, command, get } = mount(initial);
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const override = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    await user.click(within(override).getByRole('button', { name: 'Move anyway' }));
    const preparation = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    expect(screen.queryByRole('dialog', { name: 'Move to Blocked?' })).toBeNull();
    await user.click(within(preparation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(command.mock.calls.some(([value]) => value.type === 'task.move')).toBe(false);
    expect(get().state.tasks[0]!.columnId).toBe('intake');
  });

  it('confirms a restricted transition before preparing the first execution', async () => {
    const initial = restrictedInstructedFixture();
    const task = initial.state.tasks[0]!;
    task.sessionIds = [];
    task.closedSessionIds = [];
    const { user, command, get } = mount(initial);
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const override = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    await user.click(within(override).getByRole('button', { name: 'Move anyway' }));
    const preparation = await screen.findByRole('dialog', { name: 'Create a worktree?' });
    expect(command).not.toHaveBeenCalled();
    await user.click(within(preparation).getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'blocked', overrideTransition: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(get().state.tasks[0]!.columnId).toBe('blocked'));
  });
});
