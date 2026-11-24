// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { PresetProvider } from './agent-preset-fixture.js';
import { fakeApi, fixture, type TestSnapshot } from './helpers.js';

afterEach(cleanup);

/** A Hub that received a team board scoped to a project it does not have. */
function received(): TestSnapshot {
  const value = fixture();
  value.state.hubs[0]!.projects.push({ id: 'p-ops', name: 'Ops', projectKey: 'ops', origin: 'published' });
  value.state.hubs[0]!.boards[0]!.allowedProjectKeys = ['ops'];
  return value;
}

async function mount(value: TestSnapshot) {
  const mock = fakeApi(value);
  const user = userEvent.setup();
  render(<PresetProvider><BoardView api={mock.api} renderConversation={() => null} /></PresetProvider>);
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  return { ...mock, user };
}

async function openConfiguration(user: ReturnType<typeof userEvent.setup>, section: string, panel?: string) {
  await user.click(screen.getByRole('button', { name: 'Configuration' }));
  const top = () => within(screen.getByRole('tablist', { name: 'Configuration sections' }));
  await user.click(await top().findByRole('tab', { name: section === 'Board' ? 'Boards' : section }));
  if (panel !== undefined) {
    await user.click(await screen.findByRole('button', { name: /^Edit board / }));
    const board = within(screen.getByRole('tablist', { name: 'Board configuration sections' }));
    await user.click(await board.findByRole('tab', { name: panel }));
  }
}

describe('projects awaiting adoption', () => {
  it('summarizes the identities and names the boards that use them', async () => {
    const { user } = await mount(received());
    await openConfiguration(user, 'Projects');
    expect(screen.getByText(/One project awaits adoption/)).toBeTruthy();
    expect(screen.getByText(/Named by: Delivery/)).toBeTruthy();
    expect(screen.getByText('Awaiting adoption')).toBeTruthy();
  });

  it('ignores a received identity, then restores it', async () => {
    const { user, command } = await mount(received());
    await openConfiguration(user, 'Projects');
    await user.click(screen.getByRole('button', { name: 'Ignore Ops' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Confirm ignoring Ops' });
    expect(within(confirm).getByText(/keep naming/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Ignore project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.dismiss', projectId: 'p-ops', dismissed: true })));
    expect(await screen.findByText('Ignored project identities')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore Ops' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.dismiss', projectId: 'p-ops', dismissed: false })));
  });

  it('links a received identity to a project the Hub already has', async () => {
    // The board also names the project's previous identity, so linking rewrites that scope.
    const value = received();
    value.state.hubs[0]!.boards[0]!.allowedProjectKeys = ['p1', 'ops'];
    const { user, command } = await mount(value);
    await openConfiguration(user, 'Projects');
    await user.click(screen.getByRole('button', { name: 'Link Ops to a project' }));
    const dialog = screen.getByRole('dialog', { name: 'Link Ops to a project' });
    expect(within(dialog).getByText(/Boards name this project by/)).toBeTruthy();
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project to link' }), 'p1');
    expect(within(dialog).getByText(/One board scope is rewritten/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Link project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project.save',
      project: expect.objectContaining({ id: 'p1', publishedKey: 'ops' }),
    })));
  });

  it('locks both keys while adopting a received identity', async () => {
    const { user } = await mount(received());
    await openConfiguration(user, 'Projects');
    await user.click(screen.getByRole('button', { name: 'Adopt Ops' }));
    const dialog = screen.getByRole('dialog', { name: 'Adopt published project' });
    expect((within(dialog).getByRole('textbox', { name: 'Project key' }) as HTMLInputElement).disabled).toBe(true);
    expect((within(dialog).getByRole('textbox', { name: 'Team key (optional)' }) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText(/adopting keeps the local key and the identity the board scopes use/)).toBeTruthy();
  });

  it('shows the team key in the project editor and saves a change to it', async () => {
    const value = fixture();
    value.state.hubs[0]!.projects[0]!.publishedKey = 'team-api';
    const { user, command } = await mount(value);
    await openConfiguration(user, 'Projects');
    await user.click(screen.getByRole('button', { name: 'Edit project API' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    const field = within(dialog).getByRole('textbox', { name: 'Team key (optional)' }) as HTMLInputElement;
    expect(field.value).toBe('team-api');
    await user.clear(field);
    await user.type(field, 'platform-api');
    await user.click(within(dialog).getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project.save',
      project: expect.objectContaining({ id: 'p1', publishedKey: 'platform-api' }),
    })));
  });

  it('clears the team key from the project editor', async () => {
    const value = fixture();
    value.state.hubs[0]!.projects[0]!.publishedKey = 'team-api';
    const { user, command } = await mount(value);
    await openConfiguration(user, 'Projects');
    await user.click(screen.getByRole('button', { name: 'Edit project API' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    await user.clear(within(dialog).getByRole('textbox', { name: 'Team key (optional)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project.save',
      project: expect.objectContaining({ id: 'p1', publishedKey: '' }),
    })));
  });

  it('hides the Team Settings pointer when nothing awaits adoption', async () => {
    const { user } = await mount(fixture());
    await openConfiguration(user, 'Team Settings');
    expect(screen.queryByRole('button', { name: 'Open Projects' })).toBeNull();
    expect(screen.queryByText(/await adoption/)).toBeNull();
  });

  it('marks an ignored placeholder in the board scope form', async () => {
    const value = fixture();
    value.state.hubs[0]!.projects.push({ id: 'p-old', name: 'Old', projectKey: 'old', origin: 'published', dismissed: true });
    value.state.hubs[0]!.boards[0]!.allowedProjectKeys = ['p1', 'old'];
    const { user } = await mount(value);
    await openConfiguration(user, 'Board', 'Projects');
    const scope = await screen.findByRole('group', { name: 'Board project scope' });
    expect(within(scope).getByText(/old · ignored/)).toBeTruthy();
  });

  it('names the scope by the published identity and marks the placeholder', async () => {
    const value = fixture();
    value.state.hubs[0]!.projects[0]!.publishedKey = 'team-api';
    value.state.hubs[0]!.projects.push({ id: 'p-ops', name: 'Ops', projectKey: 'ops', origin: 'published' });
    value.state.hubs[0]!.boards[0]!.allowedProjectKeys = ['team-api', 'ops'];
    const { user } = await mount(value);
    await openConfiguration(user, 'Board', 'Projects');
    const scope = await screen.findByRole('group', { name: 'Board project scope' });
    expect(within(scope).getByText(/team-api/)).toBeTruthy();
    expect(within(scope).getByText(/ops · awaiting adoption/)).toBeTruthy();
  });

  it('points to Projects from Team Settings while an identity awaits adoption', async () => {
    const { user } = await mount(received());
    await user.click(screen.getByRole('button', { name: 'Configuration' }));
    const top = () => within(screen.getByRole('tablist', { name: 'Configuration sections' }));
    await user.click(await top().findByRole('tab', { name: 'Team Settings' }));
    expect(screen.getByText(/awaits adoption/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open Projects' }));
    expect(await screen.findByRole('button', { name: 'Adopt Ops' })).toBeTruthy();
  });
});
