// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawerWidthProvider, useDrawerWidth } from '../../src/client/drawer-width.js';
import type { HostObservable, SidebarPanelPort, SidebarSessionFace } from '../../src/client/sidebar-panel-port.js';
import { ConversationWorkspace } from '../../src/client/conversations/workspace.js';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function observable(initial: boolean): HostObservable<boolean> & { set(value: boolean): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (next) => { value = next; for (const listener of [...listeners]) listener(); },
  };
}

interface FakeFace extends SidebarSessionFace { readonly source: ReturnType<typeof observable>; }
function face(sessionId: string, expanded = false): FakeFace {
  const source = observable(expanded);
  return { sessionId, source, expanded: source, setExpanded: value => { source.set(value); } };
}

function portOf(faces: Record<string, FakeFace>): SidebarPanelPort {
  return { forSession: sessionId => faces[sessionId] };
}

function Harness({ port, baseWidth = 620, viewportWidth = 1400, renderPanel = () => <div data-testid="panel" />, children = <div data-testid="conversation" /> }: {
  port: SidebarPanelPort | undefined;
  baseWidth?: number;
  viewportWidth?: number;
  renderPanel?: () => ReactNode;
  children?: ReactNode;
}) {
  const reserve = vi.fn();
  const release = vi.fn();
  const value = { baseWidth, width: baseWidth, reserve, release, minWidth: 360, maxWidth: Math.round(viewportWidth * 0.9), viewportWidth };
  return <DrawerWidthProvider value={value}>
    <ConversationWorkspace sessionId="s1" port={port} renderPanel={renderPanel}>{children}</ConversationWorkspace>
  </DrawerWidthProvider>;
}

function renderWith(faceValue: FakeFace, options: { baseWidth?: number; viewportWidth?: number; renderPanel?: () => ReactNode; children?: ReactNode } = {}) {
  const reserve = vi.fn();
  const release = vi.fn();
  const baseWidth = options.baseWidth ?? 620;
  const viewportWidth = options.viewportWidth ?? 1400;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
  const panel = options.renderPanel ?? (() => <div data-testid="panel" />);
  const tree = (faces: Record<string, FakeFace>) => (
    <DrawerWidthProvider value={{ baseWidth, width: baseWidth, reserve, release, minWidth: 360, maxWidth: Math.round(viewportWidth * 0.9), viewportWidth }}>
      <ConversationWorkspace sessionId="s1" port={portOf(faces)} renderPanel={panel}>{options.children ?? <div data-testid="conversation" />}</ConversationWorkspace>
    </DrawerWidthProvider>
  );
  const result = render(tree({ s1: faceValue }));
  return { ...result, reserve, release, tree, panel };
}

/** A workspace hosted by the real drawer width controller, with its own edge. */
function RealWidthHarness({ panel }: { panel: FakeFace }) {
  const width = useDrawerWidth();
  return <DrawerWidthProvider value={width}>
    <div data-testid="drawer-edge" onPointerDown={width.beginResize} />
    <output data-testid="drawer-width">{width.width}</output>
    <output data-testid="drawer-base">{width.baseWidth}</output>
    <ConversationWorkspace sessionId="s1" port={portOf({ s1: panel })} renderPanel={() => <div data-testid="panel" />}>
      <div data-testid="conversation" />
    </ConversationWorkspace>
  </DrawerWidthProvider>;
}

describe('ConversationWorkspace', () => {
  it('renders the conversation alone when the host has no panel port', () => {
    render(<Harness port={undefined} />);
    expect(screen.getByTestId('conversation')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Right Sidebar' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('keeps the conversation alone while the Session panel is collapsed', () => {
    const { reserve } = renderWith(face('s1', false));
    expect(screen.queryByRole('region', { name: 'Right Sidebar' })).toBeNull();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('splits the conversation and the rail when the Session panel is expanded', () => {
    const { reserve } = renderWith(face('s1', true));
    const rail = screen.getByRole('region', { name: 'Right Sidebar' });
    expect(rail).toBeTruthy();
    expect(screen.getByTestId('panel')).toBeTruthy();
    const divider = screen.getByRole('separator', { name: 'Resize right Sidebar' });
    expect(divider.getAttribute('aria-valuenow')).toBe('320');
    expect(divider.getAttribute('aria-valuemin')).toBe('320');
    expect(divider.getAttribute('aria-valuemax')).toBe(String(Math.round(620 * 0.7)));
    expect(reserve).toHaveBeenCalledWith(328);
    expect(screen.getByTestId('conversation').parentElement?.getAttribute('aria-hidden')).toBeNull();
  });

  it('returns to the conversation and releases the reservation when the panel collapses', () => {
    const held = face('s1', true);
    const { reserve, release } = renderWith(held);
    expect(reserve).toHaveBeenCalledWith(328);
    act(() => { held.source.set(false); });
    expect(screen.queryByRole('region', { name: 'Right Sidebar' })).toBeNull();
    expect(release).toHaveBeenCalled();
  });

  it('follows the active conversation Session', () => {
    const first = face('s1', true);
    const second = face('s2', false);
    const reserve = vi.fn();
    const release = vi.fn();
    const tree = (sessionId: string) => (
      <DrawerWidthProvider value={{ baseWidth: 620, width: 620, reserve, release, minWidth: 360, maxWidth: 1260, viewportWidth: 1400 }}>
        <ConversationWorkspace sessionId={sessionId} port={portOf({ s1: first, s2: second })} renderPanel={() => <div data-testid="panel" />}>
          <div data-testid="conversation" />
        </ConversationWorkspace>
      </DrawerWidthProvider>
    );
    const result = render(tree('s1'));
    expect(screen.getByRole('region', { name: 'Right Sidebar' })).toBeTruthy();
    result.rerender(tree('s2'));
    expect(screen.queryByRole('region', { name: 'Right Sidebar' })).toBeNull();
    expect(release).toHaveBeenCalled();
  });

  it('covers the conversation when the viewport cannot fit both', () => {
    const { reserve } = renderWith(face('s1', true), { viewportWidth: 800 });
    expect(window.innerWidth).toBe(800);
    const rail = screen.getByRole('region', { name: 'Right Sidebar' });
    expect(rail).toBeTruthy();
    expect(screen.queryByRole('separator')).toBeNull();
    const conversation = screen.getByTestId('conversation').parentElement;
    expect(conversation?.getAttribute('aria-hidden')).toBe('true');
    expect(conversation?.hasAttribute('inert')).toBe(true);
    // Keyboard users land inside the covering panel, not at the page top.
    expect(document.activeElement).toBe(rail);
    expect(reserve).not.toHaveBeenCalled();
  });

  it('exposes the divider to the keyboard without trapping focus', () => {
    renderWith(face('s1', true));
    const divider = screen.getByRole('separator', { name: 'Resize right Sidebar' });
    expect(divider.getAttribute('tabindex')).toBe('0');
    divider.focus();
    expect(document.activeElement).toBe(divider);
    divider.blur();
    expect(document.activeElement).toBe(document.body);
    const rail = screen.getByRole('region', { name: 'Right Sidebar' });
    expect(rail.getAttribute('tabindex')).toBe('-1');
  });

  it('resizes the rail from the keyboard and remembers the width', () => {
    renderWith(face('s1', true));
    const divider = screen.getByRole('separator', { name: 'Resize right Sidebar' });
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider.getAttribute('aria-valuenow')).toBe('336');
    expect(localStorage.getItem('dsh-kanban.rail.width')).toBe('336');
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider.getAttribute('aria-valuenow')).toBe('320');
  });

  it('contains a failing panel and offers a retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const { release } = renderWith(face('s1', true), {
      renderPanel: () => { if (fail) throw new Error('panel exploded'); return <div data-testid="panel" />; },
    });
    expect(screen.getByRole('alert').textContent).toContain('panel exploded');
    expect(screen.queryByRole('region', { name: 'Right Sidebar' })).toBeNull();
    expect(release).toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByTestId('panel')).toBeTruthy();
  });

  it('keeps the drawer width chosen with the panel open while the rail is resized', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
    const held = face('s1', true);
    render(<RealWidthHarness panel={held} />);
    expect(screen.getByTestId('drawer-width').textContent).toBe('748');

    // Choose a wider drawer while the panel is open: 748 -> 848.
    const edge = screen.getByTestId('drawer-edge');
    act(() => { edge.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 900 })); });
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 800 })); });
    act(() => { window.dispatchEvent(new MouseEvent('pointerup')); });
    expect(screen.getByTestId('drawer-width').textContent).toBe('848');
    expect(screen.getByTestId('drawer-base').textContent).toBe('620');

    // Widening the rail must not forget that choice or snap back to the base.
    const divider = screen.getByRole('separator', { name: 'Resize right Sidebar' });
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(screen.getByTestId('drawer-width').textContent).toBe('848');
    expect(screen.getByTestId('drawer-base').textContent).toBe('620');

    // Collapsing the panel still returns to the persisted base width.
    act(() => { held.source.set(false); });
    expect(screen.getByTestId('drawer-width').textContent).toBe('620');
  });

  it('adds no tab chrome of its own', () => {
    renderWith(face('s1', true));
    const rail = screen.getByRole('region', { name: 'Right Sidebar' });
    expect(rail.querySelector('[role="tab"]')).toBeNull();
    expect(rail.textContent).toBe('');
  });
});
