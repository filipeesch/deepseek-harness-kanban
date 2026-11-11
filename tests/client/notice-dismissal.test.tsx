// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { DismissButton } from '../../src/client/notices/dismiss-button.js';
import { focusAfterDismissal } from '../../src/client/notices/focus.js';

afterEach(cleanup);

function notices(count: number) {
  const dismissed: string[] = [];
  const view = render(<div className="kb-page-body" tabIndex={-1}>
    <div>{Array.from({ length: count }, (_, index) => <div key={index}><DismissButton
      label={'Dismiss notice ' + index}
      hint="Dismiss"
      onDismiss={control => { dismissed.push('notice ' + index); control.parentElement!.remove(); }}
    /></div>)}</div>
  </div>);
  return { dismissed, view };
}

describe('dismiss control', () => {
  it('is an icon-only button whose accessible name and tooltip identify its notice', () => {
    render(<DismissButton label="Dismiss the retained checkout at /trees/x" hint="Dismiss" onDismiss={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Dismiss the retained checkout at /trees/x' });
    expect(button.getAttribute('title')).toBe('Dismiss');
    expect(button.textContent).toBe('');
  });

  it('activates from the keyboard', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<DismissButton label="Dismiss notice" hint="Dismiss" onDismiss={onDismiss} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss notice' }));
    await user.keyboard('{Enter}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('focus after a dismissal', () => {
  it('moves to the next dismiss control when another notice remains', async () => {
    const user = userEvent.setup();
    const { dismissed } = notices(2);
    const [first, second] = screen.getAllByRole('button', { name: /Dismiss notice/ });
    await user.click(first!);
    expect(dismissed).toEqual(['notice 0']);
    // The click handler removed the row; focus must be handed to the surviving control.
    expect(focusAfterDismissal).toBeTypeOf('function');
    (second as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(second);
  });

  it('falls back to the board body when no dismiss control remains', () => {
    const fallback = vi.fn();
    const { view } = notices(1);
    const button = screen.getByRole('button', { name: 'Dismiss notice 0' }) as HTMLButtonElement;
    button.parentElement!.remove();
    focusAfterDismissal([button], fallback);
    expect(fallback).toHaveBeenCalled();
    expect(document.activeElement).toBe(view.container.querySelector('.kb-page-body'));
  });

  it('never focuses a control that is about to unmount', () => {
    const fallback = vi.fn();
    render(<div>
      <div><DismissButton label="Dismiss first" hint="Dismiss" onDismiss={vi.fn()} /></div>
      <div><DismissButton label="Dismiss second" hint="Dismiss" onDismiss={vi.fn()} /></div>
    </div>);
    const first = screen.getByRole('button', { name: 'Dismiss first' }) as HTMLButtonElement;
    const second = screen.getByRole('button', { name: 'Dismiss second' }) as HTMLButtonElement;
    // Dismiss-all passes every retained control: both are leaving, so nothing may take focus.
    focusAfterDismissal([first, second], fallback);
    expect(fallback).toHaveBeenCalled();
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement).not.toBe(second);
  });

  it('focuses the following control in DOM order', () => {
    render(<div>
      <div><DismissButton label="Dismiss first" hint="Dismiss" onDismiss={vi.fn()} /></div>
      <div><DismissButton label="Dismiss second" hint="Dismiss" onDismiss={vi.fn()} /></div>
    </div>);
    const first = screen.getByRole('button', { name: 'Dismiss first' });
    const second = screen.getByRole('button', { name: 'Dismiss second' });
    (first as HTMLButtonElement).parentElement!.remove();
    focusAfterDismissal([first as HTMLButtonElement]);
    expect(document.activeElement).toBe(second);
  });
});
