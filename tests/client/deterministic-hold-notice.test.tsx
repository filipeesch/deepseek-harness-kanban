// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeterministicHoldNotice } from '../../src/client/deterministic-hold-notice.js';
import { task, fixture } from './helpers.js';

afterEach(cleanup);
const card = { ...task('t', 'CI', 'p', 'wait'), sessionIds: [], stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'stable', enteredAt: 'now' } };

describe('deterministic hold notice', () => {
  it('names the blocking job and cancels it through the task command', async () => {
    const run = vi.fn(async () => fixture());
    render(<DeterministicHoldNotice task={card} hold={{ code: 'background-work', at: 'now', background: [{ kind: 'job', id: 'bash-1', label: 'find the home directory' }] }} run={run} />);
    expect(screen.getByText('Saved result is waiting to be delivered')).toBeTruthy();
    expect(screen.getByText('Waiting for background work to finish.')).toBeTruthy();
    expect(screen.getByText('Job: find the home directory')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job bash-1' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'task.deterministicCancelJob', taskId: 't', jobId: 'bash-1' }));
  });

  it('explains pending work without offering a cancellation', () => {
    const run = vi.fn(async () => fixture());
    render(<DeterministicHoldNotice task={card} hold={{ code: 'pending-user-work', at: 'now', pending: ['approval'] }} run={run} />);
    expect(screen.getByText('Waiting for your answer in the task conversation.')).toBeTruthy();
    expect(screen.getByText('Waiting for: An approval request')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel job/ })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a cancellation failure inside the notice', async () => {
    const run = vi.fn(() => new Promise<ReturnType<typeof fixture>>((_, failure) => { failure({ code: 'JOB_NOT_OWNED', message: 'The background job does not belong to this conversation.' }); }));
    render(<DeterministicHoldNotice task={card} hold={{ code: 'background-work', at: 'now', background: [{ kind: 'job', id: 'bash-1', label: 'find' }] }} run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job bash-1' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Cancel job bash-1' }) as HTMLButtonElement).disabled).toBe(false);
  });
});