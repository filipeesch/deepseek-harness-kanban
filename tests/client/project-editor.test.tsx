// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { createDirectoryPicker } from '../../src/client/directory-picker.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);

async function openEditor(picker?: { pick(): Promise<string | null> }) {
  const mock = fakeApi();
  const user = userEvent.setup();
  render(<BoardView api={mock.api} {...(picker ? { picker } : {})} renderConversation={() => null} />);
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.click(screen.getByRole('button', { name: 'Configuration' }));
  await user.click(screen.getByRole('tab', { name: 'Projects' }));
  await user.click(screen.getByRole('button', { name: 'New project' }));
  return { mock, user };
}

describe('project editor detection', () => {
  it('runs detection when a typed absolute path loses focus', async () => {
    const { mock, user } = await openEditor();
    vi.mocked(mock.api.detectProject).mockResolvedValue({ kind: 'git', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' });
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo/apps/web');
    await user.click(screen.getByRole('textbox', { name: 'Project name' }));
    await waitFor(() => expect(mock.api.detectProject).toHaveBeenCalledWith('/repo/apps/web'));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Git root' }) as HTMLInputElement).value).toBe('/repo'));
    expect(screen.getByText('Git repository')).toBeTruthy();
    expect(screen.getByText('Suggested default branch: main')).toBeTruthy();
  });

  it('reports a picker failure without discarding the entered values', async () => {
    const picker = createDirectoryPicker({ desktop: async () => { throw new Error('panel crashed'); } });
    const { user } = await openEditor(picker);
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo/apps/worker');
    const browse = screen.getByRole('button', { name: 'Browse for project path' }) as HTMLButtonElement;
    expect(browse.disabled).toBe(false);
    await user.click(browse);
    await screen.findByText('DIRECTORY_PICKER_FAILED');
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Worker');
    expect((screen.getByRole('textbox', { name: 'Project path' }) as HTMLInputElement).value).toBe('/repo/apps/worker');
  });


  it('opens with empty values and an unavailable Save action', async () => {
    await openEditor();
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: 'Project path' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: 'Git root' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Save project' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Browse for project path' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No folder picker is available in this host; type an absolute path instead.')).toBeTruthy();
  });

  it('keeps the dialog open while a save is pending', async () => {
    const { mock, user } = await openEditor();
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo/apps/worker');
    let resolve!: (value: ReturnType<typeof fixture>) => void;
    mock.command.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('form', { name: 'New project' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Close New project' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve(fixture()); });
  });

  it('retains the entered values after a detection failure', async () => {
    const { mock, user } = await openEditor();
    vi.mocked(mock.api.detectProject).mockRejectedValueOnce({ code: 'PROBE_FAILED', message: 'The Git repository could not be inspected.' });
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker');
    await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/repo/apps/worker');
    await user.click(screen.getByRole('textbox', { name: 'Project name' }));
    await screen.findByText('PROBE_FAILED');
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('Worker');
    expect((screen.getByRole('textbox', { name: 'Project path' }) as HTMLInputElement).value).toBe('/repo/apps/worker');
  });

  it('removes a Git association by clearing the Git root', async () => {
    const { mock, user } = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit project Web' }));
    await user.clear(screen.getByRole('textbox', { name: 'Git root' }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.command).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'project.save', project: { id: 'p2', name: 'Web', projectPath: '/web' }, expectedRevision: 1,
    })));
  });

  it('shows the initial detection prompt before anything is chosen', async () => {
    await openEditor();
    expect(screen.getByText('Choose or type a project folder to detect its Git repository.')).toBeTruthy();
  });
});
