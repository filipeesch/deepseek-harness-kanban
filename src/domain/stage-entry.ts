import type { Column, Task } from '../shared/types.js';

/** The raw entry instruction bytes, or undefined when the stage has none. */
export function entryInstruction(column: Pick<Column, 'onEnterPrompt'> | undefined): string | undefined {
  const value = column?.onEnterPrompt;
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** The current entry is unresolved when the persisted marker still matches its stage. */
export function hasUnresolvedEntry(task: Pick<Task, 'columnId' | 'instructionPending'>, columnId: string = task.columnId): boolean {
  return task.instructionPending?.columnId === columnId;
}

let lastEnteredAt = 0;

/** Strictly increasing millisecond identity, even when two entries land in the same clock tick. */
export function nextEnteredAt(now: number = Date.now()): number {
  lastEnteredAt = Math.max(now, lastEnteredAt + 1);
  return lastEnteredAt;
}
