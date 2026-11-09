import type { ConnectionLayouts } from '../../domain/workflow-connections.js';
import type { StagePositions } from '../../domain/workflow-positions.js';
import type { StageSizes } from '../../domain/workflow-sizes.js';

/**
 * One layout change: the authored positions before and after a drag, resize, or
 * an Organize, the sizes and connection layouts that applied at the same time,
 * and the visual placements of that moment. The visual snapshot is what restores
 * an automatic layout computed with sizes that no longer exist.
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
}

export function undoStep(history: PlacementHistory): LayoutStepResult | null {
  if (!canUndo(history)) return null;
  const step = history.entries[history.cursor - 1]!;
  return {
    history: { ...history, cursor: history.cursor - 1 },
    positions: step.before,
    ...(step.beforeSizes === undefined ? {} : { sizes: step.beforeSizes }),
    ...(step.beforeConnections === undefined ? {} : { connections: step.beforeConnections }),
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
  };
}
