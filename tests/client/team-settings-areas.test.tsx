// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TeamSettings } from '../../src/client/settings/team-settings/team-settings.js';
import type { HubSharingView } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

afterEach(cleanup);

const bound: HubSharingView = {
  status: 'published', provider: 'local-folder', providerLabel: 'Local folder', supportsFiles: true,
  address: '~/.dsh-kanban/hub', intervalMinutes: 1, lastCheckedAt: '2026-10-21T00:05:00Z',
  drafts: 0, updates: 0, conflicts: 0, syncing: false,
  boards: [{ boardId: 'board-1', key: 'delivery', name: 'Delivery', state: 'in-sync', bound: true, draft: false }],
  incoming: [], pendingRemovals: [], removed: [], blockers: [],
};

function mount(sharing?: HubSharingView) {
  const hub = fixture().state.hubs[0]!;
  const user = userEvent.setup();
  render(<TeamSettings hub={hub} {...(sharing === undefined ? {} : { sharing })} run={vi.fn()} />);
  return { user, hub };
}

const areas = () => within(screen.getByRole('tablist', { name: 'Team settings areas' }));

describe('Team Settings areas', () => {
  it('offers only Connection while the Hub has no binding', async () => {
    mount();
    expect(areas().getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Connection']);
    expect(areas().getByRole('tab', { name: 'Connection' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Choose where this Hub publishes.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Git repository' })).toBeTruthy();
  });

  it('presents Connection and Changes once the Hub is bound, with Connection first', async () => {
    mount(bound);
    expect(areas().getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Connection', 'Changes']);
    expect(areas().getByRole('tab', { name: 'Connection' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Management' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Team storage' })).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
  });

  it('keeps each area to its own content', async () => {
    const { user } = mount(bound);
    await user.click(areas().getByRole('tab', { name: 'Changes' }));
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Status' })).toBeNull();
    await user.click(areas().getByRole('tab', { name: 'Connection' }));
    expect(screen.queryByText('Delivery')).toBeNull();
    expect(screen.getByRole('region', { name: 'Status' })).toBeTruthy();
  });

  it('groups the interval with the connection actions', async () => {
    mount(bound);
    const management = screen.getByRole('region', { name: 'Management' });
    expect(within(management).getByRole('spinbutton', { name: 'Check interval in minutes' })).toBeTruthy();
    expect(within(management).getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(within(management).getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });
});
