import { KanbanError } from '../../shared/errors.js';
import type { BoardChange } from '../../domain/journal/event.js';
import { deriveChanges } from '../../domain/journal/derive.js';
import { recoverBoard, type BoardLogFile } from '../../domain/journal/log.js';
import { stageRenames, type StageRename } from '../../domain/journal/migrate.js';
import { evaluateBoard, orphanedColumns, publishedWorkflow, type BoardApplyOutcome, type BoardEvaluation, type LocalBoardView } from '../../domain/sharing/board-plan.js';
import type { SharedBoardEntry } from '../../domain/sharing/manifest.js';
import type { BoardLogSnapshot, SharedLayoutStore } from './ports.js';

/**
 * One board's synchronization unit.
 *
 * It owns a board's cursor, its apply, its publish, and its status, and it touches
 * nothing else: two boards advance independently, and a board that cannot advance
 * leaves the others working.
 */

/** The cursor and observations one installation holds for one board. */
export interface BoardCursor {
  readonly seq: number;
  readonly head: string | null;
  readonly probe: string | null;
}

export interface BoardCursorStore {
  read(key: string): BoardCursor | undefined;
  write(key: string, cursor: BoardCursor): void;
}

export interface BoardSyncDeps {
  readonly layout: SharedLayoutStore;
  readonly cursors: BoardCursorStore;
  /** The local board as the sharing rules see it, or undefined when it does not exist. */
  readLocal(key: string): LocalBoardView | undefined;
  /**
   * Store an applied workflow. The renames travel with it so the same transaction
   * carries them into the board's tasks.
   */
  storeApplied(boardId: string, text: string, renames: readonly StageRename[]): Promise<void>;
  now(): string;
  /** Allocates the identity of a stage this installation has never published. */
  allocate?: () => string;
  /** Removes a board's log after a team-wide removal is published. */
  removeBoardLog?(key: string): Promise<void>;
}

export type BoardApplyResult =
  | { readonly applied: false; readonly reason: 'no-log' | 'nothing' | 'missing-board' }
  | { readonly applied: true; readonly events: number; readonly renames: readonly StageRename[] }
  | { readonly applied: false; readonly reason: 'conflict'; readonly conflict: 'identity' | 'lifecycle'; readonly message: string }
  | { readonly applied: false; readonly reason: 'orphan'; readonly columnIds: readonly string[] };

export type BoardPublishResult =
  | { readonly published: false; readonly reason: 'not-bound' | 'unreadable' | 'nothing' | 'updates-pending' }
  | { readonly published: true; readonly events: number; readonly head: string; readonly cursor: BoardCursor };

export class BoardSyncUnit {
  constructor(private readonly deps: BoardSyncDeps) {}

  private readCursor(key: string): BoardCursor {
    return this.deps.cursors.read(key) ?? { seq: 0, head: null, probe: null };
  }

  /** Read one board's log, or null when the board has no published log. */
  async readLog(key: string, cached?: BoardLogSnapshot | null): Promise<BoardLogSnapshot | null> {
    return this.deps.layout.readLog(key, undefined, cached);
  }

  /** The board's current state without touching storage it already read. */
  async status(entry: SharedBoardEntry | undefined, key: string | undefined): Promise<BoardEvaluation | null> {
    const local = key === undefined ? undefined : this.deps.readLocal(key);
    if (local === undefined) return null;
    const log = key === undefined ? null : await this.readLog(key);
    const cursor = key === undefined ? 0 : this.readCursor(key).seq;
    return evaluateBoard({ entry, local, log: log?.log ?? null, cursor });
  }

  /** Apply one board's unseen events. Only this board's cursor advances. */
  async apply(key: string, entry: SharedBoardEntry): Promise<BoardApplyResult> {
    const local = this.deps.readLocal(key);
    if (local === undefined) return { applied: false, reason: 'missing-board' };
    const snapshot = await this.readLog(key);
    if (snapshot === null) return { applied: false, reason: 'no-log' };
    const cursor = this.readCursor(key);
    const unseen = snapshot.log.events.filter(event => event.seq > cursor.seq);
    if (unseen.length === 0) return { applied: false, reason: 'nothing' };
    const recovered = recoverBoard(snapshot.log, { text: local.workflow, cursor: cursor.seq });
    if (!recovered.ok) return { applied: false, reason: 'conflict', conflict: recovered.conflict.kind, message: recovered.conflict.message };
    const orphaned = orphanedColumns(recovered.text, local);
    if (orphaned.length > 0) return { applied: false, reason: 'orphan', columnIds: orphaned };
    const renames = stageRenames(unseen);
    await this.deps.storeApplied(local.boardId, recovered.text, renames);
    this.deps.cursors.write(key, { seq: recovered.cursor, head: snapshot.head, probe: snapshot.probe });
    return { applied: true, events: recovered.events, renames };
  }

  /** Publish one board's local changes as events appended to its log. */
  async publish(key: string): Promise<BoardPublishResult> {
    const local = this.deps.readLocal(key);
    if (local === undefined) return { published: false, reason: 'not-bound' };
    const snapshot = await this.readLog(key);
    if (snapshot === null) return { published: false, reason: 'unreadable' };
    const cursor = this.readCursor(key);
    // Publishing extends the log, so this installation must be at its head first: an
    // append over events it has not applied would derive them again.
    const head = lastSequence(snapshot.log);
    if (cursor.seq < head) return { published: false, reason: 'updates-pending' };
    if (cursor.head !== null && cursor.head !== snapshot.head) {
      throw new KanbanError('SHARING_STALE_TOKEN', 'The board log changed since it was read. Get the team updates before publishing.', { key });
    }
    const published = publishedWorkflow(snapshot.log);
    if (published === null) return { published: false, reason: 'unreadable' };
    const changes: BoardChange[] = deriveChanges(
      { text: published },
      { text: local.workflow },
      { ...(this.deps.allocate === undefined ? {} : { allocate: this.deps.allocate }) },
    );
    if (changes.length === 0) {
      this.deps.cursors.write(key, { seq: cursor.seq, head: snapshot.head, probe: snapshot.probe });
      return { published: false, reason: 'nothing' };
    }
    const appended = await this.deps.layout.appendChanges(key, changes, { expectedHead: snapshot.head, message: 'Update published Kanban board', at: this.deps.now() });
    const next: BoardCursor = { seq: lastSequence(appended.log), head: appended.head, probe: appended.probe };
    this.deps.cursors.write(key, next);
    return { published: true, events: changes.length, head: appended.head, cursor: next };
  }

  /** Remember what a check observed, without applying or publishing anything. */
  async observe(key: string): Promise<BoardApplyOutcome> {
    const snapshot = await this.readLog(key);
    if (snapshot === null) return { kind: 'nothing' };
    const cursor = this.readCursor(key);
    const local = this.deps.readLocal(key);
    if (local === undefined) return { kind: 'nothing' };
    const recovered = recoverBoard(snapshot.log, { text: local.workflow, cursor: cursor.seq });
    this.deps.cursors.write(key, { ...cursor, probe: snapshot.probe, head: cursor.head ?? snapshot.head });
    if (!recovered.ok) return { kind: 'conflict', conflict: recovered.conflict.kind, message: recovered.conflict.message };
    return recovered.events === 0 ? { kind: 'nothing' } : { kind: 'applies', events: recovered.events, text: recovered.text };
  }
}

function lastSequence(log: BoardLogFile): number {
  return log.events.length === 0 ? log.snapshot.seq : log.events[log.events.length - 1]!.seq;
}
