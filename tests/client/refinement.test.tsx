// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fixture, fakeApi } from './helpers.js';
import type { SessionTitles } from '../../src/client/drawer.js';

afterEach(cleanup);
beforeEach(() => { window.localStorage.clear(); if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent }); });
const native = (id: string) => <div data-testid={'native-' + id}>Native {id}</div>;
async function loaded() { await screen.findByRole('button', { name: 'Open task Alpha task' }); }
async function openAlpha(user: ReturnType<typeof userEvent.setup>) { await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Alpha task' })); }

describe('refined board interactions', () => {
  it('creates from the initial column and removes the board legend', async () => {
    render(<BoardView api={fakeApi().api} renderConversation={native} />); await loaded();
    const intake = screen.getByRole('region', { name: 'Intake column' });
    expect(within(intake).getByRole('button', { name: 'New task' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New task' })).toHaveLength(1);
    expect(screen.queryByText(/Execution is independent of workflow stage/)).toBeNull();
    expect(screen.getByRole('img', { name: 'Unread messages' })).toBeTruthy();
  });

  it('opens the whole card from the keyboard and shows header actions', async () => {
    const user = userEvent.setup(); render(<BoardView api={fakeApi().api} renderConversation={native} />); await loaded();
    const card = screen.getByRole('button', { name: 'Open task Alpha task' }); card.focus(); await user.keyboard('{Enter}');
    const close = await screen.findByRole('button', { name: 'Close task details' }); const drawer = close.closest('aside')!;
    expect(within(drawer).getByRole('heading', { name: 'Alpha task' })).toBeTruthy();
    expect(within(drawer).getByText('API')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Delete task' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Close task details' })).toBeTruthy();
  });

  it('drags a card with a ghost and drops it on another column', async () => {
    const mock = fakeApi(); render(<BoardView api={mock.api} renderConversation={native} />); await loaded();
    const card = screen.getByRole('button', { name: 'Open task Alpha task' });
    const doing = screen.getByRole('region', { name: 'Doing column' });
    const hit = vi.fn(() => doing); Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 20, pointerId: 1 });
    expect(document.querySelector('.kb-drag-ghost')).toBeTruthy();
    fireEvent.pointerUp(document, { clientX: 20, clientY: 20, pointerId: 1 });
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'doing', mode: 'move' }));
    expect(document.querySelector('.kb-drag-ghost')).toBeNull();
  });

  it('uses native session titles and renames through the native session face', async () => {
    const rename = vi.fn(async () => {});
    const titles: SessionTitles = { title: id => id === 's1' ? 'Planner' : undefined, rename };
    const user = userEvent.setup(); render(<BoardView api={fakeApi().api} sessionTitles={titles} renderConversation={native} />); await loaded();
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    expect(screen.getByRole('tab', { name: 'Planner' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Agent 2' })).toBeTruthy();
    await user.dblClick(screen.getByRole('tab', { name: 'Planner' }));
    const input = screen.getByRole('textbox', { name: 'Rename Planner' }); await user.clear(input); await user.type(input, 'Lead{Enter}');
    await waitFor(() => expect(rename).toHaveBeenCalledWith('s1', 'Lead'));
  });


  it('applies an optimistic move and restores the source when the host rejects it', async () => {
    const mock = fakeApi(); let reject!: (error: unknown) => void; mock.command.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
    render(<BoardView api={mock.api} renderConversation={native} />); await loaded();
    const card = screen.getByRole('button', { name: 'Open task Alpha task' });
    const doing = screen.getByRole('region', { name: 'Doing column' }); const intake = screen.getByRole('region', { name: 'Intake column' });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => doing });
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 20, pointerId: 1 });
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    await waitFor(() => expect(within(doing).getByRole('button', { name: 'Open task Alpha task' })).toBeTruthy());
    await act(async () => { reject({ code: 'MOVE_FAILED', message: 'Move rejected.' }); });
    await waitFor(() => expect(within(intake).getByRole('button', { name: 'Open task Alpha task' })).toBeTruthy());
  });

  it('uses native titles for closed conversations', async () => {
    const data = fixture(); data.state.tasks[0]!.closedSessionIds = ['s2'];
    const titles: SessionTitles = { title: id => id === 's2' ? 'Closed Planner' : undefined, rename: async () => {} };
    const user = userEvent.setup(); render(<BoardView api={fakeApi(data).api} sessionTitles={titles} renderConversation={native} />); await loaded();
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByText('Closed conversations (1)'));
    expect(screen.getByRole('button', { name: 'Reopen Closed Planner' })).toBeTruthy();
  });

  it('keeps cwd and the Info project duplicate out of the tab and Info surfaces', async () => {
    const user = userEvent.setup(); render(<BoardView api={fakeApi().api} renderConversation={native} />); await openAlpha(user);
    expect(screen.queryByText(/Agent cwd/)).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    expect(screen.queryByText('Effective agent directory')).toBeNull();
    expect(screen.queryByText(/Title and description can be edited/)).toBeNull();
  });

  it('exposes searchable local branches and secondary Git details', async () => {
    const user = userEvent.setup(); render(<BoardView api={fakeApi().api} renderConversation={native} />); await openAlpha(user);
    await user.click(screen.getByRole('tab', { name: 'Git' }));
    const source = screen.getByRole('combobox', { name: 'Source branch' }); const list = source.getAttribute('list');
    expect(list).toBeTruthy(); expect([...document.getElementById(list!)!.querySelectorAll('option')].map(option => option.value)).toEqual(['main', 'feature']);
    await user.click(screen.getByText('Details'));
    expect(screen.getByText('Base project path')).toBeTruthy(); expect(screen.getByText('Effective agent directory')).toBeTruthy(); expect(screen.getAllByText('/repo/apps/api').length).toBeGreaterThan(0);
  });

  it('shows accessible labels and tooltips on icon actions', async () => {
    render(<BoardView api={fakeApi().api} renderConversation={native} />); await loaded();
    expect(screen.getByRole('button', { name: 'Configuration' }).getAttribute('title')).toBe('Configuration');
    expect(screen.getByRole('button', { name: 'Select cards to delete' }).getAttribute('title')).toBe('Select cards to delete');
  });

  it('resizes the drawer, closes on the board background or Escape, and preserves an Info draft', async () => {
    const user = userEvent.setup(); render(<BoardView api={fakeApi().api} renderConversation={native} />); await openAlpha(user);
    const close = await screen.findByRole('button', { name: 'Close task details' }); const drawer = close.closest('aside')!;
    const handle = screen.getByRole('separator', { name: 'Resize task drawer' });
    fireEvent.pointerDown(handle, { clientX: 800 });
    fireEvent.pointerMove(window, { clientX: 700 });
    fireEvent.pointerUp(window, {});
    expect((drawer as HTMLElement).style.width).toBe('720px');
    expect(window.localStorage.getItem('dsh-kanban.drawer.width')).toBe('720');
    await user.click(screen.getByRole('tab', { name: 'Info' })); await user.click(screen.getByRole('button', { name: 'Edit' })); const title = screen.getByRole('textbox', { name: 'Title' }); await user.clear(title); await user.type(title, 'Draft Alpha');
    fireEvent.pointerDown(screen.getByLabelText('Workflow columns'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull());
    await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Info' }));
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Draft Alpha');
    await user.keyboard('{Escape}'); await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull());
  });
});
