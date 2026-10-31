// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConversationActionsProvider, ConversationCloseAction, type ConversationActions } from '../../src/client/conversation-actions.js';

afterEach(cleanup);

function mount(overrides: Partial<ConversationActions> = {}) {
  const close = vi.fn();
  const value: ConversationActions = {
    activeSessionId: 's1',
    canClose: true,
    pending: false,
    close,
    label: id => id === 's1' ? 'Planner' : id,
    ...overrides,
  };
  render(<ConversationActionsProvider value={value}><ConversationCloseAction /></ConversationActionsProvider>);
  return { close };
}

describe('ConversationCloseAction', () => {
  it('closes the active conversation and names it in the accessible label', () => {
    const { close } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close Planner' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('disables the action while a conversation command is pending', () => {
    const { close } = mount({ pending: true });
    const button = screen.getByRole('button', { name: 'Close Planner' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(close).not.toHaveBeenCalled();
  });

  it('renders nothing without an active root or during a subagent peek', () => {
    mount({ activeSessionId: null, canClose: false });
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull();
    cleanup();
    mount({ canClose: false });
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull();
  });
});
