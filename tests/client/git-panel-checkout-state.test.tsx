// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { GitPanel } from '../../src/client/git.js';
import type { WorktreeDraft } from '../../src/client/worktree-draft.js';
import type { ClientApi, ContextOperation, Project } from '../../src/shared/types.js';
import { fixture, task } from './helpers.js';

afterEach(cleanup);

const project: Project = { id: 'p1', projectKey: 'p1', name: 'API', projectPath: '/repo/apps/api', gitRootPath: '/repo', defaultBranch: 'main' };
const api = { branches: async () => ['main'] } as unknown as ClientApi;
const draft: WorktreeDraft = {
  value: { mode: 'new', branchName: 'alpha-task', path: '/trees/alpha-task' },
  suggestion: null, suggestionPending: false, suggestionError: null, branchTouched: false, pathTouched: false,
  assign() {}, resetPath() {}, reloadSuggestion() {}, refreshSuggestion: async () => null,
};

function operation(observed: { directory: 'absent' | 'empty' | 'present'; registration: 'none' | 'orphan' | 'registered' }): ContextOperation {
  return {
    id: 'op', request: { kind: 'create', mode: 'new', path: '/trees/alpha', branchName: 'feature' }, phase: 'failed', targetPath: '/trees/alpha',
    previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now',
    error: { code: 'GIT_TIMEOUT', message: 'deadline', details: { failedPhase: 'git' } },
    createAttempt: {
      operationId: 'op', path: '/trees/alpha', gitRootPath: '/repo', branchName: 'feature', mode: 'new', absentBefore: true, sourceCommit: 'abc',
      observed: { ...observed, at: 'now', parentCandidates: [] },
    },
  };
}

describe('GitPanel checkout state', () => {
  it.each([
    { directory: 'absent' as const, registration: 'none' as const, value: 'Absent' },
    { directory: 'empty' as const, registration: 'none' as const, value: 'Empty destination' },
    { directory: 'present' as const, registration: 'none' as const, value: 'Incomplete (directory on disk, not registered)' },
    { directory: 'present' as const, registration: 'registered' as const, value: 'Registered' },
  ])('shows $value in the error path', async input => {
    const base = task('t1', 'Alpha task', 'p1', 'intake');
    render(<GitPanel task={{ ...base, operation: operation(input) }} project={project} api={api} run={vi.fn(async () => fixture()) as never} draft={draft} />);
    await waitFor(() => expect(screen.getByText('Checkout: ' + input.value)).toBeTruthy());
  });
});
