// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { fakeApi } from './helpers.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });
function mount() {
  const mock = fakeApi();
  const user = userEvent.setup();
  render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />);
  return { ...mock, user };
}
async function open(user: ReturnType<typeof userEvent.setup>, title = 'Alpha task') {
  await user.click(await screen.findByRole('button', { name: 'Open task ' + title }));
  return (await screen.findByRole('button', { name: 'Close task details' })).closest('aside') as HTMLElement;
}
describe('task drawer animation state', () => {
  it('marks an entrance only when opening from closed and does not replay on card switch', async () => {
    const { user } = mount();
    const first = await open(user);
    expect(first.getAttribute('data-entering')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Open task Beta task' }));
    const second = (await screen.findByRole('button', { name: 'Close task details' })).closest('aside') as HTMLElement;
    expect(second.getAttribute('data-entering')).toBeNull();
    expect(second.getAttribute('data-closing')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Beta task' })).toBeTruthy();
  });

  it('keeps the drawer mounted through the exit and removes it after the animation', async () => {
    const { user } = mount();
    const drawer = await open(user);
    await user.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(drawer.getAttribute('data-closing')).toBe('true');
    expect(screen.getByRole('button', { name: 'Close task details' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull(), { timeout: 1000 });
  });

  it('closes through Escape and the board background', async () => {
    const { user } = mount();
    await open(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull());
    await open(user);
    fireEvent.pointerDown(screen.getByLabelText('Workflow columns'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull());
  });

  it('cancels the exit when another card is opened', async () => {
    const { user } = mount();
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Close task details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open task Beta task' }));
    const drawer = (await screen.findByRole('button', { name: 'Close task details' })).closest('aside') as HTMLElement;
    expect(screen.getByRole('heading', { name: 'Beta task' })).toBeTruthy();
    expect(drawer.getAttribute('data-closing')).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(screen.getByRole('heading', { name: 'Beta task' })).toBeTruthy();
  });

  it('finalizes immediately when reduced motion is preferred', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: query.includes('prefers-reduced-motion'), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() } as unknown as MediaQueryList));
    const { user } = mount();
    const drawer = await open(user);
    expect(drawer.getAttribute('data-entering')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull();
  });
});
