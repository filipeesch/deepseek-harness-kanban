import { createContext, useContext } from 'react';

/**
 * What the composer seat is doing with one strip right now.
 *
 * The seat presents a strip as a compact launcher in a very shallow conversation, and
 * opens exactly one launcher at a time. That is a presentation choice: it must never
 * change the disclosure state the person chose, so the strip reads it here instead of
 * having its toggle clicked from the DOM.
 */
export interface DockLauncherState {
  /** Whether the seat is presenting the strip as a compact launcher. */
  readonly launcher: boolean;
  /** Whether this strip is the launcher the seat has open. */
  readonly active: boolean;
}

const CLOSED: DockLauncherState = Object.freeze({ launcher: false, active: false });

/** The launcher presentation the enclosing dock strip announced, if any. */
export const DockLauncherContext = createContext<DockLauncherState>(CLOSED);

/** Read the enclosing dock strip's launcher presentation. */
export function useDockLauncher(): DockLauncherState {
  return useContext(DockLauncherContext);
}
