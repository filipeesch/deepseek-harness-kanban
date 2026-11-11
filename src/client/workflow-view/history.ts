import type { ConnectionLayouts } from '../../domain/workflow-connections.js';
import type { StagePositions } from '../../domain/workflow-positions.js';
import type { StageSizes } from '../../domain/workflow-sizes.js';
import type { TransitionRule } from '../../shared/types.js';

/** The authored destinations a step changed, per stage; null permits any other stage. */
export type TransitionValues = Readonly<Record<string, readonly TransitionRule[] | null>>;

/**
 * One workflow step: the authored layout before and after a drag, a resize, an
 * Organize, or a connection gesture, and the destinations a connection gesture
 * authored, re-pointed, re-owned, or removed. A step carries whichever of the two it
 * changed, so replaying it restores exactly what the user asked for.
 */
export interface PlacementStep {
  readonly before: StagePositions;
  readonly after: StagePositions;
  /** Present when the step changed or preserved stage sizes. */
  readonly beforeSizes?: StageSizes;
  readonly afterSizes?: StageSizes;
  /** Present when the step changed or preserved a connection layout. */
  readonly beforeConnections?: ConnectionLayouts;
  readonly afterConnections?: ConnectionLayouts;
  /** Present when the step authored, re-pointed, re-owned, or removed destinations. */
  readonly beforeTransitions?: TransitionValues;
  readonly afterTransitions?: TransitionValues;
  /**
   * What replaying this step restores. A step that omits it is a layout step, which is
   * every step a drag, a resize, an adjustment, or Organize produces. A transition-only
   * step must not replay layout: its positions are the shown snapshot, not authored
   * coordinates, and storing them would author a placement nobody asked for.
   */
  readonly restores?: 'layout' | 'transitions' | 'both';
  readonly beforeLayout?: StagePositions;
  readonly afterLayout?: StagePositions;
}
export interface PlacementHistory { readonly entries: readonly PlacementStep[]; readonly cursor: number }

export const PLACEMENT_HISTORY_LIMIT = 50;

export function emptyHistory(): PlacementHistory {
  return { entries: [], cursor: 0 };
}

/** Append a step, dropping the redo tail and the oldest step beyond the limit. */
export function pushStep(history: PlacementHistory, step: PlacementStep, limit = PLACEMENT_HISTORY_LIMIT): PlacementHistory {
  const entries = history.entries.slice(0, history.cursor);
  entries.push(step);
  const overflow = Math.max(0, entries.length - limit);
  return { entries: entries.slice(overflow), cursor: entries.length - overflow };
}

export function canUndo(history: PlacementHistory): boolean {
  return history.cursor > 0;
}

export function canRedo(history: PlacementHistory): boolean {
  return history.cursor < history.entries.length;
}

export interface LayoutStepResult {
  readonly history: PlacementHistory;
  readonly positions: StagePositions;
  readonly sizes?: StageSizes;
  readonly connections?: ConnectionLayouts;
  readonly transitions?: TransitionValues;
}

export function undoStep(history: PlacementHistory): LayoutStepResult | null {
  if (!canUndo(history)) return null;
  const step = history.entries[history.cursor - 1]!;
  return {
    history: { ...history, cursor: history.cursor - 1 },
    positions: step.before,
    ...(step.beforeSizes === undefined ? {} : { sizes: step.beforeSizes }),
    ...(step.beforeConnections === undefined ? {} : { connections: step.beforeConnections }),
    ...(step.beforeTransitions === undefined ? {} : { transitions: step.beforeTransitions }),
  };
}

export function redoStep(history: PlacementHistory): LayoutStepResult | null {
  if (!canRedo(history)) return null;
  const step = history.entries[history.cursor]!;
  return {
    history: { ...history, cursor: history.cursor + 1 },
    positions: step.after,
    ...(step.afterSizes === undefined ? {} : { sizes: step.afterSizes }),
    ...(step.afterConnections === undefined ? {} : { connections: step.afterConnections }),
    ...(step.afterTransitions === undefined ? {} : { transitions: step.afterTransitions }),
  };
}
