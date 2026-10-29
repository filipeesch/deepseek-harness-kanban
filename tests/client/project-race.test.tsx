// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);

async function openProjects(picker?: { pick(): Promise<string | null> }) {
  const mock = fakeApi();
  const user = userEvent.setup();
  const view = render(<BoardView api={mock.api} {...(picker ? { picker } : {})} renderConversation={() => null} />);
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.click(screen.getByRole('button', { name: 'Configuration' }));
  await user.click(screen.getByRole('tab', { name: 'Projects' }));
  await user.click(screen.getByRole('button', { name: 'New project' }));
  return { mock, user, view };
}

describe('project detection in the editor', () => {
  it('fills the project path, Git root, and name from the picked folder', async () => {
    const pick = vi.fn(async () => '/repo/apps/web');
    const { mock, user } = await openProjects({ pick });
    vi.mocked(mock.api.detectProject).mockResolvedValue({ kind: 'git', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' });
    await user.click(screen.getByRole('button', { name: 'Browse for project path' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Project path' }) as HTMLInputElement).value).toBe('/repo/apps/web'));
    expect((screen.getByRole('textbox', { name: 'Git root' }) as HTMLInputElement).value).toBe('/repo');
    expect((screen.getByRole('textbox', { name: 'Default branch (optional)' }) as HTMLInputElement).value).toBe('main');
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('web');
    expect(mock.api.detectProject).toHaveBeenCalledWith('/repo/apps/web');
  });

  it('keeps a manually edited Git root when detection runs again', async () => {
    const pick = vi.fn(async () => '/repo/apps/web');
    const { mock, user } = await openProjects({ pick });
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo/apps/web');
    await user.clear(screen.getByRole('textbox', { name: 'Git root' }));
    await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/custom/root');
    vi.mocked(mock.api.detectProject).mockResolvedValue({ kind: 'git', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' });
    await user.click(screen.getByRole('button', { name: 'Browse for project path' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Default branch (optional)' }) as HTMLInputElement).value).toBe('main'));
    expect((screen.getByRole('textbox', { name: 'Git root' }) as HTMLInputElement).value).toBe('/custom/root');
  });

  it('presents the folder outcome and saves without a Git root', async () => {
    const pick = vi.fn(async () => '/plain/notes');
    const { mock, user } = await openProjects({ pick });
    vi.mocked(mock.api.detectProject).mockResolvedValue({ kind: 'folder', projectPath: '/plain/notes' });
    await user.click(screen.getByRole('button', { name: 'Browse for project path' }));
    await screen.findByText('No Git repository found');
    expect((screen.getByRole('textbox', { name: 'Git root' }) as HTMLInputElement).value).toBe('');
    await user.clear(screen.getByRole('textbox', { name: 'Project name' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Notes');
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project.save', project: { name: 'Notes', projectPath: '/plain/notes' }, expectedRevision: 1,
    })));
  });
});

describe('project editor lifetime during save', () => {
  it('keeps the dialog, draft, and error when the save fails', async () => {
    const { mock, user } = await openProjects();
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Created X');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/projects/x');
    await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/projects');
    mock.command.mockRejectedValueOnce({ code: 'SAVE_FAILED', message: 'The save could not complete.' });
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await screen.findByText('SAVE_FAILED');
    expect(screen.getByRole('form', { name: 'New project' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Created X');
    expect((screen.getByRole('textbox', { name: 'Git root' }) as HTMLInputElement).value).toBe('/projects');
  });

  it('blocks a repeated save after a missing creation receipt', async () => {
    const { mock, user } = await openProjects();
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Created X');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/projects/x');
    await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/projects');
    const withoutReceipt: KanbanSnapshot = fixture();
    mock.command.mockResolvedValueOnce(withoutReceipt);
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await screen.findByText('CREATION_RECEIPT_REQUIRED');
    expect((screen.getByRole('button', { name: 'Save project' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.command).toHaveBeenCalledTimes(1);
  });

  it('blocks a save whose created project is missing from the snapshot', async () => {
    const { mock, user } = await openProjects();
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Created X');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/projects/x');
    await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/projects');
    const withoutProject = fixture();
    withoutProject.commandReceipt = { kind: 'project', id: 'missing' };
    mock.command.mockResolvedValueOnce(withoutProject);
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await screen.findByText('CREATED_PROJECT_UNAVAILABLE');
    expect((screen.getByRole('button', { name: 'Save project' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ignores a late save completion after the editor unmounts', async () => {
    const { mock, user, view } = await openProjects();
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Created X');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/projects/x');
    await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/projects');
    let resolve!: (value: KanbanSnapshot) => void;
    mock.command.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    view.unmount();
    await act(async () => { resolve(fixture()); });
    expect(mock.command).toHaveBeenCalledTimes(1);
  });

  it('closes on cancel without sending a command', async () => {
    const { mock, user } = await openProjects();
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Discarded');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New project' })).toBeNull();
    expect(mock.command).not.toHaveBeenCalled();
  });

  it('edits an existing project with its stored values', async () => {
    const { mock, user } = await openProjects();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit project Web' }));
    expect((screen.getByRole('textbox', { name: 'Project path' }) as HTMLInputElement).value).toBe('/web');
    expect((screen.getByRole('textbox', { name: 'Git root' }) as HTMLInputElement).value).toBe('/web');
    await user.clear(screen.getByRole('textbox', { name: 'Project name' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Updated Web');
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.command).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'project.save', project: { id: 'p2', name: 'Updated Web', projectPath: '/web', gitRootPath: '/web', defaultBranch: 'main' },
    })));
  });
});

describe('project registration deletion', () => {
  it('requires inline confirmation and deletes an unused project registration', async () => {
    const initial = fixture(); initial.state.tasks = [];
    const mock = fakeApi(initial); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Configuration' }); await user.click(screen.getByRole('button', { name: 'Configuration' })); await user.click(screen.getByRole('tab', { name: 'Projects' }));
    expect((screen.getByRole('button', { name: 'Delete project API' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Delete project API' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm deleting project API' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete project' }));
    await screen.findByText('Project deleted.');
    expect(mock.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.delete', projectId: 'p1', confirmed: true, expectedRevision: 1 }));
  });

  it('disables deletion for a project that still has tasks', async () => {
    const mock = fakeApi(); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Configuration' })); await user.click(screen.getByRole('tab', { name: 'Projects' }));
    expect((screen.getByRole('button', { name: 'Delete project API' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
