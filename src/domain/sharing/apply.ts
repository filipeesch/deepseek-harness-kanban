import { invariant, KanbanError } from '../../shared/errors.js';
import type { HubState } from '../../shared/types.js';
import { createBoard } from '../hub-schema.js';
import { normalizeBoardName } from './identity.js';
import { parseWorkflow } from '../workflow.js';
import type { SharingPlan } from './plan.js';

export interface ApplySharingDeps { id: () => string; now: () => string }
export interface ApplySharingResult { created: Array<{ boardId: string; key: string }> }

/**
 * Apply a validated plan to one Hub draft. Every rule is checked before the
 * first mutation, so a rejected plan leaves the draft untouched; the caller
 * runs this inside a single Hub transaction.
 */
export function applySharingPlan(draft: HubState, plan: SharingPlan, deps: ApplySharingDeps): ApplySharingResult {
  const parsed = plan.apply.map(entry => ({
    entry,
    workflow: parseWorkflow(entry.workflow),
    board: entry.boardId === undefined ? undefined : draft.boards.find(board => board.id === entry.boardId),
  }));
  for (const item of parsed) {
    if (item.entry.boardId === undefined) continue;
    const board = item.board;
    invariant(board, 'BOARD_NOT_FOUND', 'A planned board update targets a board that no longer exists.');
    const columns = new Set(item.workflow.columns.map(column => column.id));
    const orphaned = draft.tasks.filter(task => task.boardId === board.id && !columns.has(task.columnId));
    if (orphaned.length > 0) {
      throw new KanbanError('SHARING_ORPHAN_COLUMNS', 'The team workflow would leave tasks in a column it does not define.', { boardId: board.id, boardName: board.name, columns: [...new Set(orphaned.map(task => task.columnId))], tasks: orphaned.length });
    }
  }

  const removals = new Set(plan.removals);
  const names = new Map<string, string>();
  const claim = (name: string, label: string): void => {
    const key = normalizeBoardName(name);
    const owner = names.get(key);
    if (owner !== undefined) throw new KanbanError('SHARING_NAME_CONFLICT', 'Applying the team configuration would duplicate the board name "' + name.trim() + '".', { boardName: name.trim(), other: owner, label });
    names.set(key, label);
  };
  for (const board of draft.boards) {
    if (removals.has(board.id)) continue;
    const update = parsed.find(item => item.entry.boardId === board.id);
    claim(update ? update.entry.name : board.name, board.id);
  }
  for (const item of parsed) {
    if (item.entry.boardId !== undefined) continue;
    claim(item.entry.name, 'new:' + item.entry.key);
  }
  for (const boardId of plan.removals) {
    invariant(draft.boards.some(board => board.id === boardId), 'BOARD_NOT_FOUND', 'A planned board removal targets a board that no longer exists.');
    invariant(!draft.tasks.some(task => task.boardId === boardId), 'SHARING_REMOVE_IN_USE', 'A board with tasks cannot be removed by a team update.');
  }

  const at = deps.now();
  const created: Array<{ boardId: string; key: string }> = [];
  for (const item of parsed) {
    if (item.board === undefined) {
      const board = createBoard(deps.id(), item.entry.name, at, item.entry.workflow);
      draft.boards.push(board);
      created.push({ boardId: board.id, key: item.entry.key });
      continue;
    }
    item.board.name = item.entry.name;
    item.board.workflowYaml = item.entry.workflow;
    item.board.workflow = item.workflow;
    item.board.updatedAt = at;
  }
  if (plan.removals.length > 0) draft.boards = draft.boards.filter(board => !removals.has(board.id));
  if (plan.order !== undefined) {
    const createdByKey = new Map(created.map(entry => [entry.key, entry.boardId]));
    const rank = new Map<string, number>();
    plan.order.forEach((entry, index) => {
      const boardId = entry.boardId ?? createdByKey.get(entry.key);
      if (boardId !== undefined) rank.set(boardId, index);
    });
    draft.boards.sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  }
  draft.updatedAt = at;
  return { created };
}
