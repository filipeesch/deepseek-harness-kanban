// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { HubSharingView, HubState } from '../../src/shared/types.js';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

beforeEach(() => { try { globalThis.localStorage?.clear(); } catch { /* jsdom storage optional */ } });
afterEach(cleanup);

function sharingView(overrides: Partial<HubSharingView> = {}): HubSharingView {
  return {
    status: 'published', provider: 'git', providerLabel: 'Git repository', supportsFiles: true,
    repository: 'https://example.test/team.git', address: 'https://example.test/team.git', syncMode: 'explicit', intervalMinutes: 5,
    drafts: 0, pending: 0, updates: 2, conflicts: 0, orderChanged: false, syncing: false,
    boards: [], incoming: [], removed: [], blockers: [], removing: [], ...overrides,
  } as HubSharingView;
}

function secondHub(): HubState {
  return { id: 'hub-2', name: 'Second Hub', revision: 0, projects: [], boards: [], tasks: [], notes: [], createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' };
}

describe('board failure notice', () => {
  it('is dismissible, replaced by the next failure, and gone after a reload', async () => {
    const mock = fakeApi();
    const user = userEvent.setup();
    const mounted = render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    const autoMode = () => document.querySelector<HTMLButtonElement>('.kb-auto-chip')!;
    mock.command.mockRejectedValueOnce({ code: 'TASK_BUSY', message: 'Resolve the confirmed transition first.' });
    await user.click(autoMode());
    expect(await screen.findByText('TASK_BUSY')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss the board failure notice' }));
    expect(screen.queryByText('TASK_BUSY')).toBeNull();
    // The next failure replaces the dismissed one instead of staying hidden.
    mock.command.mockRejectedValueOnce({ code: 'TASK_CHANGED', message: 'The task changed.' });
    await user.click(autoMode());
    expect(await screen.findByText('TASK_CHANGED')).toBeTruthy();
    expect(screen.queryByText('TASK_BUSY')).toBeNull();
    mounted.unmount();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    expect(screen.queryByText('TASK_CHANGED')).toBeNull();
  });
});

describe('team-changes banner', () => {
  it('is dismissed per Hub for the page session and returns on a reload', async () => {
    const data = fixture();
    data.sharing = { 'hub-1': sharingView() };
    (data.state.hubs as HubState[]).push(secondHub());
    const mock = fakeApi(data);
    const user = userEvent.setup();
    const first = render(<BoardView api={mock.api} renderConversation={() => null} />);
    expect(await screen.findByText('Your team published changes to this Hub.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss team changes' }));
    expect(screen.queryByText('Your team published changes to this Hub.')).toBeNull();
    // Dismissing acknowledges the banner only; the team state itself is untouched.
    expect(mock.get().sharing['hub-1']?.updates).toBe(2);
    expect(mock.api.sharing).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: /Second Hub/ }));
    expect(screen.queryByText('Your team published changes to this Hub.')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /My Hub/ }));
    await waitFor(() => expect(screen.queryByText('Your team published changes to this Hub.')).toBeNull());
    // A reload starts a new page session, so the banner is presented again.
    first.unmount();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    expect(await screen.findByText('Your team published changes to this Hub.')).toBeTruthy();
  });
});
