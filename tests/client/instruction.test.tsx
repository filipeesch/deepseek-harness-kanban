// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
function mount(initial = fixture()) {
  const mock = fakeApi(initial);
  render(<BoardView api={mock.api} renderConversation={(id: string) => <span>Native {id}</span>} />);
  return { ...mock, user: userEvent.setup() };
}
async function loaded() { await screen.findByRole('button', { name: 'Open task Alpha task' }); }
function inReview() { const value = fixture(); const alpha = value.state.tasks[0]!; alpha.columnId = 'review'; alpha.instructionPending = { columnId: 'review', enteredAt: 1 }; return value; }

describe('card instruction action', () => {
  it('sends the current stage instruction without moving the task', async () => {
    const { user, command, get } = mount(inReview()); await loaded();
    await user.click(screen.getByRole('button', { name: 'Run Review instruction' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.runInstruction', taskId: 't1', columnId: 'review', expectedInstruction: 'Review **carefully**.' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Run Review instruction' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move and run' })).toBeNull();
    expect(get().state.tasks[0]!.columnId).toBe('review');
    expect(command.mock.calls.some(([value]) => value.type === 'task.move')).toBe(false);
  });

  it('does not show the action without an unresolved entry', async () => {
    const initial = inReview(); delete initial.state.tasks[0]!.instructionPending;
    mount(initial); await loaded();
    expect(screen.queryByRole('button', { name: 'Run Review instruction' })).toBeNull();
  });

  it('is absent without an entry instruction and hidden in selection mode', async () => {
    mount(); await loaded();
    expect(screen.queryByRole('button', { name: 'Run Intake instruction' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run Doing instruction' })).toBeNull();
    cleanup();

    const { user } = mount(inReview()); await loaded();
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    expect(screen.queryByRole('button', { name: 'Run Review instruction' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select Alpha task' })).toBeTruthy();
  });

  it('is disabled while the task is blocked', async () => {
    const initial = inReview();
    initial.state.tasks[0]!.operation = { id: 'operation', request: { kind: 'return' }, phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now' };
    mount(initial); await loaded();
    expect((screen.getByRole('button', { name: 'Run Review instruction' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports an admission failure inline and remains available', async () => {
    const { user, command } = mount(inReview()); await loaded();
    command.mockRejectedValueOnce({ code: 'SEND_FAILED', message: 'The instruction could not be admitted.' });
    const button = screen.getByRole('button', { name: 'Run Review instruction' });
    await user.click(button);
    expect(await screen.findByText('The instruction could not be admitted.')).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('the card action error does not carry over to a newly selected instructed stage', async () => {
    const initial = inReview();
    initial.state.workflow.columns.push({ id: 'plan', name: 'Plan', onEnterPrompt: 'Plan this.' });
    const { user, command } = mount(initial); await loaded();
    command.mockRejectedValueOnce({ code: 'SEND_FAILED', message: 'The instruction could not be admitted.' });
    await user.click(screen.getByRole('button', { name: 'Run Review instruction' }));
    expect(await screen.findByText('The instruction could not be admitted.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'plan');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run Plan instruction' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(screen.queryByText('The instruction could not be admitted.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Run Plan instruction' })).toBeTruthy();
  });

  it('opens the drawer from the card button but not from the card action', async () => {
    const { user, command } = mount(inReview()); await loaded();
    const action = screen.getByRole('button', { name: 'Run Review instruction' });
    action.focus(); await user.keyboard('{Enter}');
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.runInstruction' })));
    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull();

    const open = screen.getByRole('button', { name: 'Open task Alpha task' }); open.focus(); await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Close task details' })).toBeTruthy();
  });
});
