import { readStorage, writeStorage } from './active-scope.js';

/** The browser map that remembers one pan position and zoom per board. */
export const WORKFLOW_VIEWPORTS_KEY = 'dsh.kanban.workflowViewports';

/** One board's stored diagram position, in diagram coordinates. */
export interface StoredWorkflowViewport { readonly x: number; readonly y: number; readonly zoom: number }

function isViewport(value: unknown): value is StoredWorkflowViewport {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ['x', 'y', 'zoom'].every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]));
}

/** Every stored diagram position keyed by board id; a malformed entry is dropped, never thrown. */
export function readWorkflowViewports(): Record<string, StoredWorkflowViewport> {
  try {
    const parsed = JSON.parse(readStorage(WORKFLOW_VIEWPORTS_KEY) ?? '{}') as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, StoredWorkflowViewport] => isViewport(entry[1])));
  } catch { return {}; }
}

/** The position last stored for one board, or null when the board was never navigated. */
export function readWorkflowViewport(boardId: string): StoredWorkflowViewport | null {
  return readWorkflowViewports()[boardId] ?? null;
}

/** Store one board's diagram position; the map stays local to this browser. */
export function writeWorkflowViewport(boardId: string, viewport: StoredWorkflowViewport): Record<string, StoredWorkflowViewport> {
  const next = { ...readWorkflowViewports(), [boardId]: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } };
  writeStorage(WORKFLOW_VIEWPORTS_KEY, JSON.stringify(next));
  return next;
}
