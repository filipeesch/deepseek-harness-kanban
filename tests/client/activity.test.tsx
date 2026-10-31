// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { backgroundAccessibleName, backgroundDetails, backgroundIndicatorText, backgroundSummary, TaskActivity } from '../../src/client/activity.js';
import type { Attention } from '../../src/shared/types.js';

afterEach(cleanup);
const attention = (overrides: Partial<Attention> = {}): Attention => ({
  running: false, background: [], unread: false, awaitingReply: false, failed: false, ...overrides,
});
const job = { kind: 'job' as const, label: 'Run tests' };
const schedule = { kind: 'schedule' as const, label: 'Wake later' };

describe('background activity copy', () => {
  it('counts the job and schedule families in a stable order and names the labels', () => {
    expect(backgroundSummary([])).toBe('');
    expect(backgroundSummary([job])).toBe('1 job');
    expect(backgroundSummary([job, job, schedule])).toBe('2 jobs · 1 schedule');
    expect(backgroundSummary([schedule, job])).toBe('1 job · 1 schedule');
    expect(backgroundDetails([job, schedule])).toBe('Run tests · Wake later');
    expect(backgroundSummary([job, schedule])).not.toContain('subagent');
  });

  it('keeps one family label and aggregates once families mix', () => {
    expect(backgroundIndicatorText([])).toBe('');
    expect(backgroundIndicatorText([job])).toBe('1 job');
    expect(backgroundIndicatorText([job, job])).toBe('2 jobs');
    expect(backgroundIndicatorText([job, schedule])).toBe('2 activities');
    expect(backgroundIndicatorText([job, job, schedule])).toBe('3 activities');
    expect(backgroundAccessibleName([job, schedule])).toBe('Background activity: 2 activities. Run tests · Wake later');
  });
});

describe('task activity drawer variant', () => {
  it('shows the agent execution status and background labels without a second live region', () => {
    render(<TaskActivity attention={attention({ running: true, background: [job, schedule] })} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Working')).toBeTruthy();
    const detail = screen.getByText('Background: Run tests · Wake later');
    expect(detail.className).toBe('kb-task-background');
    expect(detail.getAttribute('title')).toBe('Run tests · Wake later');
  });

  it('shows background labels alone after the turn ends', () => {
    render(<TaskActivity attention={attention({ background: [schedule] })} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Working')).toBeNull();
    expect(screen.getByText('Background: Wake later')).toBeTruthy();
  });

  it('renders nothing while idle', () => {
    const { container } = render(<TaskActivity attention={attention()} />);
    expect(container.textContent).toBe('');
  });
});
