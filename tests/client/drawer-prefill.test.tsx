// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import type { DraftResult, InstructionDraftPort } from '../../src/client/instruction-draft.js';
import { fakeApi, fixture, restrictedInstructedFixture } from './helpers.js';

afterEach(cleanup);
function fakePort() {
  const prepare = vi.fn(async (): Promise<DraftResult> => 'applied');
  const replace = vi.fn(async (): Promise<DraftResult> => 'applied');
  const port: InstructionDraftPort = { prepare, replace, attach: () => () => {} };
  return { port, prepare, replace };
}
function mount(draftPort: InstructionDraftPort, initial = fixture()) {
  const mock = fakeApi(initial);
  render(<BoardView api={mock.api} draftPort={draftPort} renderConversation={(id: string) => <span>Native {id}</span>} />);
  return { ...mock, user: userEvent.setup() };
}
async function openAlpha(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
}
async function moveToReview(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
}

describe('drawer stage prefill', () => {
  it('moves first, switches to Conversations, and inserts only the instruction', async () => {
    const { port, prepare } = fakePort();
    const { user, command } = mount(port); await openAlpha(user); await moveToReview(user);
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review', mode: 'move' }));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith('s1', 'Review **carefully**.', expect.any(AbortSignal)));
    expect(await screen.findByText("Instruction inserted into Agent 1's composer.")).toBeTruthy();
    expect(command.mock.calls.some(([value]) => value.type === 'task.move' && value.mode === 'run')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches from another section and keeps the active conversation target', async () => {
    const { port, prepare } = fakePort();
    const { user } = mount(port); await openAlpha(user);
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    await moveToReview(user);
    await waitFor(() => expect(prepare).toHaveBeenCalledWith('s1', 'Review **carefully**.', expect.any(AbortSignal)));
    expect(screen.getByRole('tab', { name: 'Conversations' }).getAttribute('aria-selected')).toBe('true');
  });

  it('preserves an existing draft and replaces only on an explicit action', async () => {
    const { port, prepare, replace } = fakePort();
    prepare.mockResolvedValueOnce('preserved');
    replace.mockResolvedValueOnce('applied');
    const { user } = mount(port); await openAlpha(user); await moveToReview(user);
    expect(await screen.findByText(/composer already has unsent text or attachments/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Replace draft' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('s1', 'Review **carefully**.', expect.any(AbortSignal)));
    expect(await screen.findByText("Instruction inserted into Agent 1's composer.")).toBeTruthy();
  });

  it('reports no open conversation and does not call the port', async () => {
    const { port, prepare } = fakePort();
    const initial = fixture(); initial.state.tasks[0]!.closedSessionIds = ['s1', 's2'];
    const { user, command } = mount(port, initial); await openAlpha(user); await moveToReview(user);
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review', mode: 'move' }));
    expect(prepare).not.toHaveBeenCalled();
    expect(await screen.findByText(/No open conversation is available for the instruction/)).toBeTruthy();
  });

  it('aborts a pending prefill when the drawer closes before the move resolves', async () => {
    const { port, prepare } = fakePort();
    const { user, command } = mount(port); await openAlpha(user);
    let resolveMove!: (value: ReturnType<typeof fixture>) => void;
    command.mockImplementationOnce(() => new Promise<ReturnType<typeof fixture>>(done => { resolveMove = done; }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.move', taskId: 't1', columnId: 'review' })));
    await user.click(screen.getByRole('button', { name: 'Close task details' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull());
    await act(async () => { resolveMove(fixture()); await Promise.resolve(); });
    await waitFor(() => expect(prepare).not.toHaveBeenCalled());
  });

  it('cancels a prefill that never reaches a composer', async () => {
    const { port, prepare } = fakePort();
    prepare.mockImplementationOnce(() => new Promise<DraftResult>(() => {}));
    const { user } = mount(port); await openAlpha(user);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByRole('combobox', { name: 'Move task to' }), { target: { value: 'review' } });
      await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
      expect(screen.getByText(/Inserting the/)).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(8000); });
      expect(screen.getByText(/did not become ready/)).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it('does not prefill or report for an uninstructed destination', async () => {
    const { port, prepare } = fakePort();
    const { user, command } = mount(port); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'doing');
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'doing', mode: 'move' }));
    expect(prepare).not.toHaveBeenCalled();
    expect(screen.queryByText(/Instruction inserted/)).toBeNull();
  });

  it('preserves an existing draft after a confirmed restricted instructed move', async () => {
    const { port, prepare } = fakePort();
    prepare.mockResolvedValueOnce('preserved');
    const { user } = mount(port, restrictedInstructedFixture()); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const dialog = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    await user.click(within(dialog).getByRole('button', { name: 'Move anyway' }));
    expect(await screen.findByText(/composer already has unsent text or attachments/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace draft' })).toBeTruthy();
  });

  it('prefills only after confirming a restricted instructed move', async () => {
    const { port, prepare } = fakePort();
    const { user, command } = mount(port, restrictedInstructedFixture()); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const dialog = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    expect(prepare).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(prepare).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect((screen.getByRole('combobox', { name: 'Move task to' }) as HTMLSelectElement).value).toBe('intake');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const confirmed = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    await user.click(within(confirmed).getByRole('button', { name: 'Move anyway' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'blocked', mode: 'move', overrideTransition: true }));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith('s1', 'Blocked instruction.', expect.any(AbortSignal)));
    expect(screen.getByRole('tab', { name: 'Conversations' }).getAttribute('aria-selected')).toBe('true');
  });
});
