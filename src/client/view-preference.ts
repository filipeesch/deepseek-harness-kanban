import type { WorkflowView } from '../shared/types.js';
import { readStorage, writeStorage } from './active-scope.js';

export const BOARD_VIEWS_KEY = 'dsh.kanban.views';

/** Every stored presentation choice, keyed by board id; a malformed map reads empty. */
export function readBoardViews(): Record<string, WorkflowView> {
  try {
    const parsed = JSON.parse(readStorage(BOARD_VIEWS_KEY) ?? '{}') as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, WorkflowView] => entry[1] === 'board' || entry[1] === 'workflow');
    return Object.fromEntries(entries);
  } catch { return {}; }
}

/** The presentation the user last chose for one board, or null when they never chose. */
export function readBoardView(boardId: string): WorkflowView | null {
  return readBoardViews()[boardId] ?? null;
}

/** Store one board's presentation choice; the map stays local to this browser. */
export function writeBoardView(boardId: string, view: WorkflowView): Record<string, WorkflowView> {
  const next = { ...readBoardViews(), [boardId]: view };
  writeStorage(BOARD_VIEWS_KEY, JSON.stringify(next));
  return next;
}
