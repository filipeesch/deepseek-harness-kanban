/**
 * The task drawer's width: the persisted base width plus the reservation an
 * expanded right Sidebar panel needs, so opening the panel grows the drawer and
 * closing it restores exactly the width the user chose.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CONVERSATION_MIN, DRAWER_MAX_RATIO, DRAWER_MIN, clampDrawerWidth } from './conversations/workspace-layout.js';
import { useResizableEdge } from './use-resizable-split.js';

/** Storage key for the drawer's base width. */
export const DRAWER_WIDTH_KEY = 'dsh-kanban.drawer.width';
/** Width a fresh drawer uses. */
export const DRAWER_DEFAULT_WIDTH = 620;
/** Keyboard step for the drawer edge. */
const DRAWER_STEP = 16;

/** Viewport width, or a wide default when no window exists. */
export function drawerViewportWidth(): number {
  try { return typeof window === 'undefined' ? 1200 : window.innerWidth; }
  catch { return 1200; }
}

/** Clamp a width for the viewport this drawer lives in. */
function clampForViewport(value: number): number {
  return clampDrawerWidth(value, drawerViewportWidth());
}

function defaultStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; }
  catch { return undefined; }
}

/**
 * Read the persisted base width.
 * @param storage - storage to read; defaults to the page's localStorage.
 * @returns the stored width, or undefined when nothing usable is stored.
 */
export function storedDrawerWidth(storage: Storage | undefined = defaultStorage()): number | undefined {
  let raw: string | null = null;
  try { raw = storage?.getItem(DRAWER_WIDTH_KEY) ?? null; }
  catch { raw = null; }
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // One legacy default (560) predates the current one.
  return value === 560 ? DRAWER_DEFAULT_WIDTH : value;
}

/**
 * Persist the base width.
 * @param value - width to remember.
 * @param storage - storage to write; defaults to the page's localStorage.
 */
export function persistDrawerWidth(value: number, storage: Storage | undefined = defaultStorage()): void {
  if (!Number.isFinite(value) || value <= 0) return;
  try { storage?.setItem(DRAWER_WIDTH_KEY, String(Math.round(value))); }
  catch { /* storage is optional */ }
}

/** What the drawer publishes to the surfaces it contains. */
export interface DrawerWidthContextValue {
  /** The persisted width the drawer returns to when no panel is open. */
  readonly baseWidth: number;
  /** The width the drawer uses now, including any reservation. */
  readonly width: number;
  /** Reserve room beyond the conversation minimum for an expanded panel. */
  readonly reserve: (extra: number) => void;
  /** Drop the reservation and return to the base width. */
  readonly release: () => void;
  /** Smallest width the drawer accepts. */
  readonly minWidth: number;
  /** Largest width the current viewport allows. */
  readonly maxWidth: number;
  /** The viewport the drawer lives in, for contained surfaces' layout decisions. */
  readonly viewportWidth: number;
}

/** The default a surface outside a drawer reads: a stable, inert width. */
const STANDALONE: DrawerWidthContextValue = {
  baseWidth: DRAWER_DEFAULT_WIDTH,
  width: DRAWER_DEFAULT_WIDTH,
  reserve: () => {},
  release: () => {},
  minWidth: DRAWER_MIN,
  maxWidth: DRAWER_DEFAULT_WIDTH,
  viewportWidth: 1200,
};

const DrawerWidthContext = createContext<DrawerWidthContextValue | undefined>(undefined);

/** Read the drawer width controller of the drawer this surface renders in. */
export function useDrawerWidthContext(): DrawerWidthContextValue {
  return useContext(DrawerWidthContext) ?? STANDALONE;
}

/** Publish one drawer's width controller to its contained surfaces. */
export function DrawerWidthProvider({ value, children }: { readonly value: DrawerWidthContextValue; readonly children: React.ReactNode }): React.ReactElement {
  return <DrawerWidthContext.Provider value={value}>{children}</DrawerWidthContext.Provider>;
}

/** The drawer's width controller: the context plus the edge gestures. */
export interface DrawerWidthController extends DrawerWidthContextValue {
  readonly beginResize: (event: React.PointerEvent<HTMLElement>) => void;
  readonly resizeKey: (event: React.KeyboardEvent<HTMLElement>) => void;
  readonly resetWidth: (event: React.MouseEvent<HTMLElement>) => void;
}

interface WidthState {
  readonly base: number;
  /** Room an expanded panel needs beyond the conversation minimum. */
  readonly reservation: number | null;
  /** Width chosen while a reservation was active; never persisted. */
  readonly manual: number | null;
}

/**
 * Own one drawer's width.
 * @returns the context value and the edge handlers the drawer binds.
 */
export function useDrawerWidth(): DrawerWidthController {
  const [state, setState] = useState<WidthState>(() => ({
    base: clampForViewport(storedDrawerWidth() ?? DRAWER_DEFAULT_WIDTH),
    reservation: null,
    manual: null,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const widthOf = (current: WidthState): number => current.reservation === null
    ? current.base
    : clampForViewport(Math.max(current.manual ?? current.base, CONVERSATION_MIN + current.reservation));

  const reserve = useCallback((extra: number) => {
    const rounded = Math.max(0, Math.round(extra));
    setState(current => {
      if (current.reservation === rounded) return current;
      // Opening a fresh panel forgets a width chosen for the previous one.
      return { ...current, reservation: rounded, manual: current.reservation === null ? null : current.manual };
    });
  }, []);

  const release = useCallback(() => {
    setState(current => current.reservation === null && current.manual === null
      ? current
      : { ...current, reservation: null, manual: null });
  }, []);

  const clampForState = useCallback((next: number): number => {
    const current = stateRef.current;
    return current.reservation === null
      ? clampForViewport(next)
      : clampForViewport(Math.max(next, CONVERSATION_MIN + current.reservation));
  }, []);

  const applyWidth = useCallback((next: number) => {
    setState(current => {
      const clamped = current.reservation === null
        ? clampForViewport(next)
        : clampForViewport(Math.max(next, CONVERSATION_MIN + current.reservation));
      return current.reservation === null
        ? { ...current, base: clamped }
        : { ...current, manual: clamped };
    });
  }, []);

  const commitWidth = useCallback((next: number) => {
    // Only the base width is a preference; a width chosen with the panel open
    // belongs to that session's presentation and returns to the base on close.
    if (stateRef.current.reservation !== null) return;
    persistDrawerWidth(next);
  }, []);

  const edge = useResizableEdge({
    current: () => widthOf(stateRef.current),
    apply: applyWidth,
    clamp: clampForState,
    reset: DRAWER_DEFAULT_WIDTH,
    commit: commitWidth,
    step: DRAWER_STEP,
  });

  const width = widthOf(state);
  const value = useMemo<DrawerWidthContextValue>(() => ({
    baseWidth: state.base,
    width,
    reserve,
    release,
    minWidth: DRAWER_MIN,
    maxWidth: Math.max(DRAWER_MIN, Math.round(drawerViewportWidth() * DRAWER_MAX_RATIO)),
    viewportWidth: drawerViewportWidth(),
  }), [state.base, width, reserve, release]);

  return {
    ...value,
    beginResize: edge.onPointerDown,
    resizeKey: edge.onKeyDown,
    resetWidth: edge.onDoubleClick,
  };
}
