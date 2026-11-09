// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { backgroundDetails } from '../../src/client/activity.js';
import { ActivityDot, activityFacts, sectionTabName } from '../../src/client/activity-dot.js';
import type { Attention } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';

afterEach(cleanup);
const attention = (overrides: Partial<Attention> = {}): Attention => ({
  running: false, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK, ...overrides,
});
const job = { kind: 'job' as const, label: 'Run tests' };
const schedule = { kind: 'schedule' as const, label: 'Wake later' };

describe('background activity copy', () => {
  it('names the labels in activity order', () => {
    expect(backgroundDetails([])).toBe('');
    expect(backgroundDetails([job, schedule])).toBe('Run tests · Wake later');
    expect(backgroundDetails([job, schedule])).not.toContain('subagent');
  });
});

describe('drawer activity indicator', () => {
  it('names agent execution and every background label in the section tab', () => {
    const value = attention({ running: true, background: [job, schedule] });
    expect(activityFacts(value)).toEqual(['Agent running', 'Background activity: Run tests · Wake later']);
    expect(sectionTabName('Conversations', value)).toBe('Conversations, Agent running. Background activity: Run tests · Wake later');
  });

  it('names background alone and keeps the label alone when idle', () => {
    expect(sectionTabName('Conversations', attention({ background: [schedule] }))).toBe('Conversations, Background activity: Wake later');
    expect(sectionTabName('Conversations', attention())).toBe('Conversations');
  });

  it('renders one dot for execution, background, or both, and nothing when settled', () => {
    const { container, rerender } = render(<ActivityDot running background={[]} />);
    expect(container.querySelectorAll('.kb-activity-dot')).toHaveLength(1);
    rerender(<ActivityDot running={false} background={[job]} />);
    expect(container.querySelectorAll('.kb-activity-dot')).toHaveLength(1);
    rerender(<ActivityDot running background={[job]} />);
    expect(container.querySelectorAll('.kb-activity-dot')).toHaveLength(1);
    rerender(<ActivityDot running={false} background={[]} />);
    expect(container.querySelector('.kb-activity-dot')).toBeNull();
  });

  it('adds no live region and keeps the dot decorative', () => {
    const { container } = render(<ActivityDot running background={[job]} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('.kb-activity-dot')?.getAttribute('aria-hidden')).toBe('true');
  });
});
