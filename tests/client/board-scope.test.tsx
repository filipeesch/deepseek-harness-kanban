// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { PresetProvider } from './agent-preset-fixture.js';
import { TeamSettings } from '../../src/client/settings/team-settings/team-settings.js';
import { HubPublishingBadge } from '../../src/client/sharing/indicators.js';
import type { HubSharingView } from '../../src/shared/types.js';
import { fakeApi, fixture, type TestSnapshot } from './helpers.js';

afterEach(cleanup);

function restricted(keys: string[]): TestSnapshot {
  const value = fixture();
  value.state.hubs[0]!.boards[0]!.allowedProjectKeys = keys;
  return value;
}

async function mount(value: TestSnapshot) {
  const mock = fakeApi(value);
  const user = userEvent.setup();
  render(<PresetProvider><BoardView api={mock.api} renderConversation={() => null} /></PresetProvider>);
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  return { ...mock, user };
}

async function openConfiguration(user: ReturnType<typeof userEvent.setup>, section: string) {
  await user.click(screen.getByRole('button', { name: 'Configuration' }));
  await user.click(await screen.findByRole('tab', { name: section }));
}

describe('board project scope in the client', () => {
  it('offers only the projects the board allows when creating a task', async () => {
    const { user } = await mount(restricted(['p1']));
    await user.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(within(dialog).getAllByRole('option').map(option => option.textContent)).toEqual(['Select a project', 'API']);
  });

  it('explains a board that allows no project and withholds creation', async () => {
    const { user } = await mount(restricted([]));
    await user.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByText(/accepts no new task/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the selected projects for the board', async () => {
    const { user, command } = await mount(fixture());
    await openConfiguration(user, 'Board');
    const scope = await screen.findByRole('group', { name: 'Board project scope' });
    await user.click(within(scope).getByRole('radio', { name: /Selected projects/ }));
    await user.click(within(scope).getByRole('checkbox', { name: /API/ }));
    await user.click(within(scope).getByRole('button', { name: 'Save project scope' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({
      type: 'board.projects.save', hubId: 'hub-1', boardId: 'board-1', projectKeys: ['p1'], expectedRevision: 1,
    }));
  });

  it('clears the restriction when every project is allowed', async () => {
    const { user, command } = await mount(restricted(['p1']));
    await openConfiguration(user, 'Board');
    const scope = await screen.findByRole('group', { name: 'Board project scope' });
    await user.click(within(scope).getByRole('radio', { name: /All projects/ }));
    await user.click(within(scope).getByRole('button', { name: 'Save project scope' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({
      type: 'board.projects.save', hubId: 'hub-1', boardId: 'board-1', expectedRevision: 1,
    }));
  });

  it('warns when the selected scope allows no project', async () => {
    const { user } = await mount(restricted(['p1']));
    await openConfiguration(user, 'Board');
    const scope = await screen.findByRole('group', { name: 'Board project scope' });
    await user.click(within(scope).getByRole('checkbox', { name: /API/ }));
    expect(within(scope).getByRole('status').textContent).toContain('accepts no new task');
  });

  it('offers only the projects with cards on the board in the filter', async () => {
    const value = restricted([]);
    const hub = value.state.hubs[0]!;
    // A project that exists in the Hub but holds no card on this board.
    hub.projects.push({ id: 'p3', projectKey: 'p3', name: 'Docs', projectPath: '/docs' });
    const { user } = await mount(value);
    await user.click(screen.getByRole('button', { name: /^Filter tasks/ }));
    const options = within(screen.getByRole('dialog', { name: 'Filter tasks' })).getAllByRole('option').map(option => option.textContent);
    expect(options).toEqual(['All projects', 'API', 'Web']);
  });
});

describe('scope changes while the client is open', () => {
  it('does not let an open scope form overwrite a newer team change', async () => {
    const { user, publish } = await mount(restricted(['p1']));
    await openConfiguration(user, 'Board');
    const scope = await screen.findByRole('group', { name: 'Board project scope' });
    await user.click(within(scope).getByRole('checkbox', { name: /Web/ }));
    // A synchronization lands while the form still holds the old selection.
    const next = fixture();
    next.state.hubs[0]!.revision = 5;
    next.state.hubs[0]!.boards[0]!.allowedProjectKeys = ['p2'];
    next.stateRevision = 5;
    publish(next);
    const stale = await screen.findByRole('group', { name: 'Board project scope' });
    await waitFor(() => expect(within(stale).getByRole('alert')).toBeTruthy());
    expect((within(stale).getByRole('button', { name: 'Save project scope' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(stale).getByRole('button', { name: 'Reload scope' }));
    expect(within(screen.getByRole('group', { name: 'Board project scope' })).queryByRole('alert')).toBeNull();
    expect((screen.getByRole('checkbox', { name: /Web/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /API/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('stops creating when the board closes while the dialog is open', async () => {
    const { user, publish } = await mount(fixture());
    await user.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Racy task');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project' }), 'p1');
    const next = fixture();
    next.state.hubs[0]!.revision = 5;
    next.state.hubs[0]!.boards[0]!.allowedProjectKeys = [];
    next.stateRevision = 5;
    publish(next);
    await waitFor(() => expect(within(dialog).getByText(/accepts no new task/)).toBeTruthy());
    expect((within(dialog).getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('published project adoption', () => {
  it('exposes the key and adopts a placeholder by choosing its directory', async () => {
    const value = fixture();
    value.state.hubs[0]!.projects.push({ id: 'p3', name: 'ops', projectKey: 'ops', origin: 'published' });
    const { user, command } = await mount(value);
    await openConfiguration(user, 'Projects');
    await user.click(await screen.findByRole('button', { name: 'Edit project ops' }));
    expect(screen.getByText('Awaiting adoption')).toBeTruthy();
    const dialog = screen.getByRole('dialog', { name: 'Adopt published project' });
    expect((within(dialog).getByRole('textbox', { name: 'Project key' }) as HTMLInputElement).value).toBe('ops');
    expect(within(dialog).getByText(/has no directory yet/)).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'Project path' }), '/repo/ops');
    await user.click(within(dialog).getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project.save',
      project: expect.objectContaining({ id: 'p3', projectKey: 'ops', projectPath: '/repo/ops' }),
    })));
  });
});

describe('outdated team configuration', () => {
  const sharing: HubSharingView = {
    status: 'unavailable', provider: 'git', providerLabel: 'Git', address: 'team/repo', repository: 'team/repo',
    syncMode: 'explicit', intervalMinutes: 0, drafts: 0, pending: 0, updates: 0, conflicts: 0, orderChanged: false,
    syncing: false, boards: [], incoming: [], removed: [], blockers: [], removing: [],
    error: { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.' },
  };

  it('asks for a plugin update in the Team Settings panel', () => {
    render(<TeamSettings hub={fixture().state.hubs[0]!} sharing={sharing} />);
    expect(screen.getByText('Update the plugin')).toBeTruthy();
    expect(screen.getAllByText(/newer plugin version/).length).toBeGreaterThan(0);
  });

  it('clears the warning for a supported document', () => {
    render(<TeamSettings hub={fixture().state.hubs[0]!} sharing={{ ...sharing, status: 'published', error: undefined }} />);
    expect(screen.queryByText('Update the plugin')).toBeNull();
  });

  it('carries the update message on the Hub publishing indicator', () => {
    render(<HubPublishingBadge view={sharing} />);
    const badge = screen.getByRole('img', { name: 'Team updates unavailable' });
    expect(badge.getAttribute('title')).toContain('newer plugin version');
  });
});
