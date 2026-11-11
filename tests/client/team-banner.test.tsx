// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { HubSharingView } from '../../src/shared/types.js';
import { TeamChangesBanner, teamBannerSignature } from '../../src/client/notices/team-banner.js';

afterEach(cleanup);

function view(overrides: Partial<HubSharingView> = {}): HubSharingView {
  return {
    status: 'published', provider: 'local-folder', providerLabel: 'Local folder', supportsFiles: true, address: '/team',
    syncMode: 'explicit', intervalMinutes: 5, drafts: 0, pending: 0, updates: 2, conflicts: 0, orderChanged: false, syncing: false,
    boards: [], incoming: [], removed: [], blockers: [], ...overrides,
  } as HubSharingView;
}

describe('team-changes banner', () => {
  it('leads to Team Settings and can be dismissed without resolving anything', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    const onDismiss = vi.fn();
    render(<TeamChangesBanner view={view()} onReview={onReview} onDismiss={onDismiss} />);
    expect(screen.getByText('Your team published changes to this Hub.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss team changes' }));
    expect(onDismiss).toHaveBeenCalledWith(teamBannerSignature(view()));
    expect(onReview).not.toHaveBeenCalled();
  });

  it('stays dismissed while the team state is unchanged and returns when it changes', () => {
    const dismissed = teamBannerSignature(view());
    const { rerender } = render(<TeamChangesBanner view={view()} dismissedSignature={dismissed} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByText('Your team published changes to this Hub.')).toBeNull();
    rerender(<TeamChangesBanner view={view({ updates: 3 })} dismissedSignature={dismissed} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Your team published changes to this Hub.')).toBeTruthy();
  });

  it('keys the signature on the pending team state only', () => {
    expect(teamBannerSignature(view())).toBe(teamBannerSignature(view()));
    expect(teamBannerSignature(view({ updates: 1 }))).not.toBe(teamBannerSignature(view()));
    expect(teamBannerSignature(view({ conflicts: 1 }))).not.toBe(teamBannerSignature(view()));
    const first = view({ blockers: [{ code: 'A', message: 'A' }, { code: 'B', message: 'B' }] });
    const second = view({ blockers: [{ code: 'B', message: 'B' }, { code: 'A', message: 'A' }] });
    expect(teamBannerSignature(first)).toBe(teamBannerSignature(second));
  });

  it('renders nothing without a pending team state', () => {
    const { rerender } = render(<TeamChangesBanner view={undefined} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<TeamChangesBanner view={view({ status: 'preview', updates: 0 })} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
