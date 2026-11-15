/**
 * Pure geometry for the conversation workspace: the drawer's conversation and
 * the embedded right Sidebar panel share its width, so every decision about
 * splitting, covering, and reserving room is a number computed here and
 * tested without React.
 */

/** Smallest conversation width the split keeps. */
export const CONVERSATION_MIN = 420;
/** Smallest rail width. */
export const RAIL_MIN = 320;
/** Rail share of the drawer until the user resizes it. */
export const RAIL_DEFAULT_RATIO = 0.45;
/** Width of the drag handle between the conversation and the rail. */
export const DIVIDER = 8;
/** Largest share of the viewport the drawer may occupy. */
export const DRAWER_MAX_RATIO = 0.9;
/** Largest share of the drawer the rail may occupy. */
export const RAIL_MAX_RATIO = 0.7;
/** Smallest drawer width, matching the drawer's own resize bounds. */
export const DRAWER_MIN = 360;

/** The inputs every workspace decision is made from. */
export interface WorkspacePlanInput {
  /** The drawer's base (persisted) width. */
  readonly drawerWidth: number;
  /** The viewport the drawer lives in. */
  readonly viewportWidth: number;
  /** The stored rail preference, or undefined before the user ever resized it. */
  readonly railWidthPreference: number | undefined;
}

/** What the workspace must draw: a real split, or a panel covering the conversation. */
export type WorkspacePlan =
  | {
    readonly kind: 'split';
    /** Rail width after clamping. */
    readonly railWidth: number;
    /** Extra drawer width the rail needs beyond the conversation minimum. */
    readonly extra: number;
  }
  | { readonly kind: 'cover'; readonly railWidth: number };

/**
 * Clamp a drawer width into its contract range.
 * @param value - requested width.
 * @param viewportWidth - viewport the drawer lives in.
 * @returns the width the drawer may use.
 */
export function clampDrawerWidth(value: number, viewportWidth: number): number {
  const max = Math.max(DRAWER_MIN, Math.round(viewportWidth * DRAWER_MAX_RATIO));
  return Math.min(Math.max(Math.round(value), DRAWER_MIN), max);
}

/**
 * Largest rail width the given drawer may present.
 * @param drawerWidth - drawer width the rail lives in.
 * @returns the rail's upper bound.
 */
export function railUpperBound(drawerWidth: number): number {
  return Math.max(RAIL_MIN, Math.round(drawerWidth * RAIL_MAX_RATIO));
}

/**
 * Clamp a rail width into its contract range.
 * @param value - requested rail width.
 * @param drawerWidth - drawer width the rail lives in.
 * @returns the rail width the workspace uses.
 */
export function clampRailWidth(value: number, drawerWidth: number): number {
  const lower = RAIL_MIN;
  const upper = railUpperBound(drawerWidth);
  return Math.min(Math.max(Math.round(value), lower), upper);
}

/**
 * First rail width a drawer presents: 45% of its width, inside the rail bounds.
 * @param drawerWidth - drawer width the rail lives in.
 * @returns the default rail width.
 */
export function defaultRailWidth(drawerWidth: number): number {
  return clampRailWidth(drawerWidth * RAIL_DEFAULT_RATIO, drawerWidth);
}

/**
 * Decide how the workspace presents the expanded panel: a split when the
 * viewport can fit the conversation minimum beside the rail, otherwise a panel
 * covering the conversation.
 * @param input - base drawer width, viewport, and the rail preference.
 * @returns the plan the workspace draws.
 */
export function planWorkspace(input: WorkspacePlanInput): WorkspacePlan {
  const base = clampDrawerWidth(input.drawerWidth, input.viewportWidth);
  const railWidth = clampRailWidth(input.railWidthPreference ?? defaultRailWidth(base), base);
  const extra = railWidth + DIVIDER;
  const needed = CONVERSATION_MIN + extra;
  const limit = Math.round(input.viewportWidth * DRAWER_MAX_RATIO);
  // The drawer grows to the smaller of the viewport limit and the space the
  // conversation minimum plus the rail needs; when even the limit cannot hold
  // both, the panel covers the conversation instead.
  return Math.min(limit, Math.max(base, needed)) >= needed
    ? { kind: 'split', railWidth, extra }
    : { kind: 'cover', railWidth };
}
