import type { SharedHubManifest } from '../../domain/sharing/manifest.js';
import type { BoardChange, JournalEvent } from '../../domain/journal/event.js';
import type { BoardLogFile } from '../../domain/journal/log.js';
import type { ProviderState } from './provider.js';

/**
 * The two storage operations publishing needs, one per published unit.
 *
 * The manifest is small and written whole, so it carries a content token. A board
 * log is append-only, so it carries the head of the log an append extends. Change
 * detection is a third, cheap operation: it answers whether a board may have
 * changed without reading it, using whatever the storage offers.
 */

/** A decision the storage itself requires before it may synchronize. */
export interface StorageReview {
  code: string;
  message: string;
  /** Entries that require the decision, when the storage can name them. */
  files: string[];
}

/** One manifest as a store served it, with its content token. */
export interface ManifestSnapshot {
  readonly token: string;
  readonly manifest: SharedHubManifest;
  /** Board workflows a version 1 or 2 configuration carried, keyed by board key. */
  readonly legacyWorkflows: Record<string, string>;
}

/** One board log as a store served it, with the token an append must match. */
export interface BoardLogSnapshot {
  /** A cheap change probe, comparable across reads of the same board. */
  readonly probe: string;
  /** The head token an append must match. */
  readonly head: string;
  readonly log: BoardLogFile;
}

export interface AppendOptions {
  /** The head the caller read; a storage refuses an append that no longer matches. */
  readonly expectedHead: string | null;
  readonly message: string;
  /** The moment the events happened. */
  readonly at: string;
  readonly signal?: AbortSignal;
}

/** The manifest half of one storage binding. */
export interface HubManifestStore {
  ensure(): Promise<void>;
  readManifest(signal?: AbortSignal, cached?: ManifestSnapshot | null): Promise<ManifestSnapshot | null>;
  writeManifest(manifest: SharedHubManifest, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }>;
}

/** The board-log half of one storage binding. */
export interface BoardLogStore {
  /** A cheap probe of one board's log, or null when the board has no log. */
  probe(key: string, signal?: AbortSignal): Promise<string | null>;
  /** Read one board's log, or null when the board has none. */
  readLog(key: string, signal?: AbortSignal, cached?: BoardLogSnapshot | null): Promise<BoardLogSnapshot | null>;
  /**
   * Create a board's log from its first snapshot, when the board is published for
   * the first time. A log that already exists is refused instead of replaced.
   */
  createLog(key: string, text: string, signal?: AbortSignal): Promise<BoardLogSnapshot>;
  /** Append changes to one board's log against the head the caller read. */
  appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot>;
  /** Remove one board's log, used when a team-wide removal is published. */
  removeLog?(key: string): Promise<void>;
}

/** Everything one storage binding offers. A provider implements this and nothing else. */
export interface SharedLayoutStore extends HubManifestStore, BoardLogStore {
  state?(): ProviderState;
  review?(): StorageReview | null;
  destroy(): Promise<void>;
}

/** One board as a sync unit sees it: its cursor, its last head, and its last probe. */
export interface BoardCursor {
  readonly key: string;
  readonly seq: number;
  readonly head: string | null;
  readonly probe: string | null;
}

/** The events a member at the given cursor still has to apply. */
export function unseenEvents(snapshot: BoardLogSnapshot, cursor: number): readonly JournalEvent[] {
  return snapshot.log.events.filter(event => event.seq > cursor);
}
