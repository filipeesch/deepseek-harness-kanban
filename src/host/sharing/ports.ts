import type { BoardLog } from '../../domain/journal/log.js';
import type { BoardChange } from '../../domain/journal/event.js';
import type { ProviderState } from './provider.js';

/**
 * The two storage operations publishing needs: the layout stamp, and one append-only
 * event log per board.
 *
 * The stamp states the layout format and nothing else. A board log is append-only, so
 * it carries the head an append extends; the published board set is the logs that
 * exist, and a provider answers which of them changed since an observation.
 */

/** A decision the storage itself requires before it may synchronize. */
export interface StorageReview {
  code: string;
  message: string;
  /** Entries that require the decision, when the storage can name them. */
  files: string[];
}

/** One read layout stamp. */
export interface LayoutStampSnapshot { readonly version: number }

/** One board log as a store served it, with the head an append must match. */
export interface BoardLogSnapshot {
  /** A cheap change probe, comparable across reads of the same board. */
  readonly probe: string;
  /** The head token an append must match. */
  readonly head: string;
  readonly log: BoardLog;
}

/** One published log as an enumeration sees it. */
export interface ListedBoardLog {
  readonly key: string;
  readonly probe: string;
}

export interface AppendOptions {
  /** The head the caller read; a storage refuses an append that no longer matches. */
  readonly expectedHead: string | null;
  readonly message: string;
  readonly at: string;
  readonly signal?: AbortSignal;
}

/** The layout stamp half of one storage binding. */
export interface LayoutStampStore {
  ensure(): Promise<void>;
  readStamp(signal?: AbortSignal): Promise<LayoutStampSnapshot | null>;
  writeStamp(version: number, options: { expectedVersion: number | null }, signal?: AbortSignal): Promise<LayoutStampSnapshot>;
}

/** The board-log half of one storage binding. */
export interface BoardLogStore {
  /** Every published board log the storage holds, with a cheap probe for each. */
  listLogs(signal?: AbortSignal): Promise<readonly ListedBoardLog[]>;
  /** A cheap probe of one board's log, or null when the board has no log. */
  probe(key: string, signal?: AbortSignal): Promise<string | null>;
  /** Read one board's log, or null when the board has none. */
  readLog(key: string, signal?: AbortSignal): Promise<BoardLogSnapshot | null>;
  /** Create a board's log from its genesis batch. An existing log is refused. */
  createLog(key: string, log: BoardLog, signal?: AbortSignal): Promise<BoardLogSnapshot>;
  /** Append changes to one board's log against the head the caller read. */
  appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot>;
}

/** Everything one storage binding offers. A provider implements this and nothing else. */
export interface SharedLayoutStore extends LayoutStampStore, BoardLogStore {
  state?(): ProviderState;
  review?(): StorageReview | null;
  destroy(): Promise<void>;
}
