import { invariant } from '../../../shared/errors.js';
import { normalizeBoardName, boardKeyFromName } from '../../../domain/sharing/identity.js';
import { publishedWorkflow } from '../../../domain/journal/log.js';
import { boardProblemOf, type BoardProblem } from '../board-compatibility.js';
import type { PreviewBoard } from '../state.js';
import { emptyBoard, type HubSharingRecord, type PublishedBoard, type StoredBoard } from '../state.js';
import type { BoardLogSnapshot, SharedLayoutStore } from '../ports.js';
import { foldIdentity, isTombstoned, NO_IDENTITY } from './identity.js';
import type { SharingSession } from './session.js';
import type { LayoutStampPolicy } from './stamp.js';

/** The applier operations a connection needs. */
export interface ApplyAllPort {
  applyAll(hubId: string): Promise<void>;
}

/** The publisher operations a connection needs. */
export interface PublishPort {
  publishAll(hubId: string): Promise<void>;
  publishBoardNow(record: HubSharingRecord, boardId: string, rankOverride: string | null, alsoRefresh?: boolean): Promise<void>;
}

/** The lifecycle surface a storage connection drives, and nothing more. */
export interface BoardConnectionPort extends ApplyAllPort {
  publishInitial(record: HubSharingRecord): Promise<void>;
  readPreview(record: HubSharingRecord, layout: SharedLayoutStore): Promise<PreviewBoard[]>;
  receivePreview(record: HubSharingRecord): Promise<HubSharingRecord>;
}

/**
 * The connection-time operations: what the storage holds before adopting it, adopting
 * it, replacing it with this Hub's boards, and publishing an orphan under a new key.
 */
export class ConnectionOperations implements BoardConnectionPort {
  constructor(
    private readonly session: SharingSession,
    private readonly applier: ApplyAllPort,
    private readonly publisher: PublishPort,
    private readonly stamp: LayoutStampPolicy,
  ) {}

  async applyAll(hubId: string): Promise<void> { await this.applier.applyAll(hubId); }

  /** The published boards this installation has not adopted, read for the choice at connect. */
  async readPreview(record: HubSharingRecord, layout: SharedLayoutStore): Promise<PreviewBoard[]> {
    const boards: PreviewBoard[] = [];
    for (const listed of await layout.listLogs()) {
      const { snapshot } = await this.readPublished(layout, listed.key);
      if (snapshot === null) continue;
      // A tombstoned board is not offered for adoption; its old contents must not
      // block the preview of unrelated live boards.
      if (isTombstoned(snapshot.log)) continue;
      const workflow = publishedWorkflow(snapshot.log);
      if (workflow === null) continue;
      const identity = foldIdentity(NO_IDENTITY, snapshot.log);
      boards.push({ key: listed.key, name: identity.name ?? listed.key, projectKeys: identity.projectKeys, rank: identity.rank, workflow });
    }
    return boards;
  }

  /** Bind the local boards a preview names, so receiving adopts the team's boards by name. */
  async receivePreview(record: HubSharingRecord): Promise<HubSharingRecord> {
    const preview = record.preview;
    invariant(preview, 'SHARING_NO_PREVIEW', 'This Hub has no pending connection preview.');
    const hub = this.session.options.hubs.requireHub(record.hubId);
    const bindings = { ...record.bindings };
    for (const board of hub.boards) {
      if (bindings[board.id] !== undefined) continue;
      const entry = preview.boards.find(candidate => normalizeBoardName(candidate.name) === normalizeBoardName(board.name));
      if (entry !== undefined) bindings[board.id] = entry.key;
    }
    const published: Record<string, PublishedBoard> = {};
    for (const entry of preview.boards) published[entry.key] = { key: entry.key, name: entry.name, rank: entry.rank, removed: false };
    return { ...record, preview: null, bindings, published, lastSyncedAt: this.session.now(), reviewRequired: null, lastError: null };
  }

  /** Replace the published configuration with this Hub's boards, tombstoning what it drops. */
  async publishInitial(record: HubSharingRecord): Promise<void> {
    const layout = this.session.layoutFor(record);
    // The keys that were published stay known while the replacement is written, so the
    // new logs cannot collide with the logs that were just tombstoned.
    const published: Record<string, PublishedBoard> = {};
    const snapshots: Array<{ key: string; snapshot: BoardLogSnapshot }> = [];
    // A board this installation cannot read is left untouched but remembered, so the Hub
    // reports it as needing a plugin update instead of offering an adoption that fails.
    const unreadable: Record<string, StoredBoard> = {};
    for (const listed of await layout.listLogs()) {
      const { snapshot, problem } = await this.readPublished(layout, listed.key);
      if (snapshot === null) {
        if (problem !== null) unreadable[listed.key] = { ...emptyBoard(), probe: listed.probe, present: true, problem };
        continue;
      }
      snapshots.push({ key: listed.key, snapshot });
    }
    for (const { key, snapshot } of snapshots) {
      const listed = { key };
      published[listed.key] = { key: listed.key, name: record.published[listed.key]?.name ?? listed.key, rank: record.published[listed.key]?.rank ?? null, removed: true };
      if (snapshot.log.some(event => event.kind === 'board.removed')) continue;
      await layout.appendChanges(listed.key, [{ kind: 'board.removed' }], { expectedHead: snapshot.head, message: 'Replace published Kanban configuration', at: this.session.now() });
    }
    await this.stamp.ensure(layout);
    const cleared: HubSharingRecord = { ...record, preview: null, bindings: {}, boards: unreadable, published, orphans: {}, removed: {}, pendingRemovals: {} };
    await this.session.save(cleared);
    await this.publisher.publishAll(record.hubId);
  }

  /**
   * Read one published log, or state why this installation cannot read it. A board
   * written by a newer plugin version is left untouched and is not offered for
   * adoption: it is never applied and never published over, and the readable boards of
   * the same storage still connect.
   */
  private async readPublished(layout: SharedLayoutStore, key: string): Promise<{ snapshot: BoardLogSnapshot | null; problem: BoardProblem | null }> {
    try {
      return { snapshot: await layout.readLog(key), problem: null };
    } catch (error) {
      const problem = boardProblemOf(error);
      if (problem === null) throw error;
      return { snapshot: null, problem };
    }
  }

  /** Publish an orphan board the team removed under a fresh key. */
  async publishOrphan(hubId: string, boardId: string): Promise<void> {
    const record = this.session.requireRecord(hubId);
    const orphan = record.orphans[boardId];
    invariant(orphan !== undefined, 'SHARING_NOT_ORPHAN', 'The board is not an orphan.');
    const board = this.session.options.hubs.requireHub(hubId).boards.find(candidate => candidate.id === boardId);
    invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist.');
    const orphans = { ...record.orphans };
    delete orphans[boardId];
    const taken = new Set([...Object.keys(record.published), ...Object.values(record.bindings)]);
    const key = boardKeyFromName(orphan.lastPublishedName, taken);
    await this.session.save({ ...record, orphans, bindings: { ...record.bindings, [boardId]: key } });
    await this.publisher.publishBoardNow(this.session.requireRecord(hubId), boardId, null);
  }
}
