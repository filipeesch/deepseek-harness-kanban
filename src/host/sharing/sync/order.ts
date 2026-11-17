import { compareRanks } from '../../../domain/sharing/board-rank.js';
import type { StoredBoard } from '../state.js';

/** Published positions order as text; an unpositioned board comes last. */
export function compareNullableRanks(left: string | null, right: string | null): number {
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return compareRanks(left, right);
}

/** Reorder the bound local boards to the applied ranks, leaving unbound boards in place. */
export function reorderBoundBoards(draft: { boards: Array<{ id: string }> }, bindings: Record<string, string>, boards: Record<string, StoredBoard>): void {
  const positions: number[] = [];
  const bound: Array<{ id: string; rank: string | null }> = [];
  for (const [index, board] of draft.boards.entries()) {
    const key = bindings[board.id];
    if (key === undefined) continue;
    positions.push(index);
    bound.push({ id: board.id, rank: boards[key]?.rank ?? null });
  }
  const sorted = [...bound].sort((left, right) => compareNullableRanks(left.rank, right.rank) || left.id.localeCompare(right.id));
  for (const [offset, position] of positions.entries()) {
    const value = draft.boards[position]!;
    const replacement = sorted[offset]!;
    if (value.id === replacement.id) continue;
    const target = draft.boards.findIndex(board => board.id === replacement.id);
    if (target < 0) continue;
    const move = draft.boards.splice(target, 1)[0]!;
    draft.boards.splice(position, 0, move);
  }
}
