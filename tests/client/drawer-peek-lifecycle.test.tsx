// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { createBoardPageState, taskPageState } from '../../src/client/page-state.js';
import type { DrawerView } from '../../src/client/drawer-view.js';
import { fixture, fakeApi } from './helpers.js';

beforeEach(() => { try { globalThis.localStorage?.clear(); } catch { /* jsdom storage optional */ } });
afterEach(cleanup);

const base: DrawerView = { kind: 'conversation', sessionId: 's1', selectionRequired: false };
const peek: DrawerView = { kind: 'peek', conversationId: 's1', selectionRequired: false, target: { parentSessionId: 's1', sessionId: 'child', mode: 'continuable' } };

function mount() {
  const pageState = createBoardPageState();
  pageState.selectedTaskId = 't1';
  pageState.drawers['t1'] = { section: 'Conversations', view: peek, claim: null };
  const mock = fakeApi(fixture());
  const user = userEvent.setup();
  render(<BoardView api={mock.api} pageState={pageState} renderConversation={id => <div data-testid={'native-' + id} />} />);
  return { ...mock, user, pageState };
}

describe('peek lifecycle on the board', () => {
  it('forgets the peek when the drawer closes', async () => {
    const f = mount();
    await screen.findByRole('button', { name: /Open task Alpha task/ });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(taskPageState(f.pageState, 't1').view).toEqual(base));
    expect(screen.queryByTestId('native-child')).toBeNull();
  });

  it('forgets the previous task peek when another task opens', async () => {
    const f = mount();
    await f.user.click(await screen.findByRole('button', { name: /Open task Beta task/ }));
    await waitFor(() => expect(taskPageState(f.pageState, 't1').view).toEqual(base));
    expect(f.pageState.selectedTaskId).toBe('t2');
  });

  it('forgets the peek when the board leaves the panel', async () => {
    const f = mount();
    await screen.findByRole('button', { name: /Open task Alpha task/ });
    cleanup();
    expect(taskPageState(f.pageState, 't1').view).toEqual(base);
  });
});
