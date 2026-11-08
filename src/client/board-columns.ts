import type { Column, ColumnGroup, Task, Workflow } from '../shared/types.js';
import { placementIndex, type Placement } from '../domain/placement.js';

/** One rendered workflow slot: a standalone column or the columns of a group. */
export interface ColumnSlot { readonly key: string; readonly group?: ColumnGroup; readonly columns: Column[] }

/** An optimistic placement the client applies to the rendered lists before the host confirms it. */
export interface PlannedMove { readonly taskId: string; readonly columnId: string; readonly placement: Placement }

export interface PlannedColumn { readonly column: Column; readonly tasks: Task[] }
export interface PlannedSlot { readonly key: string; readonly group?: ColumnGroup; readonly columns: PlannedColumn[] }

/**
 * The workflow's render order: each group's declared columns stay together and a
 * column that a group already claimed is not rendered twice.
 */
export function columnLayout(workflow: Workflow): ColumnSlot[] {
  const byId = new Map(workflow.columns.map(column => [column.id, column]));
  const groupOf = new Map<string, ColumnGroup>();
  for (const group of workflow.groups) {
    for (const id of group.columnIds) if (!groupOf.has(id)) groupOf.set(id, group);
  }
  const result: ColumnSlot[] = []; const seen = new Set<string>();
  for (const column of workflow.columns) {
    if (seen.has(column.id)) continue;
    const group = groupOf.get(column.id);
    const columns: Column[] = [];
    for (const id of group === undefined ? [column.id] : group.columnIds) {
      if (seen.has(id)) continue;
      const member = byId.get(id);
      if (member === undefined) continue;
      seen.add(id); columns.push(member);
    }
    if (columns.length === 0) continue;
    result.push({ key: group === undefined ? 'column-' + column.id : 'group-' + group.id, ...(group === undefined ? {} : { group }), columns });
  }
  return result;
}

/**
 * The cards each column renders, in visual order. The task list arrives already
 * filtered and sorted by the caller; an optimistic move removes the task from
 * its current stage and inserts it at the requested position of the destination.
 */
export function planColumns(workflow: Workflow, tasks: readonly Task[], move: PlannedMove | null): PlannedSlot[] {
  const moving = move === null ? undefined : tasks.find(task => task.id === move.taskId);
  const settled = move === null ? tasks : tasks.filter(task => task.id !== move.taskId);
  const byColumn = new Map<string, Task[]>();
  for (const task of settled) {
    const list = byColumn.get(task.columnId);
    if (list === undefined) byColumn.set(task.columnId, [task]);
    else list.push(task);
  }
  if (move !== null && moving !== undefined) {
    const list = byColumn.get(move.columnId) ?? [];
    list.splice(placementIndex(move.placement, list), 0, moving);
    byColumn.set(move.columnId, list);
  }
  return columnLayout(workflow).map(slot => ({ ...slot, columns: slot.columns.map(column => ({ column, tasks: byColumn.get(column.id) ?? [] })) }));
}

/**
 * The rendered cards in DOM order, each prefixed by its column. The column
 * prefix is what makes a stage change visible to the motion frame even when the
 * flat sequence of task ids would be identical (for example, moving a column's
 * last card to the top of the next column).
 */
export const CARD_LAYOUT_SEPARATOR = '\u0000';

export function cardLayoutKeys(plan: readonly PlannedSlot[]): string[] {
  const keys: string[] = [];
  for (const slot of plan) for (const planned of slot.columns) for (const task of planned.tasks) keys.push(planned.column.id + CARD_LAYOUT_SEPARATOR + task.id);
  return keys;
}
