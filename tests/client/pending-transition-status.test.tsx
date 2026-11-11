// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { PendingTransitionStatus } from '../../src/client/git.js';
import type { Command, PendingTransition } from '../../src/shared/types.js';
import { fixture, task } from './helpers.js';

afterEach(cleanup);
const base = task('t1', 'Alpha task', 'p1', 'review');

function mount(transition: PendingTransition) {
  const run = vi.fn(async (_command: Command) => fixture());
  render(<PendingTransitionStatus task={{ ...base, pendingTransition: transition }} run={run} columnName="Review" />);
  return { run, region: screen.getByRole('status').closest('.kb-operation') as HTMLElement };
}

function transition(overrides: Partial<PendingTransition>): PendingTransition {
  return { id: 'p', fromColumnId: 'intake', columnId: 'review', mode: 'run', text: 'Review it.', status: 'failed', ...overrides };
}

describe('PendingTransitionStatus', () => {
  it('names a failed agent-declared transition and offers its recovery', async () => {
    const { run, region } = mount(transition({ origin: 'agent', reason: 'The review needs the plan first.' }));
    expect(screen.getByText('The agent-declared transition needs attention.')).toBeTruthy();
    expect(within(region).getByText(/The agent declared this transition at the end of its turn\./)).toBeTruthy();
    within(region).getByRole('button', { name: 'Retry declared transition' }).click();
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'operation.retry', taskId: 't1' }));
    within(region).getByRole('button', { name: 'Dismiss failed advance' }).click();
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'operation.dismiss', taskId: 't1' }));
  });

  it('keeps the automatic copy for an auto-mode advance', () => {
    const { region } = mount(transition({ origin: 'auto' }));
    expect(screen.getByText('The automatic advance needs attention.')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Retry automatic advance' })).toBeTruthy();
  });

  it('keeps the confirmed copy for a legacy record', () => {
    const { region } = mount(transition({ status: 'waiting' }));
    expect(screen.getByText('The confirmed workflow action is waiting for the worktree context.')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Retry confirmed action' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Cancel action and return to base' })).toBeTruthy();
  });
});
