// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
const unclaimed = [
  { path: '/manual/detached-checkout', branch: 'feature/detached', error: { code: 'DETACHED_CHECKOUT', message: 'The checkout is detached and was not claimed.' } },
  { path: '/manual/foreign-checkout', branch: 'feature/foreign', error: { code: 'REPOSITORY_MISMATCH', message: 'The checkout belongs to another repository.' } },
];

async function openTask(user: ReturnType<typeof userEvent.setup>, title: string) {
  await screen.findByRole('button', { name: 'Open task ' + title }); await user.click(screen.getByRole('button', { name: 'Open task ' + title }));
}

describe('unclaimed checkout recovery metadata', () => {
  it('shows read-only Git paths, branches and reasons without claiming or removing them', async () => {
    const initial = fixture(); initial.state.tasks[0]!.unclaimedWorktrees = unclaimed; const mock = fakeApi(initial); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />); await openTask(user, 'Alpha task'); await user.click(screen.getByRole('tab', { name: 'Git' }));
    const notice = screen.getByRole('note', { name: 'Unclaimed worktrees' });
    for (const entry of unclaimed) { expect(within(notice).getByText(entry.path)).toBeTruthy(); expect(within(notice).getByText(entry.branch)).toBeTruthy(); expect(within(notice).getByText(entry.error.message)).toBeTruthy(); }
    expect(within(notice).getByText(/not the task's active worktree/)).toBeTruthy(); expect(within(notice).getByText(/will not be attached or removed automatically/)).toBeTruthy();
    expect(within(notice).queryAllByRole('button')).toHaveLength(0); expect(within(notice).queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Remove worktree' })).toBeNull(); expect((screen.getByRole('textbox', { name: 'Worktree path' }) as HTMLInputElement).value).toBe(''); expect(mock.command).not.toHaveBeenCalled();
  });

  it.each([false, true])('warns that unclaimed checkouts remain on disk and uses only the %s active target for deletion', async hasActive => {
    const initial = fixture(); const target = initial.state.tasks[0]!; target.unclaimedWorktrees = unclaimed;
    if (hasActive) { target.worktree = { path: '/trees/verified-active', branch: 'feature/active', owned: true, status: 'ready' }; target.effectiveCwd = '/trees/verified-active/apps/api'; }
    const mock = fakeApi(initial); const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />); await openTask(user, 'Alpha task'); await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' }); const warning = within(dialog).getByRole('note', { name: 'Unclaimed checkout deletion warning' }); expect(warning.textContent).toContain('Unclaimed checkouts remain on disk'); expect(warning.textContent).toContain('not included in this deletion'); expect(mock.command).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete task and archive chats' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: hasActive ? '/trees/verified-active' : null }));
    expect(mock.command).toHaveBeenCalledTimes(1); expect(mock.command.mock.calls[0]![0]).not.toHaveProperty('discardChanges');
    for (const entry of unclaimed) expect(JSON.stringify(mock.command.mock.calls[0]![0])).not.toContain(entry.path);
  });
});
