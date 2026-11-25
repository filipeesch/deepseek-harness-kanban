// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Configuration } from '../../src/client/settings/configuration.js';
import type { Command, HubSharingView, KanbanSnapshot } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

vi.mock('../../src/client/code-editor.js', async () => {
  const React = await import('react');
  return {
    CodeEditor: ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) =>
      React.createElement('textarea', { 'aria-label': label, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

afterEach(cleanup);

function mount(options: { initial?: string; run?: (command: Command) => Promise<KanbanSnapshot>; emptyBoard?: boolean; sharing?: HubSharingView; hubCount?: number; extraBoard?: boolean; foreignHub?: boolean } = {}) {
  const value = fixture();
  const user = userEvent.setup();
  const run = vi.fn(options.run ?? (async () => ({}) as KanbanSnapshot));
  const onClose = vi.fn();
  const base = value.state.hubs[0]!;
  const hub = options.emptyBoard === true ? { ...base, tasks: [] } : base;
  if (options.extraBoard === true) hub.boards = [...hub.boards, { ...hub.boards[0]!, id: 'board-2', name: 'Second board' }];
  if (options.foreignHub === true) value.state.hubs.push({ ...base, id: 'hub-2', name: 'Other Hub', boards: [{ ...base.boards[0]!, id: 'board-3', name: 'Foreign board' }], tasks: [] });
  render(<Configuration hub={hub} hubCount={options.hubCount ?? 1} settings={value.state.settings} settingsRevision={value.state.settings.revision} run={run} {...(options.sharing === undefined ? {} : { sharing: options.sharing })} initial={options.initial ?? 'General'} onClose={onClose} />);
  return { value, user, onClose, run, hub, board: hub.boards[0]! };
}

const topTabs = () => within(screen.getByRole('tablist', { name: 'Configuration sections' }));
const boardTabs = () => within(screen.getByRole('tablist', { name: 'Board configuration sections' }));
const configuration = () => screen.getByRole('dialog', { name: 'Kanban configuration' });
const overlay = (boardName: string) => screen.getByRole('dialog', { name: 'Board configuration · ' + boardName });

async function openBoards(user: ReturnType<typeof userEvent.setup>) {
  await user.click(topTabs().getByRole('tab', { name: 'Boards' }));
}

describe('configuration sections', () => {
  it('presents the section row without a board section and opens General by default', () => {
    mount();
    expect(topTabs().getAllByRole('tab').map(tab => tab.textContent)).toEqual(['General', 'Hub', 'Boards', 'Projects', 'Schedules', 'Team Settings']);
    expect(topTabs().queryByRole('tab', { name: 'Board' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Worktree base path' })).toBeTruthy();
  });

  it('keeps one dialog width for every section', async () => {
    const { user } = mount();
    expect(configuration().className).toContain('kb-dialog-settings');
    expect(configuration().className).not.toContain('kb-dialog-settings-wide');
    for (const name of ['Hub', 'Boards', 'Projects', 'Team Settings']) {
      await user.click(topTabs().getByRole('tab', { name }));
      expect(configuration().className).toContain('kb-dialog-settings');
      expect(configuration().className).not.toContain('kb-dialog-settings-wide');
    }
  });

  it('asks before leaving a section that holds a draft', async () => {
    const { user } = mount();
    await user.type(screen.getByRole('textbox', { name: 'Worktree base path' }), '/trees');
    await user.click(topTabs().getByRole('tab', { name: 'Hub' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard section changes' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'Worktree base path' }) as HTMLInputElement).value).toContain('/trees');
    await user.click(topTabs().getByRole('tab', { name: 'Hub' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard section changes' })).getByRole('button', { name: 'Discard and continue' }));
    expect(screen.getByRole('textbox', { name: 'Hub name' })).toBeTruthy();
  });

  it('asks before closing the configuration while a section holds a draft', async () => {
    const { user, onClose } = mount();
    await user.type(screen.getByRole('textbox', { name: 'Worktree base path' }), '/trees');
    await user.click(screen.getByRole('button', { name: 'Close Kanban configuration' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard configuration changes' })).getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close Kanban configuration' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard configuration changes' })).getByRole('button', { name: 'Discard and close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Boards section', () => {
  it('lists each board with edit and delete only', async () => {
    const { user, board } = mount({ initial: 'Boards' });
    expect(screen.getByText(board.name)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit board ' + board.name })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete board ' + board.name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByLabelText('New board name')).toBeNull();
  });

  it('opens the board configuration above the list with its own sub-sections', async () => {
    const { user, board } = mount({ initial: 'Boards' });
    await user.click(screen.getByRole('button', { name: 'Edit board ' + board.name }));
    expect(overlay(board.name)).toBeTruthy();
    for (const name of ['General', 'Projects', 'Agents', 'MCP', 'Workflow', 'Danger zone']) {
      expect(boardTabs().getByRole('tab', { name })).toBeTruthy();
    }
    // The board overlay is the wide surface; the list keeps the narrower one behind it.
    expect(overlay(board.name).className).toContain('kb-dialog-settings-wide');
    expect(configuration().className).toContain('kb-dialog-settings');
  });

  it('makes the layer below inert and gives Escape to the top layer only', async () => {
    const { user, board } = mount({ initial: 'Boards' });
    const edit = screen.getByRole('button', { name: 'Edit board ' + board.name });
    await user.click(edit);
    await waitFor(() => expect(configuration().hasAttribute('inert')).toBe(true));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Board configuration · ' + board.name })).toBeNull());
    await waitFor(() => expect(configuration().hasAttribute('inert')).toBe(false));
    // Focus returns to the control that opened the overlay, not to the document.
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  it('edits the board it was opened for', async () => {
    const { user, board, run, hub } = mount({ initial: 'Boards' });
    await user.click(screen.getByRole('button', { name: 'Edit board ' + board.name }));
    const name = screen.getByRole('textbox', { name: 'Board name' });
    await user.clear(name);
    await user.type(name, 'Renamed board');
    await user.click(screen.getByRole('button', { name: 'Save board name' }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ type: 'board.rename', hubId: hub.id, boardId: board.id, name: 'Renamed board' }));
  });

  it('deletes a board from the overlay danger zone and returns to the list', async () => {
    const { user, board, run, hub } = mount({ initial: 'Boards', emptyBoard: true });
    await user.click(screen.getByRole('button', { name: 'Edit board ' + board.name }));
    await user.click(boardTabs().getByRole('tab', { name: 'Danger zone' }));
    await user.click(screen.getByRole('button', { name: 'Delete board' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete board' }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ type: 'board.delete', hubId: hub.id, boardId: board.id, confirmed: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Board configuration · ' + board.name })).toBeNull());
    expect(screen.getByRole('button', { name: 'Edit board ' + board.name })).toBeTruthy();
  });

  it('lists only the boards of the Hub it was given', async () => {
    const { user } = mount({ initial: 'Boards', extraBoard: true, foreignHub: true });
    expect(screen.getByRole('button', { name: 'Edit board Second board' })).toBeTruthy();
    expect(screen.queryByText('Foreign board')).toBeNull();
    await user.click(topTabs().getByRole('tab', { name: 'Hub' }));
    expect(screen.queryByText('Second board')).toBeNull();
  });

  it('asks before closing the overlay with a dirty panel and returns to the list', async () => {
    const { user, board } = mount({ initial: 'Boards' });
    await user.click(screen.getByRole('button', { name: 'Edit board ' + board.name }));
    await user.type(screen.getByRole('textbox', { name: 'Board name' }), ' edited');
    await user.click(screen.getByRole('button', { name: 'Close Board configuration · ' + board.name }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard board configuration changes' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Board name' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close Board configuration · ' + board.name }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard board configuration changes' })).getByRole('button', { name: 'Discard and close' }));
    expect(screen.queryByRole('dialog', { name: 'Board configuration · ' + board.name })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit board ' + board.name })).toBeTruthy();
    expect(configuration()).toBeTruthy();
  });

  it('creates a board through the shared creation dialog', async () => {
    const { user, run, hub } = mount({ initial: 'Boards' });
    await user.click(screen.getByRole('button', { name: 'New board' }));
    const dialog = screen.getByRole('dialog', { name: 'Create board' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Board name' }), 'Second');
    await user.click(within(dialog).getByRole('button', { name: 'Create board' }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ type: 'board.create', hubId: hub.id, name: 'Second' }));
  });

  it('deletes a board from its row after the confirmation', async () => {
    const { user, run, board, hub } = mount({ initial: 'Boards', emptyBoard: true });
    await user.click(screen.getByRole('button', { name: 'Delete board ' + board.name }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete board' }));
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ type: 'board.delete', hubId: hub.id, boardId: board.id, confirmed: true }));
  });
});

const publishedSharing: HubSharingView = {
  status: 'published', provider: 'git', providerLabel: 'Git repository', supportsFiles: true, address: 'https://example.test/team.git',
  intervalMinutes: 5, drafts: 0, updates: 0, conflicts: 0, syncing: false, boards: [], incoming: [], pendingRemovals: [], removed: [], blockers: [],
};

describe('Hub section', () => {
  it('states that deleting a published Hub keeps the shared configuration', async () => {
    const { user } = mount({ initial: 'Hub', emptyBoard: true, sharing: publishedSharing, hubCount: 2 });
    await user.click(screen.getByRole('button', { name: 'Delete Hub' }));
    const confirm = screen.getByRole('alertdialog', { name: /Confirm deleting Hub/ });
    expect(confirm.textContent).toContain("The team's published configuration is not removed.");
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  });

  it('keeps identity and a separated danger zone, with no board management', async () => {
    const { user } = mount({ initial: 'Hub' });
    expect(screen.getByRole('textbox', { name: 'Hub name' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Hub danger zone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Hub' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: undefined })).toBeNull();
    expect(screen.queryByLabelText('New board name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create board' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
    await user.click(topTabs().getByRole('tab', { name: 'Boards' }));
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });
});
