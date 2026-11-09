// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ScheduleLastRun } from '../../src/client/settings/schedules/last-run.js';

afterEach(cleanup);

describe('ScheduleLastRun', () => {
  it('opens the conversation of a delivered run', async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(<ScheduleLastRun timeZone="UTC" onOpenSession={onOpenSession} runtime={{ running: false, lastRun: { status: 'sent', at: '2026-01-02T09:00:00.000Z', manual: false, sessionId: 'session-1' } }} />);
    expect(screen.getByText('Last run sent 2026-01-02 09:00')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(onOpenSession).toHaveBeenCalledWith('session-1');
  });

  it('shows the failure reason and opens a failed run conversation when one exists', async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(<ScheduleLastRun timeZone="UTC" onOpenSession={onOpenSession} runtime={{ running: false, lastRun: { status: 'failed', at: '2026-01-02T09:00:00.000Z', manual: true, sessionId: 'session-2', error: { code: 'SEND_FAILED', message: 'The prompt was rejected.' } } }} />);
    expect(screen.getByText('Last run failed 2026-01-02 09:00: The prompt was rejected.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(onOpenSession).toHaveBeenCalledWith('session-2');
  });

  it('renders the conversation identity without navigation and records an archive failure', () => {
    render(<ScheduleLastRun timeZone="UTC" runtime={{ running: false, lastRun: { status: 'sent', at: '2026-01-02T09:00:00.000Z', manual: false, sessionId: 'session-1', archiveError: { code: 'ARCHIVE_REFUSED', message: 'The conversation is still active.' } } }} />);
    expect(screen.getByText('Conversation: session-1')).toBeTruthy();
    expect(screen.getByText('Conversation not archived: The conversation is still active.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open conversation' })).toBeNull();
  });

  it('shows the running indicator, the never-ran state, and the fallback without navigation', () => {
    render(<ScheduleLastRun timeZone="UTC" runtime={{ running: true }} />);
    expect(screen.getByText('Running now')).toBeTruthy();
    cleanup();
    render(<ScheduleLastRun timeZone="UTC" runtime={{ running: false }} />);
    expect(screen.getByText('Never ran.')).toBeTruthy();
    cleanup();
    render(<ScheduleLastRun timeZone="UTC" runtime={{ running: false, lastRun: { status: 'sent', at: '2026-01-02T09:00:00.000Z', manual: false, sessionId: 'session-1' } }} />);
    expect(screen.getByText('Last run sent 2026-01-02 09:00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open conversation' })).toBeNull();
  });
});