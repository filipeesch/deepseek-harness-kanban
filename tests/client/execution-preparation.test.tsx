// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { BoardView } from '../../src/client/board.js';
import type { ConversationLeaseEnvironment } from '../../src/client/conversation-leases.js';
import { MODEL_SELECTION_SLOT, type PreparationSeat } from '../../src/client/execution-preparation/model-seat.js';
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

function seatEnvironment(): { seat: PreparationSeat; leases: ConversationLeaseEnvironment } {
  const StubModelSeat = () => <button type="button">DeepSeek Chat</button>;
  const entry = {
    component: StubModelSeat,
    options: { id: 'model-seat' },
    locale: 'ui-model-selection',
    inject: () => ({ available: true, directory: { subscribe: () => () => {}, getSnapshot: () => ({}) }, load: async () => undefined, select: async () => ({ ok: true }) }),
  } as unknown as StoredEntry;
  const seat: PreparationSeat = {
    slots: { entriesOfSlot: key => key === MODEL_SELECTION_SLOT ? [entry] : [], subscribe: () => () => {} },
    locale: { bind: () => key => key, getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} },
  };
  const sessions = {
    retain: (target: string) => ({ sessionId: target, binding: {}, ready: Promise.resolve({}), release: () => {} }),
    refresh: async () => {},
    list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }), subscribe: () => () => {} },
    subagentAddress: () => ({ parentSessionId: 'parent', childSessionId: 'child', mode: 'unknown' }),
  };
  return { seat, leases: { sessions: sessions as never, lifetime: new AbortController().signal } };
}

describe('first-execution preparation', () => {
  it('asks for the worktree before applying a first instructed move', async () => {
    const { user, command, get } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    expect(within(dialog).getByText('Alpha task')).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
    expect(get().state.tasks[0]!.columnId).toBe('intake');
    await user.click(within(dialog).getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(get().state.tasks[0]!.columnId).toBe('review');
    expect(screen.getAllByRole('button', { name: 'Cancel automatic Review instruction' }).length).toBeGreaterThan(0);
  });

  it('moves to an uninstructed stage without a preparation for a task without a conversation', async () => {
    const { user, command } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'doing');
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'doing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('presents the native model stage and starts the move after confirmation', async () => {
    const environment = seatEnvironment();
    const mock = fakeApi(firstTaskWithoutConversation());
    render(<BoardView api={mock.api} renderConversation={id => <div data-testid={'native-' + id} />} nativeSeat={environment.seat} conversationLeases={environment.leases} />);
    const user = userEvent.setup();
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const preparation = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    await user.click(within(preparation).getByRole('button', { name: 'Continue in base project' }));
    const model = await screen.findByRole('dialog', { name: 'Choose the conversation model' });
    expect(within(model).getByRole('button', { name: 'DeepSeek Chat' })).toBeTruthy();
    await user.click(within(model).getByRole('button', { name: 'Start execution' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.get().state.tasks[0]!.columnId).toBe('review');
  });

  it('cancels the model stage without moving but keeps the created conversation', async () => {
    const environment = seatEnvironment();
    const mock = fakeApi(firstTaskWithoutConversation());
    render(<BoardView api={mock.api} renderConversation={id => <div data-testid={'native-' + id} />} nativeSeat={environment.seat} conversationLeases={environment.leases} />);
    const user = userEvent.setup();
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const preparation = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    await user.click(within(preparation).getByRole('button', { name: 'Continue in base project' }));
    const model = await screen.findByRole('dialog', { name: 'Choose the conversation model' });
    await user.click(within(model).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.command.mock.calls.some(([value]) => value.type === 'task.move')).toBe(false);
    expect(mock.get().state.tasks[0]!.columnId).toBe('intake');
    expect(mock.get().state.tasks[0]!.sessionIds).toHaveLength(1);
  });

  it('creates the worktree from the derived defaults before moving', async () => {
    const initial = firstTaskWithoutConversation();
    initial.state.settings = { revision: 2, worktreeBasePath: '/trees' };
    const { user, command, get } = mount(initial);
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    const create = within(dialog).getByRole('button', { name: 'Create worktree' }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    await user.click(create);
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review' }));
    const calls = command.mock.calls.map(([value]) => value.type);
    expect(calls).toEqual(['worktree.create', 'conversation.create', 'task.move']);
    expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', branchName: 'alpha-task', path: '/trees/alpha-task', sourceBranch: 'main' });
    expect(get().state.tasks[0]!.worktree?.status).toBe('ready');
    expect(get().state.tasks[0]!.columnId).toBe('review');
  });

  it('disables creating a worktree when no destination can be derived', async () => {
    const { user, command } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    await waitFor(() => expect(within(dialog).getByText(/No worktree destination can be derived/)).toBeTruthy());
    const create = within(dialog).getByRole('button', { name: 'Create worktree' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });

  it('cancels without moving or creating anything', async () => {
    const { user, command, get } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create worktree' })).toBeTruthy());
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
    const dialog = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
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
    const dialog = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create worktree' })).toBeTruthy());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(command).not.toHaveBeenCalled();
    expect(get().state.tasks[0]!.columnId).toBe('intake');
  });

  it('reports a move rejected after preparation and leaves the card in place', async () => {
    const { user, command, get } = mount(firstTaskWithoutConversation());
    await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    const dialog = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    const original = command.getMockImplementation()!;
    command.mockImplementation(async input => {
      if (input.type === 'task.move') throw { code: 'TASK_BUSY', message: 'The task is busy.' };
      return original(input);
    });
    await user.click(within(dialog).getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect(screen.getByText('The task is busy.')).toBeTruthy());
    expect(get().state.tasks[0]!.columnId).toBe('intake');
    expect(get().state.tasks[0]!.sessionIds).toHaveLength(1);
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
    const preparation = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
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
    const preparation = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
    expect(command).not.toHaveBeenCalled();
    await user.click(within(preparation).getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'blocked', overrideTransition: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(get().state.tasks[0]!.columnId).toBe('blocked');
  });
});
