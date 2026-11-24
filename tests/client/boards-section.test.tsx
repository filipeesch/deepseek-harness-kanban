// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { BoardsSection } from '../../src/client/settings/boards/boards-section.js';
import type { WorkflowImportEntry } from '../../src/shared/types.js';
import { fakeApi, fixture } from './helpers.js';
import { fakeFilePort } from './transfer-support.js';

afterEach(cleanup);

function mountWithTwoBoards() {
  const data = fixture();
  const hub = data.state.hubs[0]!;
  hub.boards = [...hub.boards, { ...hub.boards[0]!, id: 'board-2', name: 'Second board' }];
  const mock = fakeApi(data);
  const user = userEvent.setup();
  render(<BoardView api={mock.api} renderConversation={() => null} />);
  return { mock, user };
}

describe('editing a board from the Boards section', () => {
  it('edits the board it was opened for and leaves the active board alone', async () => {
    const { mock, user } = mountWithTwoBoards();
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    expect(screen.getByRole('tab', { name: /Delivery/ }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Configuration' }));
    await user.click(screen.getByRole('tab', { name: 'Boards' }));
    await user.click(screen.getByRole('button', { name: 'Edit board Second board' }));
    const name = screen.getByRole('textbox', { name: 'Board name' });
    await user.clear(name);
    await user.type(name, 'Second renamed');
    await user.click(screen.getByRole('button', { name: 'Save board name' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'board.rename', boardId: 'board-2', name: 'Second renamed' })));
    expect(mock.command).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'board.rename', boardId: 'board-1' }));
    expect(screen.getByRole('tab', { name: /Delivery/ }).getAttribute('aria-selected')).toBe('true');
  });
});

function mountSectionWithTransfer(options: { entries?: WorkflowImportEntry[] } = {}) {
  const data = fixture();
  const hub = data.state.hubs[0]!;
  hub.boards = [...hub.boards, { ...hub.boards[0]!, id: 'board-2', name: 'Second board' }];
  const mock = fakeApi(data, {
    exportResult: { archive: '', fileName: 'kanban-workflows-hub.json.gz', boardCount: 1, advisories: [] },
    importPlan: { hubId: 'hub-1', origin: 'Other Hub', entries: options.entries ?? [{ name: 'Fresh', destination: 'create', targetBoardId: null, copyName: null, orphaned: [], realigned: [], awaitingProjectKeys: [], blockReason: null, detail: null, externalScriptSources: [] }] },
    onImport: (command, target) => {
      for (const decision of command.decisions) {
        if (decision.settlement === 'skip') continue;
        const name = decision.settlement === 'copy' ? decision.copyName ?? decision.name : decision.name;
        if (!target.boards.some(board => board.name === name)) target.boards.push({ ...target.boards[0]!, id: 'board-' + (target.boards.length + 1), name });
      }
    },
  });
  const files = fakeFilePort({ chosen: { fileName: 'export.json.gz', bytes: new Uint8Array([1, 2]) } });
  const user = userEvent.setup();
  const view = render(<BoardsSection hub={hub} run={request => mock.api.command(request)} api={mock.api} files={files} />);
  return { mock, user, files, view, hub };
}

describe('transfer actions in the Boards section', () => {
  it('presents Export and Import as section actions and not per row', () => {
    mountSectionWithTransfer();
    expect(screen.getByRole('button', { name: 'Export workflows' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import workflows' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export board Delivery' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import board Delivery' })).toBeNull();
  });

  it('opens the transfer dialogs above the list without touching a board', async () => {
    const { user } = mountSectionWithTransfer();
    await user.click(screen.getByRole('button', { name: 'Export workflows' }));
    await screen.findByRole('heading', { name: 'Export workflows' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Import workflows' }));
    await screen.findByRole('heading', { name: 'Import workflows' });
    expect(screen.queryByText(/Board configuration/)).toBeNull();
  });

  it('hands the chosen document to the import command and keeps the list current', async () => {
    const { mock, user } = mountSectionWithTransfer();
    await user.click(screen.getByRole('button', { name: 'Import workflows' }));
    await screen.findByRole('heading', { name: 'Import workflows' });
    await user.click(screen.getByRole('button', { name: /Choose file/ }));
    await screen.findByText('Fresh');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Import finished.');
    expect(mock.api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'hub.workflows.import' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Edit board Delivery' })).toBeTruthy();
  });
});
