// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentPresetCards } from '../../src/client/agent-preset-cards.js';
import { presetPort } from './agent-preset-fixture.js';

afterEach(cleanup);

function cards(overrides: Partial<React.ComponentProps<typeof AgentPresetCards>> = {}) {
  const onPick = vi.fn();
  const view = render(<AgentPresetCards
    port={presetPort()}
    disabled={false}
    busy={false}
    error={null}
    onPick={onPick}
    {...overrides}
  />);
  return { ...view, onPick };
}

describe('AgentPresetCards', () => {
  it('renders the native roster as cards and reports the chosen preset', async () => {
    const { onPick } = cards();
    expect(await screen.findByRole('button', { name: /Standard/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /PTC/ }));
    expect(onPick).toHaveBeenCalledWith('ptc', false);
  });

  it('reports a roster failure and retries the read', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('roster unavailable'))
      .mockResolvedValueOnce([{ id: 'standard', name: 'Standard' }]);
    cards({ port: presetPort({ list }) });
    expect(await screen.findByText('roster unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry presets' }));
    expect(await screen.findByRole('button', { name: /Standard/ })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('disables the cards and shows the creation hint', async () => {
    cards({ disabled: true, hint: 'Resolve the worktree setup in Git before starting.' });
    expect(screen.getByText('Resolve the worktree setup in Git before starting.')).toBeTruthy();
    expect((await screen.findByRole('button', { name: /Standard/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a selection failure above the retryable cards', async () => {
    cards({ error: 'That preset is unavailable.' });
    expect(screen.getByRole('alert').textContent).toContain('That preset is unavailable.');
    expect(await screen.findByRole('button', { name: /Standard/ })).toBeTruthy();
  });

  it('offers cancel only when a previous conversation can stay active', async () => {
    const onCancel = vi.fn();
    const first = cards();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    first.unmount();
    cards({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('reports an unavailable roster without a port', async () => {
    cards({ port: null });
    expect(await screen.findByText('The native agent-preset roster is unavailable.')).toBeTruthy();
  });

  it('shows the empty roster with a retry', async () => {
    cards({ port: presetPort({ list: async () => [] }) });
    expect(await screen.findByText('No agent presets are available.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry presets' })).toBeTruthy();
  });
});
