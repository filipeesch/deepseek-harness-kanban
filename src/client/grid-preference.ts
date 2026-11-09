import { readStorage, writeStorage } from './active-scope.js';

export const GRID_SNAP_KEY = 'dsh.kanban.gridSnap';

/**
 * The diagram's snapping preference. It starts on, it lives in this browser
 * only, and anything malformed reads as on, so a corrupted value never turns the
 * lattice off behind the user's back.
 */
export function readGridSnap(): boolean {
  return readStorage(GRID_SNAP_KEY) !== 'off';
}

/** Store the snapping preference; the write is best effort. */
export function writeGridSnap(enabled: boolean): boolean {
  writeStorage(GRID_SNAP_KEY, enabled ? 'on' : 'off');
  return enabled;
}
