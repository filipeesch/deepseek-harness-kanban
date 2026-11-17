import type { Column, Task } from '../shared/types.js';

/**
 * The decision stage a task currently sits in, when its current entry belongs to
 * that stage. The gate is derived from the stage, so no task field stores it.
 */
export function decisionGate(task: Pick<Task, 'columnId' | 'stageEntry'>, columns: readonly Column[]): Column | undefined {
  const column = columns.find(value => value.id === task.columnId);
  if (column?.decision === undefined) return undefined;
  if (task.stageEntry !== undefined && task.stageEntry.columnId !== task.columnId) return undefined;
  return column;
}

/** The copy the card and the panel use for a gate with this many options. */
export function decisionLabel(optionCount: number): string {
  return optionCount === 1 ? 'Confirmation needed' : 'Decision needed';
}
