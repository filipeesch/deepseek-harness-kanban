// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SegmentedControl } from '../../src/client/segmented.js';

afterEach(cleanup);

const OPTIONS = [{ value: 'ask' as const, label: 'Ask' }, { value: 'always' as const, label: 'Always create' }, { value: 'never' as const, label: 'Never' }];

function Harness({ initial = 'ask' as 'ask' | 'always' | 'never', disabled = false }) {
  const [value, setValue] = useState<'ask' | 'always' | 'never'>(initial);
  return <SegmentedControl label="Worktree policy" value={value} options={OPTIONS} onChange={setValue} disabled={disabled} />;
}

describe('SegmentedControl', () => {
  it('presents one exclusive choice as a radiogroup with the value selected', () => {
    render(<Harness initial="always" />);
    const group = screen.getByRole('radiogroup', { name: 'Worktree policy' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map(radio => radio.textContent)).toEqual(['Ask', 'Always create', 'Never']);
    expect(screen.getByRole('radio', { name: 'Always create' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Ask' }).getAttribute('aria-checked')).toBe('false');
  });

  it('selects by click and keeps a single tab stop on the chosen option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('radio', { name: 'Never' }));
    expect(screen.getByRole('radio', { name: 'Never' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Never' }).tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Ask' }).tabIndex).toBe(-1);
  });

  it('moves the selection with the arrow keys and clamps at both ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Worktree policy' });
    screen.getByRole('radio', { name: 'Ask' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Always create' }).getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Never' }).getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Ask' }).getAttribute('aria-checked')).toBe('true');
    expect(group).toBeTruthy();
  });

  it('ignores selection while disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    await user.click(screen.getByRole('radio', { name: 'Never' }));
    expect(screen.getByRole('radio', { name: 'Ask' }).getAttribute('aria-checked')).toBe('true');
  });
});
