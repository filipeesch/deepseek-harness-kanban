// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView, createBoardPageState } from '../../src/client/board.js';
import type { HubState } from '../../src/shared/types.js';
import { fakeApi, fixture, openFilterPopover, task, type TestSnapshot } from './helpers.js';

afterEach(cleanup);

/** A Hub and a board to navigate to, so a filter can be checked against navigation. */
function fixtureWithScope(): TestSnapshot {
  const value = fixture();
  const hub = value.state.hubs[0]!;
  const secondBoard = { ...hub.boards[0]!, id: 'board-2', name: 'Ops' };
  hub.boards.push(secondBoard);
  // The project filter offers the projects the presented board already holds cards for,
  // so the navigation fixture needs a card on the second board too.
  hub.tasks.push({ ...task('ops-task', 'Ops task', 'p1', secondBoard.workflow.initialColumnId), boardId: secondBoard.id });
  const other: HubState = { ...structuredClone(hub), id: 'hub-2', name: 'Other Hub', boards: [secondBoard], tasks: [] };
  value.state.hubs.push(other);
  return value;
}

async function mountBoard(value = fixture()) {
  const mock = fakeApi(value);
  const pageState = createBoardPageState();
  const user = userEvent.setup();
  render(<BoardView api={mock.api} pageState={pageState} renderConversation={() => null} />);
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  return { mock, pageState, user };
}

function trigger() {
  return screen.getByRole('button', { name: /^Filter tasks/ });
}

describe('board filter control', () => {
  it('opens both filter inputs on the funnel and puts focus on the search field', async () => {
    const { user } = await mountBoard();
    expect(screen.queryByRole('searchbox', { name: 'Search tasks' })).toBeNull();
    await openFilterPopover(user);
    expect(screen.getByRole('dialog', { name: 'Filter tasks' })).toBeTruthy();
    const search = screen.getByRole('searchbox', { name: 'Search tasks' });
    expect(screen.getByRole('combobox', { name: 'Project filter' })).toBeTruthy();
    expect(search).toBe(document.activeElement);
  });

  it('filters as the inputs change, without an apply step', async () => {
    const { user, pageState } = await mountBoard();
    await openFilterPopover(user);
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'documentation');
    expect(pageState.search).toBe('documentation');
    expect(screen.getByRole('button', { name: 'Open task Beta task' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open task Alpha task' })).toBeNull();
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
    // The popover stays open so the board can be narrowed further.
    expect(screen.getByRole('dialog', { name: 'Filter tasks' })).toBeTruthy();
  });

  it('clears both filters, closes, and returns focus to the funnel', async () => {
    const { user, pageState } = await mountBoard();
    await openFilterPopover(user);
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'documentation');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project filter' }), 'p1');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByRole('dialog', { name: 'Filter tasks' })).toBeNull();
    expect(pageState.search).toBe('');
    expect(pageState.projectFilter).toBe('');
    expect(screen.getByRole('button', { name: 'Open task Alpha task' })).toBeTruthy();
    expect(trigger()).toBe(document.activeElement);
  });

  it('keeps the filters when the popover is closed without clearing', async () => {
    const { user, pageState } = await mountBoard();
    await openFilterPopover(user);
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'documentation');
    await user.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.queryByRole('dialog', { name: 'Filter tasks' })).toBeNull();
    expect(pageState.search).toBe('documentation');
    expect(screen.queryByRole('button', { name: 'Open task Alpha task' })).toBeNull();
  });

  it('shows no indicator while no filter is active, including blank search', async () => {
    const { user } = await mountBoard();
    expect(trigger().getAttribute('aria-label')).toBe('Filter tasks');
    await openFilterPopover(user);
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), '   ');
    expect(document.querySelector('.kb-filter-dot')).toBeNull();
    expect(document.querySelector('.kb-filter-badge')).toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('Filter tasks');
  });

  it('marks one active filter with a dot and both with the numeral two', async () => {
    const { user } = await mountBoard();
    await openFilterPopover(user);
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Alpha');
    expect(document.querySelector('.kb-filter-dot')).toBeTruthy();
    expect(document.querySelector('.kb-filter-badge')).toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('Filter tasks, filtering by search text');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Project filter' }), 'p1');
    expect(document.querySelector('.kb-filter-dot')).toBeNull();
    expect(document.querySelector('.kb-filter-badge')?.textContent).toBe('2');
    expect(trigger().getAttribute('aria-label')).toBe('Filter tasks, filtering by search text and project');
  });

  it('leaves the funnel out of the toolbar while cards are being selected', async () => {
    const { user } = await mountBoard();
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    expect(screen.getByText('0 selected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Filter tasks/ })).toBeNull();
  });

  it('closes and resets the filters when the Hub or board changes', async () => {
    const { user, pageState } = await mountBoard(fixtureWithScope());

    // Both filters at once: the reset has to clear everything the indicator counts as two.
    const raiseBothFilters = async () => {
      await openFilterPopover(user);
      await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Alpha');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Project filter' }), 'p1');
      expect(screen.getByRole('button', { name: /^Filter tasks, filtering by search text and project/ })).toBeTruthy();
      expect(document.querySelector('.kb-filter-badge')?.textContent).toBe('2');
    };

    await raiseBothFilters();
    await user.click(screen.getByRole('tab', { name: 'Ops' }));
    expect(screen.queryByRole('dialog', { name: 'Filter tasks' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Ops' }).getAttribute('aria-selected')).toBe('true');
    expect(pageState.search).toBe('');
    expect(pageState.projectFilter).toBe('');
    expect(document.querySelector('.kb-filter-badge')).toBeNull();
    expect(document.querySelector('.kb-filter-dot')).toBeNull();

    await raiseBothFilters();
    await user.click(screen.getByRole('tab', { name: /Other Hub/ }));
    expect(screen.queryByRole('dialog', { name: 'Filter tasks' })).toBeNull();
    expect(pageState.search).toBe('');
    expect(pageState.projectFilter).toBe('');
    expect(document.querySelector('.kb-filter-badge')).toBeNull();
    expect(document.querySelector('.kb-filter-dot')).toBeNull();
  });
});
