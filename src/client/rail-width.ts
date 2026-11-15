/**
 * The rail width preference: one product-wide value, tolerant of missing,
 * invalid, and out-of-range stored numbers.
 */
import { clampRailWidth, defaultRailWidth } from './conversations/workspace-layout.js';

/** Storage key for the rail width the user chose. */
export const RAIL_WIDTH_KEY = 'dsh-kanban.rail.width';

function defaultStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; }
  catch { return undefined; }
}

/**
 * Read the stored rail width.
 * @param drawerWidth - drawer the rail lives in, for the default and the bounds.
 * @param storage - storage to read; defaults to the page's localStorage.
 * @returns the clamped width, or the drawer's default when nothing usable is stored.
 */
export function readRailWidth(drawerWidth: number, storage: Storage | undefined = defaultStorage()): number {
  let raw: string | null = null;
  try { raw = storage?.getItem(RAIL_WIDTH_KEY) ?? null; }
  catch { raw = null; }
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? clampRailWidth(value, drawerWidth) : defaultRailWidth(drawerWidth);
}

/**
 * Persist one rail width.
 * @param value - the width to remember; non-finite values are ignored.
 * @param storage - storage to write; defaults to the page's localStorage.
 */
export function writeRailWidth(value: number, storage: Storage | undefined = defaultStorage()): void {
  if (!Number.isFinite(value) || value <= 0) return;
  try { storage?.setItem(RAIL_WIDTH_KEY, String(Math.round(value))); }
  catch { /* storage is optional */ }
}
