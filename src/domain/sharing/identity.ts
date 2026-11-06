import { SHARED_BOARD_KEY_PATTERN } from './document.js';

/** Local board id → published board key. Board ids never cross the sharing boundary. */
export type BoardBindings = Record<string, string>;
/** A board the team removed while this installation still holds work for it. */
export interface OrphanRecord { lastKey: string; lastPublishedName: string }
export type OrphanMap = Record<string, OrphanRecord>;

export function normalizeBoardName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function slug(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/**
 * Allocate a stable, human-readable key. A rename never re-runs this for an
 * already published board; it only runs when the board enters the document.
 */
export function boardKeyFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slug(name) || 'board';
  if (!used.has(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const suffix = '-' + index;
    const candidate = base.slice(0, 64 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a shared board key.');
}

export function isSharedBoardKey(value: string): boolean {
  return SHARED_BOARD_KEY_PATTERN.test(value);
}
