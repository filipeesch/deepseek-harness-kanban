// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StorageCards } from '../../src/client/settings/team-settings/storage-cards.js';

afterEach(cleanup);

describe('storage cards', () => {
  it('renders one card per storage with an icon and a description', () => {
    render(<StorageCards value="git" onChange={() => {}} locked={false} busy={false} />);
    const cards = screen.getByRole('radiogroup', { name: 'Team storage' }).querySelectorAll('[role="radio"]');
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(card.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Google Drive Local' }).textContent).toContain('Use a folder from the Google Drive app installed here.');
    expect(screen.getByRole('radio', { name: 'Google Drive Cloud' }).textContent).toContain('Authorize a Google account');
  });

  it('selects a storage by click', () => {
    const onChange = vi.fn();
    render(<StorageCards value="git" onChange={onChange} locked={false} busy={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Google Drive Local' }));
    expect(onChange).toHaveBeenCalledWith('google-drive-local');
  });

  it('moves the selection with the arrow keys', () => {
    const onChange = vi.fn();
    render(<StorageCards value="local-folder" onChange={onChange} locked={false} busy={false} />);
    const local = screen.getByRole('radio', { name: 'Local folder' });
    local.focus();
    fireEvent.keyDown(local, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('google-drive-local');
  });

  it('shows the bound storage and refuses a change while locked', () => {
    render(<StorageCards value="google-drive-local" onChange={() => {}} locked busy={false} />);
    expect(screen.getByRole('radio', { name: 'Google Drive Local' }).getAttribute('aria-checked')).toBe('true');
    for (const card of screen.getAllByRole('radio')) expect((card as HTMLButtonElement).disabled).toBe(true);
  });
});
