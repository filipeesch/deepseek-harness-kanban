// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Command, HubSchedule, HubState, KanbanSnapshot } from '../../src/shared/types.js';
import { Configuration } from '../../src/client/settings/configuration.js';

afterEach(cleanup);

const now = '2026-01-01T00:00:00.000Z';
const schedule: HubSchedule = {
  id: 'schedule', title: 'Morning review', prompt: 'Summarize', cron: '0 9 * * *', timeZone: 'Europe/Lisbon', projectId: 'p1',
  newConversation: true, archiveWhenIdle: true, enabled: true, createdAt: now, updatedAt: now,
};
const hub: HubState = {
  id: 'hub', name: 'My Hub', revision: 2, projects: [{ id: 'p1', projectKey: 'web', name: 'Web', projectPath: '/web' }],
  boards: [], tasks: [], notes: [], schedules: [schedule], createdAt: now, updatedAt: now,
};

function mount(hubValue: HubState | null) {
  const run = vi.fn(async (_command: Command) => ({}) as KanbanSnapshot);
  return { run, ...render(<Configuration state={null} hub={hubValue} board={null} hubCount={1} settingsRevision={0} run={run} onClose={vi.fn()} />) };
}

describe('Configuration Schedules section', () => {
  it('opens the Schedules tab for the selected Hub', async () => {
    const user = userEvent.setup();
    mount(hub);
    await user.click(screen.getByRole('tab', { name: 'Schedules' }));
    expect(screen.getByRole('heading', { name: 'Schedules', level: 3 })).toBeTruthy();
    expect(screen.getByText('Morning review')).toBeTruthy();
  });

  it('explains that a Hub is required', async () => {
    const user = userEvent.setup();
    mount(null);
    await user.click(screen.getByRole('tab', { name: 'Schedules' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('No Hub is selected.');
  });

  it('wires the last-run link to the provided session navigation', async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    const run = vi.fn(async (_command: Command) => ({}) as KanbanSnapshot);
    const runtime = { schedule: { running: false, lastRun: { status: 'sent' as const, at: now, manual: false, sessionId: 'session-1' } } };
    render(<Configuration state={null} hub={hub} board={null} hubCount={1} settingsRevision={0} run={run} onClose={vi.fn()} scheduleRuntime={runtime} onOpenSession={onOpenSession} />);
    await user.click(screen.getByRole('tab', { name: 'Schedules' }));
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(onOpenSession).toHaveBeenCalledWith('session-1');
  });
});
