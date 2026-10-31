// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunningTasksBadge } from '../../src/client/running-tasks-badge.js';
import type { ScopeActivity } from '../../src/client/scope-activity.js';

afterEach(cleanup);

function activity(overrides: Partial<ScopeActivity> = {}): ScopeActivity {
  return { runningTasks: 0, runningTaskTitles: [], unread: false, awaitingReply: false, failed: false, ...overrides };
}

describe('RunningTasksBadge', () => {
  it('renders nothing when no task is running', () => {
    const { container } = render(<RunningTasksBadge activity={activity()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the count and one labeled mark for several running tasks', () => {
    render(<RunningTasksBadge activity={activity({ runningTasks: 2, runningTaskTitles: ['Fix login', 'Update docs'] })} />);
    expect(screen.getByRole('img', { name: '2 tasks running' })).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByRole('img', { name: '2 tasks running' }).getAttribute('title')).toBe('2 tasks running: Fix login, Update docs');
  });

  it('uses the singular label and keeps the numeral for one running task', () => {
    render(<RunningTasksBadge activity={activity({ runningTasks: 1, runningTaskTitles: ['Fix login'] })} />);
    expect(screen.getByRole('img', { name: '1 task running' })).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('keeps the ring decorative so the count is announced once', () => {
    const { container } = render(<RunningTasksBadge activity={activity({ runningTasks: 3, runningTaskTitles: ['A', 'B', 'C'] })} />);
    expect(container.querySelector('.kb-tab-running-ring')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
