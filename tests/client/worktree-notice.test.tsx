// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { showsWorktreeNotice, WorktreeNotice } from '../../src/client/worktree-notice.js';
import { TaskDrawer } from '../../src/client/drawer.js';
import { createTaskPageState } from '../../src/client/page-state.js';
import { PresetProvider, presetPort } from './agent-preset-fixture.js';
import type { WorktreeDraft } from '../../src/client/worktree-draft.js';
import type { Project, Task } from '../../src/shared/types.js';
import { fakeApi, fixture, task } from './helpers.js';

afterEach(cleanup);

const gitProject: Project = { id: 'p1', projectKey: 'p1', name: 'API', projectPath: '/repo/apps/api', gitRootPath: '/repo', defaultBranch: 'main' };
const alwaysProject: Project = { ...gitProject, worktreePolicy: 'always' };
const neverProject: Project = { ...gitProject, worktreePolicy: 'never' };
const folderProject: Project = { id: 'p2', projectKey: 'p2', name: 'Docs', projectPath: '/repo/docs' };
const draft: WorktreeDraft = {
  value: { mode: 'new', branchName: 'alpha-task', path: '/trees/alpha-task' },
  suggestion: null, suggestionPending: false, suggestionError: null, branchTouched: false, pathTouched: false,
  assign() {}, resetPath() {}, reloadSuggestion() {}, refreshSuggestion: async () => null,
};
const plain = (): Task => task('t1', 'Alpha task', 'p1', 'intake');

function renderNotice(project: Project | undefined) {
  return render(<WorktreeNotice task={plain()} project={project} draft={draft} run={vi.fn(async () => fixture()) as never} disabled={false} onReview={() => {}} />);
}

describe('showsWorktreeNotice', () => {
  it('shows the notice for a Git project that leaves the choice to the task', () => {
    expect(showsWorktreeNotice({ worktree: null }, gitProject)).toBe(true);
    expect(showsWorktreeNotice({ worktree: null }, alwaysProject)).toBe(true);
  });
  it('hides it for a project that never creates worktrees', () => {
    expect(showsWorktreeNotice({ worktree: null }, neverProject)).toBe(false);
  });
  it('hides it for a folder project, a ready worktree, or a recorded choice', () => {
    expect(showsWorktreeNotice({ worktree: null }, folderProject)).toBe(false);
    expect(showsWorktreeNotice({ worktree: null }, undefined)).toBe(false);
    expect(showsWorktreeNotice({ worktree: { path: '/trees/a', branch: 'a', owned: true, status: 'ready' } }, gitProject)).toBe(false);
    expect(showsWorktreeNotice({ worktree: null, worktreeDismissed: true }, gitProject)).toBe(false);
  });
});

describe('WorktreeNotice under a project worktree policy', () => {
  it('offers the base-project choice under Ask', () => {
    renderNotice(gitProject);
    expect(screen.getByRole('button', { name: 'Continue in base project' })).toBeTruthy();
    expect(screen.queryByText('This project creates a worktree for its tasks by default.')).toBeNull();
  });
  it('drops the base-project choice and states the policy under Always create', () => {
    renderNotice(alwaysProject);
    expect(screen.queryByRole('button', { name: 'Continue in base project' })).toBeNull();
    expect(screen.getByText('This project creates a worktree for its tasks by default.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create worktree' })).toBeTruthy();
  });
});

/** One task with no conversation and no worktree, in a project carrying the given policy. */
function drawerFixture(policy: 'ask' | 'always' | 'never') {
  const data = fixture();
  const hub = data.state.hubs[0]!;
  hub.projects[0]!.worktreePolicy = policy;
  const current = hub.tasks[0]!;
  current.sessionIds = [];
  current.closedSessionIds = [];
  current.worktree = null;
  current.worktreeDismissed = undefined;
  return data;
}

function mountDrawer(policy: 'ask' | 'always' | 'never') {
  const data = drawerFixture(policy);
  const mock = fakeApi(data);
  const viewState = createTaskPageState();
  render(<PresetProvider port={presetPort()}><TaskDrawer task={data.state.hubs[0]!.tasks[0]!} state={data.state} api={mock.api} run={mock.api.command} renderConversation={() => null} onClose={() => {}} onMove={async () => true} onDanger={() => {}} viewState={viewState} /></PresetProvider>);
  return mock;
}

describe('the drawer under a project worktree policy', () => {
  it('shows no notice and allows the first conversation under Never', async () => {
    mountDrawer('never');
    await screen.findByRole('tab', { name: 'Conversations' });
    expect(screen.queryByRole('note', { name: 'Worktree not created' })).toBeNull();
    const start = screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(screen.queryByText(/Create a worktree or continue in the base project/)).toBeNull();
  });

  it('keeps the create path and drops the base-project choice under Always create', async () => {
    mountDrawer('always');
    const notice = await screen.findByRole('note', { name: 'Worktree not created' });
    expect(notice.textContent).toContain('This project creates a worktree for its tasks by default.');
    expect(within(notice).queryByRole('button', { name: 'Continue in base project' })).toBeNull();
    expect(within(notice).getByRole('button', { name: 'Create worktree' })).toBeTruthy();
  });

  it('keeps both choices under Ask', async () => {
    mountDrawer('ask');
    const notice = await screen.findByRole('note', { name: 'Worktree not created' });
    expect(within(notice).getByRole('button', { name: 'Continue in base project' })).toBeTruthy();
    expect(notice.textContent).not.toContain('by default');
  });
});
