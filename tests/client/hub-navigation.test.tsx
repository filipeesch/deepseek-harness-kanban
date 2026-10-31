// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    const boardTabs = screen.getByRole('tablist', { name: 'Boards' });
    expect(within(boardTabs).getByRole('button', { name: 'Create board' })).toBeTruthy();
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

  it('shows the running-task count after the attention indicators on the Hub and board tabs', async () => {
    const { publish, get } = mount();
    const hubTab = await screen.findByRole('tab', { name: /My Hub.*1 task running/ });
    const boardTab = screen.getByRole('tab', { name: /Delivery.*1 task running/ });
    expect(within(hubTab).getByRole('img', { name: '1 task running' }).getAttribute('title')).toBe('1 task running: Alpha task');
    expect(hubTab.querySelector('.kb-tab-running-count')?.textContent).toBe('1');
    expect(within(hubTab).getByRole('img', { name: 'Hub failure' })).toBeTruthy();
    expect(within(hubTab).getByRole('img', { name: 'Hub awaiting reply' })).toBeTruthy();
    expect([...hubTab.querySelectorAll('.kb-dot, .kb-tab-running')].map(element => element.className)).toEqual(['kb-dot kb-blue', 'kb-dot kb-orange', 'kb-dot kb-red', 'kb-tab-running']);
    expect(within(boardTab).getByRole('img', { name: 'Board unread activity' })).toBeTruthy();
    expect(within(boardTab).getByRole('img', { name: 'Board awaiting reply' })).toBeTruthy();
    expect(within(boardTab).getByRole('img', { name: 'Board failure' })).toBeTruthy();
    expect(within(boardTab).getByRole('img', { name: '1 task running' }).getAttribute('title')).toBe('1 task running: Alpha task');
    expect([...boardTab.querySelectorAll('.kb-dot, .kb-tab-running')].map(element => element.className)).toEqual(['kb-dot kb-blue', 'kb-dot kb-orange', 'kb-dot kb-red', 'kb-tab-running']);

    const next = get();
    next.attention.t1 = { running: false, background: [], unread: false, awaitingReply: false, failed: false };
    act(() => { publish(next); });
    await waitFor(() => {
      expect(within(screen.getByRole('tab', { name: /My Hub/ })).queryByRole('img', { name: /task running/ })).toBeNull();
      expect(within(screen.getByRole('tab', { name: /Delivery/ })).queryByRole('img', { name: /task running/ })).toBeNull();
    });
  });

  it('keeps the running-task count on an inactive board tab', async () => {
    const value = fixture();
    const hub = value.state.hubs[0]!;
    hub.boards.push({ ...hub.boards[0]!, id: 'board-2', name: 'Second board' });
    hub.tasks.push({ ...task('t3', 'Second board task', 'p1', 'intake'), boardId: 'board-2' });
    value.attention.t3 = { running: true, background: [], unread: false, awaitingReply: false, failed: false };
    render(<BoardView api={fakeApi(value).api} renderConversation={() => null} />);
    const tab = await screen.findByRole('tab', { name: /Second board.*1 task running/ });
    expect(within(tab).getByRole('img', { name: '1 task running' })).toBeTruthy();
  });

  it('counts each task once when a task runs a turn and owns background work', async () => {
    const { publish, get } = mount();
    const next = get();
    next.attention.t1 = { running: true, background: [{ kind: 'job', label: 'Run tests' }, { kind: 'schedule', label: 'Wake later' }], unread: false, awaitingReply: false, failed: false };
    next.attention.t2 = { running: true, background: [], unread: false, awaitingReply: false, failed: false };
    act(() => { publish(next); });
    const boardTab = screen.getByRole('tab', { name: /Delivery/ });
    await waitFor(() => expect(within(boardTab).getByRole('img', { name: '2 tasks running' })).toBeTruthy());
    expect(boardTab.querySelector('.kb-tab-running-count')?.textContent).toBe('2');
  });

  it('keeps the running-task count on an inactive Hub tab', async () => {
    const value = fixture();
    value.state.hubs.push({ ...value.state.hubs[0]!, id: 'hub-2', name: 'Running Hub', boards: value.state.hubs[0]!.boards.map(board => ({ ...board, id: 'board-2' })), tasks: [{ ...task('t3', 'Second Hub task', 'p1', 'intake'), boardId: 'board-2' }] });
    value.attention.t3 = { running: true, background: [], unread: false, awaitingReply: false, failed: false };
    const mock = fakeApi(value);
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    const tab = await screen.findByRole('tab', { name: /Running Hub/ });
    expect(within(tab).getByRole('img', { name: '1 task running' })).toBeTruthy();
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
    await user.click(screen.getByRole('button', { name: 'New project' }));
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
