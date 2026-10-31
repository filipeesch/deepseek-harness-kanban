// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { autoModeView, CardAutoModeControl, DrawerAutoModeToggle, AutoModeNotice } from '../../src/client/auto-mode.js';
import { PendingTransitionStatus } from '../../src/client/git.js';
import type { Column, Task, Workflow } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

afterEach(cleanup);

const now = '2026-01-01T00:00:00Z';
const column = (id: string, extra: Partial<Column> = {}): Column => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), ...extra });
const flow = (...columns: Column[]): Workflow => ({ name: 'Flow', initialColumnId: columns[0]!.id, columns, groups: [] });
const workflow = flow(
  column('backlog', { allowedTransitions: ['plan'] }),
  column('plan'),
  column('review', { onEnterPrompt: 'Review it.' }),
  column('done'),
);
const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task', projectId: 'project', title: 'Task', description: '', columnId: 'backlog', position: 0,
  sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
  createdAt: now, updatedAt: now, ...overrides,
});

describe('autoModeView', () => {
  it('derives the off state with the enable action', () => {
    const view = autoModeView(task(), workflow);
    expect(view.state).toBe('off');
    expect(view.enabled).toBe(false);
    expect(view.toggleLabel).toBe('Turn on auto mode');
    expect(view.status).toBeUndefined();
    expect(view.notice).toBeUndefined();
  });

  it('derives the armed state with the cascade destination', () => {
    const view = autoModeView(task({ autoMode: { enabled: true } }), workflow);
    expect(view.state).toBe('armed');
    expect(view.destinationName).toBe('Review');
    expect(view.status).toBeUndefined();
    expect(view.notice).toBe('Auto mode is on: the next completed turn moves to Review.');
  });

  it('derives the waiting state for an unresolved current entry', () => {
    const view = autoModeView(task({ columnId: 'review', autoMode: { enabled: true }, instructionPending: { columnId: 'review', enteredAt: 1 } }), workflow);
    expect(view.state).toBe('waiting');
    expect(view.status).toEqual({ tone: 'pending', label: 'Auto mode is waiting for the Review instruction' });
  });

  it('derives the final-stage state when no destination is ahead', () => {
    const view = autoModeView(task({ columnId: 'done', autoMode: { enabled: true } }), workflow);
    expect(view.state).toBe('dead-end');
    expect(view.status).toEqual({ tone: 'pending', label: 'Auto mode: no next stage' });
    expect(view.notice).toBe('Auto mode is on. No next stage is configured.');
  });

  it('derives an admitted automatic advance', () => {
    const view = autoModeView(task({ autoMode: { enabled: true }, pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'waiting', origin: 'auto' } }), workflow);
    expect(view.state).toBe('advancing');
    expect(view.status).toEqual({ tone: 'pending', label: 'Advancing to Plan…' });
  });

  it('derives a failed automatic advance with its message and alert', () => {
    const view = autoModeView(task({
      autoMode: { enabled: true },
      pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'failed', origin: 'auto', error: { code: 'SEND_FAILED', message: 'The instruction could not be sent.' } },
    }), workflow);
    expect(view.state).toBe('failed');
    expect(view.status).toEqual({ tone: 'danger', label: 'Automatic advance failed: The instruction could not be sent.', alert: true });
  });

  it.each([
    ['turn-error', 'Auto mode paused: the turn failed', 'danger'],
    ['turn-blocked', 'Auto mode paused: the turn is waiting for you', 'pending'],
    ['turn-aborted', 'Auto mode paused: the turn was stopped', 'pending'],
    ['turn-max-tokens', 'Auto mode paused: the turn reached its token limit', 'pending'],
  ] as const)('derives the %s pause', (reason, label, tone) => {
    const view = autoModeView(task({ autoMode: { enabled: true, pause: { reason, at: now } } }), workflow);
    expect(view.state).toBe('paused');
    expect(view.reason).toBe(reason);
    expect(view.status).toEqual({ tone, label });
  });

  it('derives the advance-failed pause with its message', () => {
    const view = autoModeView(task({ autoMode: { enabled: true, pause: { reason: 'advance-failed', at: now, message: 'No conversation could be created.' } } }), workflow);
    expect(view.state).toBe('paused');
    expect(view.status).toEqual({ tone: 'danger', label: 'Auto mode could not advance: No conversation could be created.', alert: true });
  });

  it('prefers a recorded pause over derived blockers', () => {
    const pausedWithEntry = task({ autoMode: { enabled: true, pause: { reason: 'turn-error', at: now } }, instructionPending: { columnId: 'review', enteredAt: 1 } });
    expect(autoModeView(pausedWithEntry, workflow).state).toBe('paused');
    const pausedAtDeadEnd = task({ columnId: 'done', autoMode: { enabled: true, pause: { reason: 'turn-blocked', at: now } } });
    expect(autoModeView(pausedAtDeadEnd, workflow).state).toBe('paused');
  });

  it('keeps showing an admitted advance after auto mode is disabled', () => {
    const view = autoModeView(task({ autoMode: undefined, pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'run', status: 'sending', text: 'Plan it.', origin: 'auto' } }), workflow);
    expect(view.enabled).toBe(false);
    expect(view.state).toBe('advancing');
    expect(view.toggleLabel).toBe('Turn on auto mode');
  });
});

describe('auto-mode controls', () => {
  it('renders the card chip as a pressed toggle without activating the card', () => {
    const onToggle = vi.fn();
    const view = autoModeView(task({ autoMode: { enabled: true } }), workflow);
    render(<CardAutoModeControl view={view} onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: 'Turn off auto mode' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.getAttribute('data-auto-state')).toBe('armed');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('disables the card chip while the command is in flight', () => {
    render(<CardAutoModeControl view={autoModeView(task(), workflow)} pending onToggle={() => {}} />);
    expect((screen.getByRole('button', { name: 'Turn on auto mode' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the advancing chip visually and keeps the armed chip distinct', () => {
    const advancing = task({ autoMode: { enabled: true }, pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'waiting', origin: 'auto' } });
    const first = render(<CardAutoModeControl view={autoModeView(advancing, workflow)} onToggle={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Turn off auto mode' });
    expect(chip.className).toContain('is-advancing');
    expect(chip.getAttribute('data-auto-state')).toBe('advancing');
    first.unmount();

    render(<CardAutoModeControl view={autoModeView(task({ autoMode: { enabled: true } }), workflow)} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Turn off auto mode' }).className).not.toContain('is-advancing');
  });

  it('renders the drawer toggle with its state label', () => {
    render(<DrawerAutoModeToggle view={autoModeView(task({ autoMode: { enabled: true } }), workflow)} onToggle={() => {}} />);
    const toggle = screen.getByRole('button', { name: 'Auto mode: on' });
    expect(toggle.textContent).toContain('Auto mode: on');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders no drawer notice when auto mode is off', () => {
    const { container } = render(<AutoModeNotice view={autoModeView(task(), workflow)} />);
    expect(container.querySelector('.kb-drawer-automode')).toBeNull();
  });

  it('renders an alert notice for a failed automatic advance', () => {
    const view = autoModeView(task({
      autoMode: { enabled: true },
      pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'failed', origin: 'auto', error: { code: 'SEND_FAILED', message: 'The instruction could not be sent.' } },
    }), workflow);
    render(<AutoModeNotice view={view} />);
    expect(screen.getByRole('alert').textContent).toContain('Automatic advance failed');
  });

  it('presents an automatic advance failure with only the automatic retry action', () => {
    const failed = task({
      autoMode: { enabled: true },
      pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'run', text: 'Plan it.', sessionId: 's1', status: 'failed', origin: 'auto', error: { code: 'SEND_FAILED', message: 'The instruction could not be sent.' } },
    });
    const run = vi.fn(async () => fixture());
    render(<PendingTransitionStatus task={failed} run={run} columnName="Plan" />);
    expect(screen.getByRole('status').textContent).toBe('The automatic advance needs attention.');
    expect(screen.getByText(/The host advanced this task after a completed turn\./)).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry automatic advance' });
    expect(screen.queryByRole('button', { name: 'Cancel action and return to base' })).toBeNull();
    fireEvent.click(retry);
    expect(run).toHaveBeenCalledWith({ type: 'operation.retry', taskId: 'task' });
  });

  it('keeps the confirmed wording and actions for a user transition', () => {
    const confirmed = task({
      pendingTransition: { id: 'p', fromColumnId: 'backlog', columnId: 'plan', mode: 'move', status: 'failed', error: { code: 'SEND_FAILED', message: 'No.' } },
    });
    render(<PendingTransitionStatus task={confirmed} run={vi.fn(async () => fixture())} columnName="Plan" />);
    expect(screen.getByRole('status').textContent).toBe('The confirmed workflow action needs attention.');
    expect(screen.getByRole('button', { name: 'Retry confirmed action' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel action and return to base' })).toBeTruthy();
  });
});
