// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);

async function openProjects() {
  const mock = fakeApi();
  const user = userEvent.setup();
  render(<BoardView api={mock.api} renderConversation={() => null} />);
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.click(screen.getByRole('button', { name: 'Configuration' }));
  await user.click(screen.getByRole('tab', { name: 'Projects' }));
  return { mock, user };
}

describe('project registry list', () => {
  it('lists Git-backed and folder projects with their indication', async () => {
    const data = fixture();
    data.state.projects.push({ id: 'p3', name: 'Notes', projectPath: '/plain/notes' });
    const mock = fakeApi(data); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Configuration' }));
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    const api = screen.getByRole('button', { name: 'Edit project API' }).closest('li')!;
    const notes = screen.getByRole('button', { name: 'Edit project Notes' }).closest('li')!;
    expect(within(api).getByText('Git')).toBeTruthy();
    expect(within(notes).getByText('Folder')).toBeTruthy();
  });

  it('does not embed the create or edit form in the section', async () => {
    await openProjects();
    expect(screen.queryByRole('form', { name: 'New project' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Edit project' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy();
  });
});
