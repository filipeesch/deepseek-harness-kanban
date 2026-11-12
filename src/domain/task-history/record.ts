import type { AutoModePauseReason, Problem, Task } from '../../shared/types.js';
import type { StageEntryOrigin, TaskHistoryEntry } from '../../shared/task-history.js';

/**
 * Appends to one task's flow record.
 *
 * Every fact the record carries is written here, so the entry shape and the rule
 * that a record only grows stay in one place. Callers describe the fact; they
 * never build an entry.
 */

/** The task field an append writes; the caller keeps the rest of the task. */
type RecordTarget = Pick<Task, 'history'>;

/** Append each logical execution outcome once, never starts, attempts, or polling output. */
export function recordDeterministicExecution(target: RecordTarget, entry: Omit<Extract<TaskHistoryEntry, { kind: 'deterministic-execution' }>, 'kind'>): void {
  if (target.history?.some(value => value.kind === 'deterministic-execution' && value.executionId === entry.executionId)) return;
  append(target, { kind: 'deterministic-execution', ...entry });
}
/** A failed delivery and later acceptance are distinct settled facts; recovery repeats neither. */
export function recordDeterministicHandoff(target: RecordTarget, entry: Omit<Extract<TaskHistoryEntry, { kind: 'deterministic-handoff' }>, 'kind'>): void {
  if (target.history?.some(value => value.kind === 'deterministic-handoff' && value.deliveryId === entry.deliveryId && value.outcome === entry.outcome)) return;
  append(target, { kind: 'deterministic-handoff', ...entry });
}

function append(target: RecordTarget, entry: TaskHistoryEntry): void {
  target.history = [...(target.history ?? []), entry];
}

/** The auto mode change one append carries. */
export type AutoModeChange =
  | { readonly action: 'enabled' | 'disabled' | 'resumed' }
  | { readonly action: 'paused'; readonly reason: AutoModePauseReason; readonly message?: string }
  | { readonly action: 'agent-paused'; readonly reason: string };

/** The settled outcome one operation append carries. */
export type WorktreeOutcome =
  | { readonly action: 'created'; readonly path: string; readonly branch: string }
  | { readonly action: 'attached'; readonly path: string }
  | { readonly action: 'removed'; readonly path: string }
  | { readonly action: 'failed'; readonly error: Problem; readonly path?: string };

/** The task was created in `columnId`. */
export function recordCreation(target: RecordTarget, columnId: string, at: string): void {
  append(target, { kind: 'created', at, columnId });
}

/**
 * A stage entry is a move, so it is recorded only when the stage actually changes.
 * The origin says how the move happened; an absent one stores no origin at all,
 * which is what a record written before origins existed carries.
 */
export function recordStageEntry(target: RecordTarget, fromColumnId: string, columnId: string, at: string, origin?: StageEntryOrigin): void {
  if (fromColumnId === columnId) return;
  append(target, { kind: 'stage', at, fromColumnId, columnId, ...(origin === undefined ? {} : { origin }) });
}

/** The task recorded the destination of its next advance. */
export function recordIntent(target: RecordTarget, fromColumnId: string, columnId: string, at: string): void {
  append(target, { kind: 'intent', at, fromColumnId, columnId });
}

/** One auto mode change settled. */
export function recordAutoModeChange(target: RecordTarget, change: AutoModeChange, at: string): void {
  if (change.action === 'paused') {
    append(target, { kind: 'auto-mode', at, action: change.action, reason: change.reason, ...(change.message === undefined ? {} : { message: change.message }) });
    return;
  }
  if (change.action === 'agent-paused') {
    append(target, { kind: 'auto-mode', at, action: change.action, reason: change.reason });
    return;
  }
  append(target, { kind: 'auto-mode', at, action: change.action });
}

/** One worktree or context operation settled. */
export function recordWorktreeOutcome(target: RecordTarget, outcome: WorktreeOutcome, at: string): void {
  append(target, { kind: 'worktree', at, ...outcome });
}
