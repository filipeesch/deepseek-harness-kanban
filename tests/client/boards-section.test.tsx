// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

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
