// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Command, HubSchedule, HubState, KanbanSnapshot, ScheduleModelCatalog } from '../../src/shared/types.js';
import { SchedulesSettings } from '../../src/client/settings/schedules/schedules-settings.js';

afterEach(cleanup);

const now = '2026-01-01T00:00:00.000Z';
function schedule(overrides: Partial<HubSchedule> = {}): HubSchedule {
  return {
    id: 'schedule', title: 'Morning review', prompt: 'Summarize the pull requests.', cron: '0 9 * * *', timeZone: 'Europe/Lisbon',
    projectId: 'p1', newConversation: true, archiveWhenIdle: true, enabled: true, createdAt: now, updatedAt: now, ...overrides,
  };
}
function hubState(schedules: HubSchedule[] = [schedule()]): HubState {
  return {
    id: 'hub', name: 'My Hub', revision: 4,
    projects: [{ id: 'p1', name: 'Web', projectPath: '/web' }],
    boards: [], tasks: [], notes: [], schedules, createdAt: now, updatedAt: now,
  };
}
const catalog: ScheduleModelCatalog = { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }], failures: [] };
function harness(schedules: HubSchedule[] = [schedule()]) {
  const run = vi.fn(async (_command: Command) => ({}) as KanbanSnapshot);
  const api = { modelCatalog: vi.fn(async () => catalog) } as never;
  return { run, api, hub: hubState(schedules) };
}

describe('SchedulesSettings', () => {
  it('lists each schedule with its cron description, project, model, and next occurrence', () => {
    const { run, api, hub } = harness([schedule(), schedule({ id: 'second', title: 'Weekly', cron: '0 0 * * 1', model: { provider: 'deepseek', model: 'reason' }, enabled: false })]);
    render(<SchedulesSettings hub={hub} api={api} run={run} />);
    expect(screen.getByText('Morning review')).toBeTruthy();
    expect(screen.getByText('Every day at 09:00')).toBeTruthy();
    expect(screen.getByText('Every Monday at 00:00')).toBeTruthy();
    expect(screen.getByText('Model: Host default')).toBeTruthy();
    expect(screen.getByText('Model: deepseek · reason')).toBeTruthy();
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getAllByText(/Next: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)).toHaveLength(2);
  });

  it('shows the empty state and blocks creation without a project', () => {
    const { run, api, hub } = harness([]);
    render(<SchedulesSettings hub={hub} api={api} run={run} />);
    expect(screen.getByText('No schedules yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New schedule' }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    const empty = { ...hub, projects: [] };
    render(<SchedulesSettings hub={empty} api={api} run={run} />);
    expect((screen.getByRole('button', { name: 'New schedule' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Register a project/)).toBeTruthy();
  });

  it('pauses and resumes a schedule', async () => {
    const user = userEvent.setup();
    const { run, api, hub } = harness();
    render(<SchedulesSettings hub={hub} api={api} run={run} />);
    await user.click(screen.getByRole('button', { name: 'Pause schedule Morning review' }));
    expect(run).toHaveBeenCalledWith({ type: 'schedule.setEnabled', hubId: 'hub', scheduleId: 'schedule', enabled: false });
  });

  it('confirms before deleting and keeps the row on cancel', async () => {
    const user = userEvent.setup();
    const { run, api, hub } = harness();
    render(<SchedulesSettings hub={hub} api={api} run={run} />);
    await user.click(screen.getByRole('button', { name: 'Delete schedule Morning review' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm deleting schedule Morning review' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(run).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete schedule Morning review' }));
    await user.click(screen.getByRole('button', { name: 'Delete schedule' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'schedule.delete', hubId: 'hub', scheduleId: 'schedule', confirmed: true }));
  });

  it('runs a saved schedule now and disables the action while paused', async () => {
    const user = userEvent.setup();
    const { run, api, hub } = harness([schedule(), schedule({ id: 'paused', title: 'Paused', enabled: false })]);
    render(<SchedulesSettings hub={hub} api={api} run={run} />);
    await user.click(screen.getByRole('button', { name: 'Run schedule Morning review now' }));
    expect(run).toHaveBeenCalledWith({ type: 'schedule.runNow', hubId: 'hub', scheduleId: 'schedule' });
    expect((screen.getByRole('button', { name: 'Run schedule Paused now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the running state and the last run, and opens the conversation', async () => {
    const user = userEvent.setup();
    const { run, api, hub } = harness();
    const onOpenSession = vi.fn();
    const runtime = { schedule: { running: false, lastRun: { status: 'sent' as const, at: '2026-01-02T09:00:00.000Z', manual: false, sessionId: 'session-1' } } };
    render(<SchedulesSettings hub={hub} api={api} run={run} runtime={runtime} onOpenSession={onOpenSession} />);
    expect(screen.getByText('Last run sent 2026-01-02 09:00')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(onOpenSession).toHaveBeenCalledWith('session-1');
    cleanup();
    render(<SchedulesSettings hub={hub} api={api} run={run} runtime={{ schedule: { running: true } }} />);
    expect(screen.getByText('Running now')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run schedule Morning review now' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
