/**
 * The drawer's conversation workspace: the host's conversation window and the
 * embedded right Sidebar panel share one row. The panel's presence follows the
 * host's per-Session expansion, the drawer reserves room while it is open, and
 * a viewport that cannot fit both lets the panel cover the conversation.
 */
import React, { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useDrawerWidthContext } from '../drawer-width.js';
import { readRailWidth, writeRailWidth } from '../rail-width.js';
import type { SidebarPanelPort } from '../sidebar-panel-port.js';
import { useResizableEdge } from '../use-resizable-split.js';
import {
  RAIL_MIN, clampRailWidth, defaultRailWidth, planWorkspace, railUpperBound,
} from './workspace-layout.js';

/** What the workspace needs from the surface that hosts it. */
export interface ConversationWorkspaceProps {
  /** The Session whose panel this workspace presents. */
  readonly sessionId: string;
  /** The host Sidebar port; absent on hosts without the embedded panel. */
  readonly port: SidebarPanelPort | undefined;
  /** Render the host's embedded panel occurrence for this Session. */
  readonly renderPanel: () => ReactNode;
  /** The conversation window occurrence, already rendered for this Session. */
  readonly children: ReactNode;
}

const NO_SUBSCRIBE = (): (() => void) => () => {};
const COLLAPSED = (): boolean => false;

function subscribeViewport(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', listener);
  return () => { window.removeEventListener('resize', listener); };
}

function viewportSnapshot(): number {
  return typeof window === 'undefined' ? 1200 : window.innerWidth;
}

/** Render the host occurrence inside the boundary, so a throwing panel is caught. */
function PanelOccurrence({ render }: { readonly render: () => ReactNode }): ReactNode {
  return <>{render()}</>;
}

/** Keep one failing panel from taking the conversation down with it. */
class PanelBoundary extends Component<{ readonly children: ReactNode; readonly onFailure: (message: string) => void }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : 'The right Sidebar panel failed to render.' };
  }
  componentDidCatch(error: unknown): void {
    this.props.onFailure(error instanceof Error ? error.message : 'The right Sidebar panel failed to render.');
  }
  render(): ReactNode {
    return this.state.error === null ? this.props.children : null;
  }
}

/**
 * Present the conversation window with the right Sidebar panel beside it.
 * @param props - Session, host port, panel renderer, and the window occurrence.
 * @returns the workspace row, without a panel when the host cannot provide one.
 */
export function ConversationWorkspace({ sessionId, port, renderPanel, children }: ConversationWorkspaceProps): React.JSX.Element {
  const drawer = useDrawerWidthContext();
  const { baseWidth, reserve, release } = drawer;
  // The plan follows a live viewport: a window resize re-renders the workspace
  // so the split can become a covered panel (and back) without state changes.
  const viewportWidth = useSyncExternalStore(subscribeViewport, viewportSnapshot, () => drawer.viewportWidth);
  const face = port?.forSession(sessionId);
  const expanded = useSyncExternalStore(
    face?.expanded.subscribe ?? NO_SUBSCRIBE,
    face?.expanded.getSnapshot ?? COLLAPSED,
    COLLAPSED,
  );
  const [preference, setPreference] = useState(() => readRailWidth(baseWidth));
  const [failed, setFailed] = useState<string | null>(null);
  const conversation = useRef<HTMLDivElement | null>(null);
  const rail = useRef<HTMLDivElement | null>(null);

  const plan = planWorkspace({ drawerWidth: baseWidth, viewportWidth, railWidthPreference: preference });
  const open = face !== undefined && expanded && failed === null;
  const split = open && plan.kind === 'split';
  const cover = open && plan.kind === 'cover';
  const railWidth = plan.railWidth;
  const extra = plan.kind === 'split' ? plan.extra : 0;

  // Reserve before the browser paints, so the first frame with the panel is
  // already wide enough for the conversation minimum. Every close path is an
  // effect cleanup, so the drawer cannot stay reserved after the panel collapses.
  useLayoutEffect(() => {
    if (!split) return undefined;
    reserve(extra);
    return () => { release(); };
  }, [split, extra, reserve, release]);

  // While the panel covers the conversation it takes focus, so keyboard users do
  // not fall back to the page top; collapsing restores the previous focus when it
  // still exists. This runs before the conversation becomes inert, so the captured
  // element is the one that actually had focus.
  useLayoutEffect(() => {
    if (!cover) return undefined;
    const previous = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rail.current?.focus({ preventScroll: true });
    return () => {
      if (previous !== null && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [cover]);
  // A covered conversation stays mounted for its retained Session but must not
  // take focus behind the panel.
  useLayoutEffect(() => {
    const node = conversation.current;
    if (node === null) return undefined;
    if (cover) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
    return () => { node.removeAttribute('inert'); };
  }, [cover]);

  // A crashed panel belongs to the Session that crashed; switching conversations
  // starts that Session's panel clean.
  useEffect(() => { setFailed(null); }, [sessionId]);

  const applyRail = useCallback((next: number) => { setPreference(clampRailWidth(next, baseWidth)); }, [baseWidth]);
  const commitRail = useCallback((value: number) => { writeRailWidth(value); }, []);
  const divider = useResizableEdge({
    current: () => railWidth,
    apply: applyRail,
    clamp: next => clampRailWidth(next, baseWidth),
    reset: defaultRailWidth(baseWidth),
    commit: commitRail,
    step: 16,
  });
  const retry = useCallback(() => { setFailed(null); }, []);
  const mode = split ? 'split' : cover ? 'cover' : 'conversation';

  return <div className="kb-workspace" data-workspace-mode={mode} data-session={sessionId}>
    <div ref={conversation} className="kb-workspace-conversation" aria-hidden={cover || undefined}>{children}</div>
    {split && <div
      className="kb-workspace-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize right Sidebar"
      aria-valuenow={railWidth}
      aria-valuemin={RAIL_MIN}
      aria-valuemax={railUpperBound(baseWidth)}
      tabIndex={0}
      onPointerDown={divider.onPointerDown}
      onDoubleClick={divider.onDoubleClick}
      onKeyDown={divider.onKeyDown}
    />}
    {(split || cover) && <div
      ref={rail}
      className="kb-workspace-rail"
      role="region"
      aria-label="Right Sidebar"
      tabIndex={-1}
      style={split ? { width: railWidth } : undefined}
    >
      <PanelBoundary onFailure={message => { setFailed(message); }}><PanelOccurrence render={renderPanel} /></PanelBoundary>
    </div>}
    {failed !== null && <div className="kb-workspace-failure" role="alert">
      <strong>Right Sidebar unavailable</strong>
      <span>{failed}</span>
      <button type="button" className="kb-button" onClick={retry}>Retry</button>
    </div>}
  </div>;
}
