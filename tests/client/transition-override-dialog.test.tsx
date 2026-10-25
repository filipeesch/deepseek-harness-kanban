// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TransitionOverrideDialog } from '../../src/client/transition-override-dialog.js';

afterEach(cleanup);

function props(overrides: Partial<React.ComponentProps<typeof TransitionOverrideDialog>> = {}) {
  return {
    taskTitle: 'Alpha task',
    workflowName: 'Delivery',
    sourceName: 'Intake',
    destinationName: 'Blocked',
    pending: false,
    problem: null,
    canRetry: true,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
}

describe('transition override dialog', () => {
  it('identifies the task, workflow, and stages and focuses Cancel initially', () => {
    render(<TransitionOverrideDialog {...props()} />);
    const dialog = screen.getByRole('dialog', { name: 'Move to Blocked?' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Alpha task')).toBeTruthy();
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.getByText(/does not allow moving this card from Intake to Blocked/)).toBeTruthy();
    expect(screen.getByText(/Moving anyway affects only this card/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Move anyway' })).toBeTruthy();
  });

  it('cancels and confirms through the expected actions', async () => {
    const user = userEvent.setup(); const value = props();
    render(<TransitionOverrideDialog {...value} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(value.onCancel).toHaveBeenCalledOnce();
    expect(value.onConfirm).not.toHaveBeenCalled();
    cleanup();
    const second = props(); render(<TransitionOverrideDialog {...second} />);
    await user.click(screen.getByRole('button', { name: 'Move anyway' }));
    expect(second.onConfirm).toHaveBeenCalledOnce();
    expect(second.onCancel).not.toHaveBeenCalled();
  });

  it('disables both actions while the move is pending', async () => {
    const user = userEvent.setup(); const value = props({ pending: true });
    render(<TransitionOverrideDialog {...value} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    const primary = screen.getByRole('button', { name: 'Moving…' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true); expect(primary.disabled).toBe(true);
    await user.click(cancel); await user.click(primary);
    expect(value.onCancel).not.toHaveBeenCalled(); expect(value.onConfirm).not.toHaveBeenCalled();
  });

  it('shows a retryable problem and retries through the primary action', async () => {
    const user = userEvent.setup(); const value = props({ problem: { code: 'TASK_BUSY', message: 'The task is busy.' } });
    render(<TransitionOverrideDialog {...value} />);
    expect(screen.getByText('The move needs attention')).toBeTruthy();
    expect(screen.getByText('The task is busy.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(value.onConfirm).toHaveBeenCalledOnce();
  });

  it('offers only Close after a stale-context failure', async () => {
    const user = userEvent.setup(); const value = props({ problem: { code: 'MOVE_CONTEXT_CHANGED', message: 'The card changed stage.' }, canRetry: false });
    render(<TransitionOverrideDialog {...value} />);
    expect(screen.getByText('The card changed stage.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move anyway' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(value.onCancel).toHaveBeenCalledOnce();
    expect(value.onConfirm).not.toHaveBeenCalled();
  });

  it('closes on Escape when not busy', async () => {
    const user = userEvent.setup(); const value = props();
    render(<TransitionOverrideDialog {...value} />);
    await user.keyboard('{Escape}');
    expect(value.onCancel).toHaveBeenCalledOnce();
  });
});
