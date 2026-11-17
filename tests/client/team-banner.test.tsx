// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { HubSharingView, SharingBoardView } from '../../src/shared/types.js';
import { TeamChangesBanner, teamBannerSignature } from '../../src/client/notices/team-banner.js';

afterEach(cleanup);

function view(overrides: Partial<HubSharingView> = {}): HubSharingView {
  return {
    status: 'published', provider: 'local-folder', providerLabel: 'Local folder', supportsFiles: true, address: '/team',
    syncMode: 'explicit', intervalMinutes: 5, drafts: 0, pending: 0, updates: 2, conflicts: 0, orderChanged: false, syncing: false,
    boards: [], incoming: [], pendingRemovals: [], removed: [], blockers: [], ...overrides,
  } as HubSharingView;
}

function board(overrides: Partial<SharingBoardView> = {}): SharingBoardView {
  return { boardId: 'b1', key: 'delivery', name: 'Delivery', state: 'in-sync', bound: true, draft: false, ...overrides };
}

describe('team-changes banner', () => {
  it('names the active board when the work is its own', () => {
    render(<TeamChangesBanner view={view({ drafts: 1, updates: 0, boards: [board({ state: 'draft', draft: true })] })} boardId="b1" onPublish={vi.fn()} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('You have changes to send for this board “Delivery”.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish board' })).toBeTruthy();
  });

  it('does not attribute another board\'s work to the active board', () => {
    render(<TeamChangesBanner view={view({ drafts: 1, updates: 0, boards: [board()] })} boardId="b1" onPublish={vi.fn()} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Another board of this Hub has changes to send.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish board' })).toBeNull();
  });

  it('presents a storage block where the action would be, without offering it', () => {
    render(<TeamChangesBanner view={view({ drafts: 1, updates: 0, boards: [board({ state: 'draft', draft: true })], blockers: [{ code: 'SHARING_CONCURRENT_WRITE', message: 'The team storage changed; review it first.' }] })} boardId="b1" onPublish={vi.fn()} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('The team storage changed; review it first.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish board' })).toBeNull();
  });

  it('asks for a plugin update instead of offering a publish', () => {
    render(<TeamChangesBanner view={view({ drafts: 0, updates: 0, conflicts: 1, boards: [board({ state: 'update-required', draft: false })] })} boardId="b1" onPublish={vi.fn()} onReview={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('This team board was written by a newer plugin version. Update dsh-kanban, then refresh “Delivery”.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish board' })).toBeNull();
  });

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
