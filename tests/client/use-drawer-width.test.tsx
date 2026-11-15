// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAWER_DEFAULT_WIDTH, DRAWER_WIDTH_KEY, storedDrawerWidth, useDrawerWidth,
} from '../../src/client/drawer-width.js';
import { clampDrawerWidth } from '../../src/client/conversations/workspace-layout.js';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function drag(result: { current: ReturnType<typeof useDrawerWidth> }, fromX: number, toX: number): void {
  act(() => { result.current.beginResize({ clientX: fromX, preventDefault: () => {} } as never); });
  act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: toX })); });
  act(() => { window.dispatchEvent(new MouseEvent('pointerup')); });
}

describe('useDrawerWidth', () => {
  it('starts from the default width', () => {
    const { result } = renderHook(() => useDrawerWidth());
    expect(result.current.width).toBe(DRAWER_DEFAULT_WIDTH);
    expect(result.current.baseWidth).toBe(DRAWER_DEFAULT_WIDTH);
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBeNull();
  });

  it('grows for a reservation and restores the base on release', () => {
    const { result } = renderHook(() => useDrawerWidth());
    act(() => { result.current.reserve(328); });
    expect(result.current.width).toBe(420 + 328);
    expect(result.current.baseWidth).toBe(DRAWER_DEFAULT_WIDTH);
    act(() => { result.current.release(); });
    expect(result.current.width).toBe(DRAWER_DEFAULT_WIDTH);
  });

  it('keeps a manual width while reserved without persisting it', () => {
    const { result } = renderHook(() => useDrawerWidth());
    act(() => { result.current.reserve(328); });
    drag(result, 900, 800);
    expect(result.current.width).toBe(848);
    expect(result.current.baseWidth).toBe(DRAWER_DEFAULT_WIDTH);
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBeNull();
    act(() => { result.current.release(); });
    expect(result.current.width).toBe(DRAWER_DEFAULT_WIDTH);
  });

  it('never lets a reserved drawer fall below the conversation minimum', () => {
    const { result } = renderHook(() => useDrawerWidth());
    act(() => { result.current.reserve(400); });
    expect(result.current.width).toBe(820);
    drag(result, 800, 1400);
    expect(result.current.width).toBe(820);
  });

  it('persists keyboard resize of the base width', () => {
    const { result } = renderHook(() => useDrawerWidth());
    act(() => { result.current.resizeKey({ key: 'ArrowLeft', preventDefault: () => {} } as never); });
    expect(result.current.width).toBe(DRAWER_DEFAULT_WIDTH + 16);
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(String(DRAWER_DEFAULT_WIDTH + 16));
    act(() => { result.current.resizeKey({ key: 'Home', preventDefault: () => {} } as never); });
    expect(result.current.width).toBe(DRAWER_DEFAULT_WIDTH);
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(String(DRAWER_DEFAULT_WIDTH));
  });

  it('persists a pointer resize of the base width', () => {
    const { result } = renderHook(() => useDrawerWidth());
    drag(result, 900, 860);
    expect(result.current.width).toBe(DRAWER_DEFAULT_WIDTH + 40);
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe(String(DRAWER_DEFAULT_WIDTH + 40));
  });

  it('reads a stored width and maps the legacy default', () => {
    localStorage.setItem(DRAWER_WIDTH_KEY, '700');
    expect(storedDrawerWidth()).toBe(700);
    const { result } = renderHook(() => useDrawerWidth());
    expect(result.current.width).toBe(700);
    localStorage.setItem(DRAWER_WIDTH_KEY, '560');
    expect(storedDrawerWidth()).toBe(DRAWER_DEFAULT_WIDTH);
  });

  it('ignores an unusable stored width', () => {
    localStorage.setItem(DRAWER_WIDTH_KEY, 'wide');
    expect(storedDrawerWidth()).toBeUndefined();
    const { result } = renderHook(() => useDrawerWidth());
    expect(result.current.width).toBe(DRAWER_DEFAULT_WIDTH);
  });

  it('clamps the reserved width to the viewport maximum', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    const { result } = renderHook(() => useDrawerWidth());
    act(() => { result.current.reserve(400); });
    expect(result.current.width).toBe(clampDrawerWidth(820, 800));
    expect(result.current.maxWidth).toBe(720);
  });
});
