// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { BoardView } from '../../src/client/board.js';
import { createBoardPageState, taskPageState } from '../../src/client/page-state.js';
import type { DrawerSessionList, DrawerSessionRow } from '../../src/client/drawer-navigation.js';
import { DrawerNavigationCoordinator } from '../../src/client/drawer-navigation-coordinator.js';
import { NavigationForwarder } from '../../src/client/host-navigation.js';
import { fixture, fakeApi } from './helpers.js';

beforeEach(() => { try { globalThis.localStorage?.clear(); } catch { /* jsdom storage optional */ } });
afterEach(cleanup);

/** A stand-in for the host frame: it renders the active panel only. */
function createPanel() {
  let panel: string | null = 'kanban';
  const listeners = new Set<() => void>();
  return {
    activePanel: () => panel,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select: (id: string | null) => { panel = id; for (const listener of [...listeners]) listener(); },
  };
}

describe('drawer navigation keeps the board mounted', () => {
  it('re-selects the panel in the same update, so the drawer is never remounted', async () => {
    const panel = createPanel();
    const rows: Record<string, DrawerSessionRow> = { s1: {}, s2: { retainedBy: { mainView: 1 } } };
    const listeners = new Set<() => void>();
    const pageState = createBoardPageState();
    pageState.selectedTaskId = 't1';
    const forwarder = new NavigationForwarder();
    const coordinator = new DrawerNavigationCoordinator({
      panelId: 'kanban',
      panel: { activePanel: panel.activePanel, subscribe: panel.subscribe, selectPanel: panel.select },
      sessions: {
        list: () => ({ byId: rows }) as DrawerSessionList,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        refresh: async () => {},
        subagentAddress: () => undefined,
      },
      pageState,
      snapshot: () => fixture(),
      attachFork: async () => { throw new Error('no branch in this scenario'); },
      report: () => {},
    });
    const stop = coordinator.start();
    forwarder.attach(coordinator);
    function Frame() {
      const active = useSyncExternalStore(panel.subscribe, panel.activePanel);
      return active === 'kanban'
        ? <BoardView api={fakeApi(fixture()).api} pageState={pageState} navigation={forwarder} renderConversation={id => <div data-testid={'native-' + id} />} />
        : <div data-testid="main-pane" />;
    }
    const view = render(<Frame />);
    const drawer = await waitFor(() => {
      const node = view.container.querySelector('.kb-drawer');
      expect(node).not.toBeNull();
      return node as Element;
    });
    // The host retains the new conversation and clears the panel in one update.
    rows['s2'] = { ...rows['s2'], retainedBy: { mainView: 1 } };
    panel.select(null);
    await waitFor(() => expect(taskPageState(pageState, 't1').view).toEqual({ kind: 'conversation', sessionId: 's2', selectionRequired: false }));
    expect(panel.activePanel()).toBe('kanban');
    // The bridge between retain and re-select kept the drawer element alive.
    expect(view.container.querySelector('.kb-drawer')).toBe(drawer);
    expect(screen.queryByTestId('main-pane')).toBeNull();
    stop(); forwarder.detach();
  });
});
