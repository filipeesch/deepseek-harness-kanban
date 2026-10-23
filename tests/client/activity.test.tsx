// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { backgroundAccessibleName, backgroundChipText, backgroundDetails, backgroundSummary, TaskActivity } from '../../src/client/activity.js';
import type { Attention } from '../../src/shared/types.js';

afterEach(cleanup);
const attention = (overrides: Partial<Attention> = {}): Attention => ({
  running: false, background: [], unread: false, awaitingReply: false, failed: false, ...overrides,
});
const job = { kind: 'job' as const, label: 'Run tests' };
const subagent = { kind: 'subagent' as const, label: 'Research' };
const schedule = { kind: 'schedule' as const, label: 'Wake later' };

describe('background activity copy', () => {
  it('counts families in a stable order and names the labels', () => {
    expect(backgroundSummary([])).toBe('');
    expect(backgroundSummary([job])).toBe('1 job');
    expect(backgroundSummary([job, job, subagent])).toBe('2 jobs · 1 subagent');
    expect(backgroundSummary([schedule, subagent, job])).toBe('1 job · 1 subagent · 1 schedule');
    expect(backgroundDetails([job, subagent])).toBe('Run tests · Research');
    expect(backgroundChipText([job], false)).toBe('1 job');
    expect(backgroundChipText([job], true)).toBe('Background: 1 job');
    expect(backgroundAccessibleName([job, subagent])).toBe('Background activity: 1 job · 1 subagent. Run tests · Research');
  });
});

describe('task activity card variant', () => {
  it('announces a single working status with the task context and no background chip', () => {
    render(<TaskActivity attention={attention({ running: true })} variant="card" label="Alpha task" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Working on Alpha task');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('keeps an empty persistent announcement and a reserved row while idle', () => {
    const { container } = render(<TaskActivity attention={attention()} variant="card" label="Alpha task" />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText('Working')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('changes the persistent status text once when a turn starts', () => {
    const { rerender } = render(<TaskActivity attention={attention()} variant="card" label="Alpha task" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    rerender(<TaskActivity attention={attention({ running: true })} variant="card" label="Alpha task" />);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Working on Alpha task');
    rerender(<TaskActivity attention={attention({ running: true })} variant="card" label="Alpha task" />);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Working on Alpha task');
  });

  it('shows background work alone as a focusable note with count and labels', () => {
    render(<TaskActivity attention={attention({ background: [job] })} variant="card" label="Alpha task" />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText('Working')).toBeNull();
    const note = screen.getByRole('note');
    expect(note.textContent).toBe('1 job');
    expect(note.getAttribute('tabindex')).toBe('0');
    expect(note.getAttribute('aria-label')).toBe('Background activity: 1 job. Run tests');
    expect(note.getAttribute('title')).toBe('Run tests');
  });

  it('shows both facts with the count chip quieter than the working status', () => {
    render(<TaskActivity attention={attention({ running: true, background: [job, subagent] })} variant="card" label="Alpha task" />);
    expect(screen.getByRole('status').textContent).toBe('Working on Alpha task');
    const note = screen.getByRole('note');
    expect(note.textContent).toBe('1 job · 1 subagent');
    expect(note.getAttribute('aria-label')).toBe('Background activity: 1 job · 1 subagent. Run tests · Research');
    expect(note.getAttribute('title')).toBe('Run tests · Research');
  });
});

describe('task activity drawer variant', () => {
  it('shows the turn status and background labels without a second live region', () => {
    render(<TaskActivity attention={attention({ running: true, background: [job, subagent] })} variant="drawer" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Working')).toBeTruthy();
    const detail = screen.getByText('Background: Run tests · Research');
    expect(detail.className).toBe('kb-task-background');
    expect(detail.getAttribute('title')).toBe('Run tests · Research');
  });

  it('shows background labels alone after the turn ends', () => {
    render(<TaskActivity attention={attention({ background: [schedule] })} variant="drawer" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Working')).toBeNull();
    expect(screen.getByText('Background: Wake later')).toBeTruthy();
  });
});
