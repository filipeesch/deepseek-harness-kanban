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
  const result: ColumnSlot[] = []; const seen = new Set<string>();
  for (const column of workflow.columns) {
    if (seen.has(column.id)) continue;
    const group = workflow.groups.find(value => value.columnIds.includes(column.id));
    const columns = group ? group.columnIds.map(id => workflow.columns.find(value => value.id === id)).filter((value): value is Column => Boolean(value) && !seen.has(value!.id)) : [column];
    const unique = columns.filter((value, index) => columns.findIndex(item => item.id === value.id) === index);
    unique.forEach(value => seen.add(value.id)); result.push({ key: group ? 'group-' + group.id : 'column-' + column.id, ...(group ? { group } : {}), columns: unique });
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

/** The rendered card ids in DOM order, which is the order the motion frame compares. */
export function cardRowKeys(plan: readonly PlannedSlot[]): string[] {
  const keys: string[] = [];
  for (const slot of plan) for (const planned of slot.columns) for (const task of planned.tasks) keys.push(task.id);
  return keys;
}
