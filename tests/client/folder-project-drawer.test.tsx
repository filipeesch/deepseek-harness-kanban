// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture, task } from './helpers.js';

afterEach(cleanup);

function folderFixture() {
  const data = fixture();
  const hub = data.state.hubs[0]!;
  const web = hub.projects.find(project => project.id === 'p2')!;
  delete web.gitRootPath;
  delete web.defaultBranch;
  hub.projects.push({ id: 'p3', name: 'Notes', projectPath: '/plain/notes' });
  hub.tasks.push({ ...task('t3', 'Gamma task', 'p3', 'intake'), effectiveCwd: '/plain/notes', worktree: null });
  return data;
}

async function open(taskName: string) {
  const mock = fakeApi(folderFixture());
  const user = userEvent.setup();
  render(<BoardView api={mock.api} renderConversation={() => null} />);
  await screen.findByRole('button', { name: 'Open task ' + taskName });
  await user.click(screen.getByRole('button', { name: 'Open task ' + taskName }));
  return { mock, user };
}

describe('Git affordances for folder projects', () => {
  it('hides the Git section and the worktree notice, and explains the plain checkout', async () => {
    await open('Beta task');
    expect(screen.queryByRole('tab', { name: 'Git' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Conversations' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Info' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Notes' })).toBeTruthy();
    expect(screen.queryByRole('note', { name: 'Worktree not created' })).toBeNull();
    expect(screen.getByRole('note', { name: 'Plain checkout' })).toBeTruthy();
  });

  it('keeps every section for a Git-backed project', async () => {
    await open('Alpha task');
    expect(screen.getByRole('tab', { name: 'Git' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Notes' })).toBeTruthy();
  });

  it('offers no worktree notice for a folder project without a checkout', async () => {
    await open('Gamma task');
    expect(screen.queryByRole('note', { name: 'Worktree not created' })).toBeNull();
    expect(screen.queryByRole('note', { name: 'Plain checkout' })).toBeNull();
  });

  it('states in the delete confirmation that the checkout stays on disk', async () => {
    const { user } = await open('Beta task');
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    expect(dialog.textContent).toContain('is no longer Git-managed and will remain on disk');
  });

  it('reports the retained checkout path after the task is deleted', async () => {
    const { user } = await open('Beta task');
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    await screen.findByText(/was left on disk/);
  });
});
