// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ContextOperation, HubTask, RetainedCheckout } from '../../src/shared/types.js';
import { DestructiveOperationsSection } from '../../src/client/destructive-notices.js';
import { operationNotices, relocationNotices, retainedNotices, type NoticeHandlers } from '../../src/client/notices/model.js';

afterEach(cleanup);

const handlers: NoticeHandlers = {
  openTask: vi.fn(), retryOperation: vi.fn(), forceOperation: vi.fn(), returnToProject: vi.fn(), retryRelocation: vi.fn(),
};

function task(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 't1', boardId: 'board-1', projectId: 'p1', title: 'Alpha task', description: '', columnId: 'intake', position: 1,
    sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo/apps/api', worktree: null, operation: null,
    createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z', ...overrides,
  };
}

function operation(overrides: Partial<ContextOperation> = {}): ContextOperation {
  return {
    id: 'op-1', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: null },
    phase: 'queued', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [],
    gitCompleted: false, createdAt: '2026-10-21T12:00:00Z', ...overrides,
  } as ContextOperation;
}

const retained: RetainedCheckout[] = [
  { path: '/trees/plain', projectId: 'p1', taskTitle: 'Alpha task', reason: 'folder' },
  { path: '/trees/gone', projectId: 'p1', taskTitle: 'Beta task', reason: 'unresolved' },
];

describe('destructive operations section', () => {
  it('separates the operations group from the retained group and never dismisses an operation', () => {
    const operations = [...operationNotices([task({ operation: operation() })], handlers), ...operationNotices([task({ id: 't2', title: 'Beta task', operation: operation({ id: 'op-2', phase: 'failed', targetPath: '/trees/shared', error: { code: 'SHARED_WORKTREE', message: 'In use.' } }) })], handlers)];
    render(<DestructiveOperationsSection operations={operations} retained={retainedNotices(retained, vi.fn())} onDismiss={vi.fn()} dismissAllRetained={vi.fn()} />);
    const section = screen.getByRole('region', { name: 'Destructive operations' });
    expect(within(section).getByText('1 destructive operation')).toBeTruthy();
    expect(within(section).getByText('Task deletion needs attention: Beta task')).toBeTruthy();
    expect(within(section).getByText('Checkouts left on disk')).toBeTruthy();
    expect(within(section).getByText('/trees/plain')).toBeTruthy();
    expect(within(section).getAllByRole('button', { name: /^Dismiss the retained checkout/ })).toHaveLength(2);
    // The failed operation keeps its recovery actions and offers no dismissal.
    expect(within(section).getByRole('button', { name: 'Retry deletion — Beta task' })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /Dismiss .* Beta task$/ })).toBeNull();
  });

  it('offers the dismiss-all action only when more than one checkout is reported', () => {
    const { rerender } = render(<DestructiveOperationsSection operations={[]} retained={retainedNotices(retained, vi.fn())} onDismiss={vi.fn()} dismissAllRetained={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dismiss all' })).toBeTruthy();
    rerender(<DestructiveOperationsSection operations={[]} retained={retainedNotices([retained[0]!], vi.fn())} onDismiss={vi.fn()} dismissAllRetained={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull();
  });

  it('renders nothing when no operation and no retained checkout is present', () => {
    render(<DestructiveOperationsSection operations={[]} retained={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Destructive operations' })).toBeNull();
  });
});
