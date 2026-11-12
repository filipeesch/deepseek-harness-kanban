import type { Problem } from './types.js';

/**
 * The flow facts one task's record carries, and the moment each one happened.
 *
 * An entry names what happened, never how it is rendered: stage names, labels,
 * and durations belong to the presentation, so changing copy never rewrites a
 * stored row.
 */

/** The auto mode changes a task's record carries. */
export const AUTO_MODE_HISTORY_ACTIONS = ['enabled', 'disabled', 'paused', 'agent-paused', 'resumed'] as const;
export type AutoModeHistoryAction = (typeof AUTO_MODE_HISTORY_ACTIONS)[number];

/** The worktree and context-operation outcomes a task's record carries. */
export const WORKTREE_HISTORY_ACTIONS = ['created', 'attached', 'removed', 'failed'] as const;
export type WorktreeHistoryAction = (typeof WORKTREE_HISTORY_ACTIONS)[number];

/**
 * How one stage entry happened: an operator move, a transition the task declared,
 * an automatic advance, a named script exit, or the reserved error route. A script
 * or error origin names the exit that routed the card.
 */
export type StageEntryOrigin = 'manual' | 'agent' | 'auto' | `script:${string}` | `error:${string}`;

/** One settled fact about a task's flow, with the moment it happened. */
export type TaskHistoryEntry =
  | { readonly kind: 'deterministic-execution'; readonly at: string; readonly executionId: string; readonly columnId: string; readonly outcome: 'completed' | 'stopped' | 'failed'; readonly exit?: string; readonly message?: string; readonly error?: Problem; /** Bounded values that execution used; absent when its stage declared none. */ readonly parameters?: Record<string, string> }
  | { readonly kind: 'deterministic-handoff'; readonly at: string; readonly deliveryId: string; readonly executionId: string; readonly fromColumnId: string; readonly columnId: string; readonly outcome: 'accepted' | 'failed'; readonly exit: string; readonly message: string; readonly error?: Problem }
  | { readonly kind: 'created'; readonly at: string; readonly columnId: string }
  | { readonly kind: 'stage'; readonly at: string; readonly fromColumnId: string; readonly columnId: string; /** Absent on an entry recorded before origins were stored; never backfilled. */ readonly origin?: StageEntryOrigin }
  | { readonly kind: 'intent'; readonly at: string; readonly fromColumnId: string; readonly columnId: string }
  | {
    readonly kind: 'auto-mode';
    readonly at: string;
    readonly action: AutoModeHistoryAction;
    /** Present only for a pause, naming what paused it. */
    readonly reason?: string;
    /** Present only for a host pause that carries a diagnostic message. */
    readonly message?: string;
  }
  | {
    readonly kind: 'worktree';
    readonly at: string;
    readonly action: WorktreeHistoryAction;
    readonly path?: string;
    /** Present for a created worktree. */
    readonly branch?: string;
    /** Present only for a failed operation. */
    readonly error?: Problem;
  };

/** One task's ordered flow record; absent on a task that recorded nothing yet. */
export type TaskHistory = TaskHistoryEntry[];
