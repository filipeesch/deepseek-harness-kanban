// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fixture, fakeApi, task } from './helpers.js';

beforeEach(() => { try { globalThis.localStorage?.clear(); } catch { /* jsdom storage optional */ } });
afterEach(cleanup);

function mount() {
  const mock = fakeApi();
  render(<BoardView api={mock.api} renderConversation={id => <div data-testid={'native-' + id} />} />);
  return { ...mock, user: userEvent.setup() };
}

describe('Hub and board navigation', () => {
  it('creates a Hub and then its first board from the empty state', async () => {
    const { user, command } = mount();
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Create Hub' }));
    const hubDialog = screen.getByRole('dialog', { name: 'Create Hub' });
    await user.type(within(hubDialog).getByRole('textbox', { name: 'Hub name' }), 'Second Hub');
    await user.click(within(hubDialog).getByRole('button', { name: 'Create Hub' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Second Hub/ }).getAttribute('aria-selected')).toBe('true'));
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'hub.create', name: 'Second Hub' }));
    const empty = (await screen.findByRole('heading', { name: 'Create your first board' })).parentElement!;
    await user.click(within(empty).getByRole('button', { name: 'Create board' }));
    const boardDialog = screen.getByRole('dialog', { name: 'Create board' });
    await user.type(within(boardDialog).getByRole('textbox', { name: 'Board name' }), 'Delivery board');
    await user.click(within(boardDialog).getByRole('button', { name: 'Create board' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Delivery board/ }).getAttribute('aria-selected')).toBe('true'));
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'board.create', name: 'Delivery board' }));
  });

  it('remembers the active Hub across a remount', async () => {
    const value = fixture();
    value.state.hubs.push({ ...value.state.hubs[0]!, id: 'hub-2', name: 'Remembered Hub', boards: [], tasks: [] });
    const mock = fakeApi(value); const user = userEvent.setup();
    const view = render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('tab', { name: /Remembered Hub/ });
    await user.click(screen.getByRole('tab', { name: /Remembered Hub/ }));
    view.unmount();
    const second = fakeApi(value); render(<BoardView api={second.api} renderConversation={() => null} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: /Remembered Hub/ }).getAttribute('aria-selected')).toBe('true'));
  });

  it('shows aggregated attention on an inactive Hub tab', async () => {
    const value = fixture();
    const secondTask = task('t3', 'Second Hub task', 'p1', 'intake');
    value.state.hubs.push({ ...value.state.hubs[0]!, id: 'hub-2', name: 'Attention Hub', boards: value.state.hubs[0]!.boards.map(board => ({ ...board, id: 'board-2' })), tasks: [{ ...secondTask, boardId: 'board-2' }] });
    value.attention.t3 = { running: false, background: [], unread: true, awaitingReply: false, failed: false };
    const mock = fakeApi(value);
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    const tab = await screen.findByRole('tab', { name: /Attention Hub/ });
    expect(within(tab).getByRole('img', { name: 'Hub unread activity' })).toBeTruthy();
  });
});

describe('Hub configuration without a board', () => {
  it('saves global settings and a Hub project before a board exists', async () => {
    const { user, command } = mount();
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Create Hub' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Hub' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Hub name' }), 'Empty Hub');
    await user.click(within(dialog).getByRole('button', { name: 'Create Hub' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Empty Hub/ }).getAttribute('aria-selected')).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Configuration' }));
    await user.type(screen.getByRole('textbox', { name: 'Worktree base path' }), '/trees');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings.save', settings: { worktreeBasePath: '/trees' } })));
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Project before board');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo');
    await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/repo');
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.save', project: expect.objectContaining({ name: 'Project before board' }) })));
    expect(await screen.findByText('Project saved.')).toBeTruthy();
  });
});

describe('Hub administration confirmations', () => {
  it('identifies the Hub and its counts before deletion and confirms board deletion', async () => {
    const { user, command } = mount();
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Create Hub' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Hub' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Hub name' }), 'Second Hub');
    await user.click(within(dialog).getByRole('button', { name: 'Create Hub' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Second Hub/ }).getAttribute('aria-selected')).toBe('true'));
    const empty = (await screen.findByRole('heading', { name: 'Create your first board' })).parentElement!;
    await user.click(within(empty).getByRole('button', { name: 'Create board' }));
    const boardDialog = screen.getByRole('dialog', { name: 'Create board' });
    await user.type(within(boardDialog).getByRole('textbox', { name: 'Board name' }), 'Second board');
    await user.click(within(boardDialog).getByRole('button', { name: 'Create board' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Second board/ }).getAttribute('aria-selected')).toBe('true'));

    await user.click(screen.getByRole('button', { name: 'Configuration' }));
    await user.click(screen.getByRole('tab', { name: 'Hub' }));
    await user.click(screen.getByRole('button', { name: 'Delete Hub' }));
    const hubConfirm = screen.getByRole('alertdialog', { name: /Confirm deleting Hub Second Hub/ });
    expect(hubConfirm.textContent).toContain('Second Hub');
    expect(hubConfirm.textContent).toContain('1 board');
    expect(hubConfirm.textContent).toContain('0 projects');
    await user.click(within(hubConfirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const boardConfirm = screen.getByRole('alertdialog', { name: /Confirm deleting board Second board/ });
    expect(boardConfirm.textContent).toContain('Second board');
    await user.click(within(boardConfirm).getByRole('button', { name: 'Cancel' }));
    expect(command).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'hub.delete' }));
    expect(command).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'board.delete' }));
  });
});
