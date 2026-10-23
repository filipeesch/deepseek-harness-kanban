// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);

function withBase() { const value = fixture(); value.state.settings = { worktreeBasePath: '/worktrees' }; return value; }
function mount(initial = withBase()) {
  const mock = fakeApi(initial); const user = userEvent.setup();
  render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />);
  return { ...mock, user };
}
async function openGit(user: ReturnType<typeof userEvent.setup>, title = 'Alpha task') {
  await screen.findByRole('button', { name: 'Open task ' + title });
  await user.click(screen.getByRole('button', { name: 'Open task ' + title }));
  await user.click(screen.getByRole('tab', { name: 'Git' }));
}
const branchField = () => screen.getByRole('textbox', { name: 'Branch name' }) as HTMLInputElement;
const pathField = () => screen.getByRole('textbox', { name: 'Worktree path' }) as HTMLInputElement;

describe('title-derived worktree defaults', () => {
  it('derives the default branch and destination from the title and base path', async () => {
    const { user } = mount(); await openGit(user);
    await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    expect(pathField().value).toBe('/worktrees/alpha-task');
    expect(screen.getByText(/Worktree destinations default to/)).toBeTruthy();
  });

  it('transliterates an accented task title', async () => {
    const initial = withBase(); initial.state.tasks[0]!.title = 'Criação de tarefas';
    const { user } = mount(initial); await openGit(user, 'Criação de tarefas');
    await waitFor(() => expect(branchField().value).toBe('criacao-de-tarefas'));
    expect(pathField().value).toBe('/worktrees/criacao-de-tarefas');
  });

  it('applies the host suggestion when both fields are untouched', async () => {
    const mock = fakeApi(withBase());
    vi.mocked(mock.api.worktreeDefault).mockResolvedValueOnce({ branchName: 'alpha-task-2', path: '/worktrees/alpha-task-2' });
    const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={() => null} />);
    await openGit(user);
    await waitFor(() => expect(branchField().value).toBe('alpha-task-2'));
    expect(pathField().value).toBe('/worktrees/alpha-task-2');
  });

  it('leaves the destination empty without a board base path', async () => {
    const initial = fixture(); const { user } = mount(initial); await openGit(user);
    await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    expect(pathField().value).toBe('');
    expect(screen.getByText(/A destination is required before creating a worktree/)).toBeTruthy();
  });

  it('updates an untouched destination when the branch changes', async () => {
    const { user } = mount(); await openGit(user); await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    await user.clear(branchField()); await user.type(branchField(), 'fix-login');
    expect(pathField().value).toBe('/worktrees/fix-login');
  });

  it('keeps a manually edited destination when the branch changes', async () => {
    const { user } = mount(); await openGit(user); await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    await user.clear(pathField()); await user.type(pathField(), '/custom/tree');
    await user.clear(branchField()); await user.type(branchField(), 'fix-login');
    expect(pathField().value).toBe('/custom/tree');
  });

  it('restores the joined destination with the reset action', async () => {
    const { user } = mount(); await openGit(user); await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    await user.clear(pathField()); await user.type(pathField(), '/custom/tree');
    await user.click(screen.getByRole('button', { name: 'Use default path' }));
    expect(pathField().value).toBe('/worktrees/alpha-task');
    await user.clear(branchField()); await user.type(branchField(), 'fix-login');
    expect(pathField().value).toBe('/worktrees/fix-login');
  });

  it('uses existing branches without a counter and syncs the destination', async () => {
    const { user, command } = mount(); await openGit(user); await screen.findByRole('button', { name: 'Refresh branches' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Branch mode' }), 'existing');
    const existing = screen.getByRole('combobox', { name: 'Existing branch' }) as HTMLInputElement;
    await waitFor(() => expect(existing.value).toBe('main'));
    await waitFor(() => expect(pathField().value).toBe('/worktrees/main'));
    await user.clear(existing); await user.type(existing, 'feature/work');
    expect(pathField().value).toBe('/worktrees/feature/work');
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'existing', branchName: 'feature/work', path: '/worktrees/feature/work' }));
  });

  it('restores the title-derived default when switching back to a new branch', async () => {
    const { user } = mount(); await openGit(user); await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    await screen.findByRole('button', { name: 'Refresh branches' });
    const mode = screen.getByRole('combobox', { name: 'Branch mode' });
    await user.selectOptions(mode, 'existing');
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Existing branch' }) as HTMLInputElement).value).toBe('main'));
    await user.selectOptions(mode, 'new');
    await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    expect(pathField().value).toBe('/worktrees/alpha-task');
  });

  it('sends the displayed manual values and surfaces a Git collision', async () => {
    const { user, command } = mount(); await openGit(user); await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    await user.clear(branchField()); await user.type(branchField(), 'fix-login');
    await user.clear(pathField()); await user.type(pathField(), '/worktrees/taken');
    command.mockRejectedValueOnce({ code: 'GIT_FAILED', message: 'A branch named fix-login already exists.' });
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', branchName: 'fix-login', sourceBranch: 'main', path: '/worktrees/taken' }));
    expect(await screen.findByText('A branch named fix-login already exists.')).toBeTruthy();
  });

  it('reports a suggestion failure and lets the user retry', async () => {
    const mock = fakeApi(withBase());
    vi.mocked(mock.api.worktreeDefault).mockRejectedValueOnce({ code: 'BRANCH_LOOKUP_FAILED', message: 'Branch lookup is unavailable.' });
    const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={() => null} />);
    await openGit(user);
    expect(await screen.findByText('Branch lookup is unavailable.')).toBeTruthy();
    expect(branchField().value).toBe('alpha-task');
    await user.click(screen.getByRole('button', { name: 'Retry suggestion' }));
    await waitFor(() => expect(mock.api.worktreeDefault).toHaveBeenCalledTimes(2));
  });

  it('does not rename an existing worktree when the task title changes', async () => {
    const { user } = mount(); await screen.findByRole('button', { name: 'Open task Beta task' });
    await user.click(screen.getByRole('button', { name: 'Open task Beta task' }));
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(title); await user.type(title, 'Updated Beta');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    await screen.findByText('Task saved.');
    await user.click(screen.getByRole('tab', { name: 'Git' }));
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.getAllByText('/trees/beta').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox', { name: 'Worktree path' })).toBeNull();
  });

  it('allows an empty source branch and lets the host fall back', async () => {
    const { user, command } = mount(); await openGit(user); await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    const source = screen.getByRole('combobox', { name: 'Source branch' }) as HTMLInputElement;
    await user.clear(source);
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', branchName: 'alpha-task', path: '/worktrees/alpha-task' }));
  });

  it('shares the same defaults between the conversation notice and Git', async () => {
    const { user } = mount(); await screen.findByRole('button', { name: 'Open task Alpha task' }); await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    const notice = screen.getByRole('note', { name: 'Worktree not created' });
    expect(within(notice).getByText('alpha-task')).toBeTruthy();
    expect(within(notice).getByText('/worktrees/alpha-task')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Git' }));
    await waitFor(() => expect(branchField().value).toBe('alpha-task'));
    expect(pathField().value).toBe('/worktrees/alpha-task');
  });
});
