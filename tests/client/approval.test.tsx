// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
const oldInstruction = '    printf OLD  ' + String.fromCharCode(10, 10);
const newInstruction = '    printf NEW  ' + String.fromCharCode(10, 10);
const native = (id: string) => <span>Native session {id}</span>;

async function openMove(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Move Alpha task to' }), 'review');
  await screen.findByRole('dialog', { name: 'Move to Review' });
}

describe('workflow instruction approval binding', () => {
  it('sends the exact raw displayed instruction, including Markdown indentation and trailing whitespace', async () => {
    const initial = fixture(); initial.state.workflow.columns[2]!.onEnterPrompt = oldInstruction; const mock = fakeApi(initial); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={native} />); await openMove(user); await user.click(screen.getByRole('button', { name: 'Move and run' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review', mode: 'run', sessionId: 's1', expectedInstruction: oldInstruction }));
  });

  it.each(['changed', 'removed'] as const)('does not silently substitute a %s instruction after the confirmation has rendered', async change => {
    const initial = fixture(); initial.state.workflow.columns[2]!.onEnterPrompt = oldInstruction; const mock = fakeApi(initial); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={native} />); await openMove(user);
    const updated = mock.get(); updated.sequence++; if (change === 'changed') updated.state.workflow.columns[2]!.onEnterPrompt = newInstruction; else delete updated.state.workflow.columns[2]!.onEnterPrompt;
    act(() => { mock.publish(updated); });
    expect(screen.getByText('printf OLD').closest('pre')).not.toBeNull(); expect(screen.queryByText('printf NEW')).toBeNull();
    mock.command.mockRejectedValueOnce({ code: 'INSTRUCTION_CHANGED', message: 'The entry instruction changed. Review the workflow and confirm again.' });
    await user.click(screen.getByRole('button', { name: 'Move and run' })); await screen.findByText('INSTRUCTION_CHANGED');
    expect(mock.command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review', mode: 'run', sessionId: 's1', expectedInstruction: oldInstruction });
    expect(mock.get().state.tasks[0]!.columnId).toBe('intake'); expect(screen.getByRole('dialog', { name: 'Move to Review' })).toBeTruthy();
  });

  it('omits instruction approval and agent targets for Move only', async () => {
    const initial = fixture(); initial.state.workflow.columns[2]!.onEnterPrompt = oldInstruction; const mock = fakeApi(initial); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={native} />); await openMove(user); await user.selectOptions(screen.getByRole('combobox', { name: 'Run in conversation' }), 'new'); await user.click(screen.getByRole('button', { name: 'Move only' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review', mode: 'move' }));
    expect(mock.command.mock.calls[0]![0]).not.toHaveProperty('expectedInstruction'); expect(mock.command.mock.calls[0]![0]).not.toHaveProperty('newConversation');
  });

  it('does not offer execution for an instruction containing only whitespace', async () => {
    const initial = fixture(); initial.state.workflow.columns[2]!.onEnterPrompt = '    ' + String.fromCharCode(10); const mock = fakeApi(initial); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={native} />); await openMove(user); expect(screen.queryByRole('button', { name: 'Move and run' })).toBeNull(); expect(mock.command).not.toHaveBeenCalled();
  });
});
