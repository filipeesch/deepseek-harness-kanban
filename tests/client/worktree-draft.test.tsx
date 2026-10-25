// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ClientApi, CreateWorktree } from '../../src/shared/types.js';
import { cleanWorktree, initialWorktree, useWorktreeDraft, validWorktree } from '../../src/client/worktree-draft.js';
import { WorktreeNotice } from '../../src/client/worktree-notice.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
const task = fixture().state.tasks[0]!;
const project = fixture().state.projects[0]!;

describe('worktree draft helpers', () => {
  it('derives a title branch and base-path destination with the project source', () => {
    expect(initialWorktree({ ...task, title: 'Criação de tarefas' }, project, '/worktrees')).toEqual({ mode: 'new', branchName: 'criacao-de-tarefas', path: '/worktrees/criacao-de-tarefas', sourceBranch: 'main' });
  });
  it('accepts an omitted source for the host fallback and normalizes the command', () => {
    expect(validWorktree({ mode: 'new', branchName: 'fix', path: '/tree' })).toBe(true);
    expect(validWorktree({ mode: 'new', branchName: '', path: '/tree' })).toBe(false);
    expect(cleanWorktree({ mode: 'new', branchName: ' fix ', path: ' /tree ', sourceBranch: '  ' })).toEqual({ mode: 'new', branchName: 'fix', path: '/tree' });
  });
});

describe('useWorktreeDraft', () => {
  function setup(basePath = '/worktrees') {
    const value = fixture(); value.state.settings = { worktreeBasePath: basePath };
    const mock = fakeApi(value);
    const hook = renderHook(() => useWorktreeDraft({ api: mock.api, task, project, basePath, enabled: true }));
    return { ...mock, ...hook };
  }
  it('loads the host suggestion into untouched fields', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.value.branchName).toBe('alpha-task'));
    expect(result.current.value.path).toBe('/worktrees/alpha-task');
    expect(result.current.suggestion).toEqual({ branchName: 'alpha-task', path: '/worktrees/alpha-task' });
  });
  it('keeps a touched destination while a branch edit advances an untouched one', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.value.branchName).toBe('alpha-task'));
    act(() => result.current.assign({ ...result.current.value, branchName: 'fix-login' }));
    await waitFor(() => expect(result.current.value.path).toBe('/worktrees/fix-login'));
    act(() => result.current.assign({ ...result.current.value, path: '/custom/tree' }));
    act(() => result.current.assign({ ...result.current.value, branchName: 'another' }));
    expect(result.current.value.path).toBe('/custom/tree');
    act(() => result.current.resetPath());
    expect(result.current.value.path).toBe('/worktrees/another');
  });
  it('reports a suggestion failure and retries', async () => {
    const value = fixture(); value.state.settings = { worktreeBasePath: '/worktrees' };
    const mock = fakeApi(value); vi.mocked(mock.api.worktreeDefault).mockRejectedValueOnce({ code: 'BRANCH_LOOKUP_FAILED', message: 'Branch lookup is unavailable.' });
    const { result } = renderHook(() => useWorktreeDraft({ api: mock.api, task, project, basePath: '/worktrees', enabled: true }));
    await waitFor(() => expect(result.current.suggestionError?.message).toBe('Branch lookup is unavailable.'));
    result.current.reloadSuggestion();
    await waitFor(() => expect(result.current.suggestionError).toBeNull());
    expect(result.current.value.branchName).toBe('alpha-task');
  });
});

function NoticeHarness({ api, run, basePath = '/worktrees', disabled = false, onReview = vi.fn() }: { api: ClientApi; run: (command: import('../../src/shared/types.js').Command) => Promise<import('../../src/shared/types.js').KanbanSnapshot>; basePath?: string; disabled?: boolean; onReview?: () => void }) {
  const draft = useWorktreeDraft({ api, task, project, basePath, enabled: true });
  return <><button type="button" onClick={() => draft.assign({ ...draft.value, branchName: 'edited-branch' })}>Edit draft</button><WorktreeNotice task={task} project={project} draft={draft} run={run} disabled={disabled} onReview={onReview} onDismiss={vi.fn()} /></>;
}
async function noticeSetup(basePath = '/worktrees', disabled = false) {
  const value = fixture(); value.state.settings = basePath ? { worktreeBasePath: basePath } : undefined;
  const mock = fakeApi(value); const onReview = vi.fn();
  const user = userEvent.setup();
  render(<NoticeHarness api={mock.api} run={mock.command} basePath={basePath} disabled={disabled} onReview={onReview} />);
  await screen.findByText('alpha-task');
  return { ...mock, user, onReview };
}
describe('WorktreeNotice', () => {
  it('creates from the displayed defaults without switching tabs', async () => {
    const { user, command, onReview } = await noticeSetup();
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', branchName: 'alpha-task', path: '/worktrees/alpha-task', sourceBranch: 'main' }));
    expect(onReview).not.toHaveBeenCalled();
  });
  it('does not refresh or rename a user-edited draft', async () => {
    const { user, command, api } = await noticeSetup();
    const calls = vi.mocked(api.worktreeDefault).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(screen.getByText('edited-branch')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', branchName: 'edited-branch', path: '/worktrees/edited-branch', sourceBranch: 'main' }));
    expect(vi.mocked(api.worktreeDefault).mock.calls.length).toBe(calls);
  });
  it('routes to Git when no destination is configured', async () => {
    const { user, command, onReview } = await noticeSetup('');
    await user.click(screen.getByRole('button', { name: 'Set destination in Git' }));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalled();
  });
  it('shows a create failure inline and stays available', async () => {
    const { user, command } = await noticeSetup();
    command.mockRejectedValueOnce({ code: 'GIT_FAILED', message: 'A branch named alpha-task already exists.' });
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    expect(await screen.findByText('A branch named alpha-task already exists.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create worktree' })).toBeTruthy();
  });
  it('disables creation while an operation is active', async () => {
    const { } = await noticeSetup('/worktrees', true);
    expect((screen.getByRole('button', { name: 'Create worktree' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refreshes untouched defaults and uses the collision-free suggestion', async () => {
    const { user, command, api } = await noticeSetup();
    vi.mocked(api.worktreeDefault).mockResolvedValueOnce({ branchName: 'alpha-task-2', path: '/worktrees/alpha-task-2' });
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', branchName: 'alpha-task-2', path: '/worktrees/alpha-task-2', sourceBranch: 'main' }));
  });
});
