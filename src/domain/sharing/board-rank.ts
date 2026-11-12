import { RANK_ALPHABET } from '../journal/event.js';

/**
 * Board order over append-only logs.
 *
 * A board's position is a short string ordered lexicographically, so moving one board
 * appends one event to that board's log instead of rewriting every board's entry. The
 * publisher keeps every board whose published position is still consistent with the
 * local order and assigns a fresh position to the rest, between their local neighbours.
 */

/** The published position of every board, keyed by board key. */
export type PublishedRanks = ReadonlyMap<string, string | null>;

const MAX_RANK_LENGTH = 32;

/** The text order of two published positions. */
export function compareRanks(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A position strictly between two positions, or null when none fits. */
export function rankBetween(before: string | null, after: string | null): string | null {
  const low = before ?? '';
  if (after !== null && compareRanks(low, after) >= 0) return null;
  let prefix = '';
  for (let index = 0; ; index++) {
    const lowDigit = index < low.length ? RANK_ALPHABET.indexOf(low[index]!) : 0;
    const highDigit = after !== null && index < after.length ? RANK_ALPHABET.indexOf(after[index]!) : RANK_ALPHABET.length;
    if (lowDigit < 0 || highDigit < 0) return null;
    if (highDigit - lowDigit > 1) {
      const candidate = prefix + RANK_ALPHABET[Math.floor((lowDigit + highDigit) / 2)]!;
      if (candidate.length > MAX_RANK_LENGTH) return null;
      if (compareRanks(low, candidate) >= 0) return null;
      if (after !== null && compareRanks(candidate, after) >= 0) return null;
      return candidate;
    }
    prefix += RANK_ALPHABET[lowDigit]!;
    if (prefix.length >= MAX_RANK_LENGTH) return null;
  }
}

/** One rank per key, in the given order, for the rare case no gap is left. */
export function rebalanceRanks(order: readonly string[]): Map<string, string> {
  const ranks = new Map<string, string>();
  for (const [index, key] of order.entries()) {
    const high = Math.floor(index / RANK_ALPHABET.length) % RANK_ALPHABET.length;
    const low = index % RANK_ALPHABET.length;
    ranks.set(key, RANK_ALPHABET[high]! + RANK_ALPHABET[low]!);
  }
  return ranks;
}

/**
 * The positions to publish so that the local order holds, or null when the ranks must
 * be rebuilt. Only a board whose published position contradicts the local order gets a
 * new one, so moving one board appends one event.
 */
export function planRanks(order: readonly string[], published: PublishedRanks): Map<string, string> | null {
  const entries = order.map((key, index) => ({ key, index, rank: published.get(key) ?? null }));
  const keep = keepers(entries);
  const ranks = new Map<string, string>();
  let previous: string | null = null;
  for (const [index, entry] of entries.entries()) {
    if (keep.has(entry.key) && entry.rank !== null) { previous = entry.rank; continue; }
    const next = nextKeeper(entries, index, keep);
    const rank = rankBetween(previous, next);
    if (rank === null) return null;
    ranks.set(entry.key, rank);
    previous = rank;
  }
  return ranks;
}

interface RankEntry { key: string; index: number; rank: string | null }

/**
 * The boards whose published positions are already in local order: a longest strictly
 * increasing subsequence of the published ranks. They keep their position, so a board
 * that did not move is never rewritten.
 */
function keepers(entries: readonly RankEntry[]): Set<string> {
  const tails: Array<{ rank: string; index: number }> = [];
  const previous = new Map<number, number>();
  for (const entry of entries) {
    if (entry.rank === null) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareRanks(tails[middle]!.rank, entry.rank) < 0) low = middle + 1;
      else high = middle;
    }
    previous.set(entry.index, low > 0 ? tails[low - 1]!.index : -1);
    tails[low] = { rank: entry.rank, index: entry.index };
  }
  const keep = new Set<string>();
  const byIndex = new Map(entries.map(entry => [entry.index, entry]));
  let cursor = tails.length === 0 ? -1 : tails[tails.length - 1]!.index;
  while (cursor >= 0) {
    keep.add(byIndex.get(cursor)!.key);
    cursor = previous.get(cursor) ?? -1;
  }
  return keep;
}

/** The first later board that keeps its position, whose rank bounds the new one. */
function nextKeeper(entries: readonly RankEntry[], from: number, keep: ReadonlySet<string>): string | null {
  for (let index = from + 1; index < entries.length; index++) {
    const entry = entries[index]!;
    if (keep.has(entry.key) && entry.rank !== null) return entry.rank;
  }
  return null;
}
