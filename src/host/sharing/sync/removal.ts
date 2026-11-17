import { KanbanError, invariant } from '../../../shared/errors.js';
import type { HubSharingRecord } from '../state.js';
import type { BoardApplier } from './applier.js';
import type { SharingSession } from './session.js';

/** Whether a board removal applies only here or to the team. */
export type RemovalScope = 'local' | 'team';

/** The applier operation a restore needs. */
export interface ApplyPort {
  applyKey(record: HubSharingRecord, key: string, alsoRefresh?: boolean): Promise<void>;
}

/**
 * Removing a board: the local-only tombstone, the removal event the team receives, the
 * removals still owed to the team, and restoring a locally removed board.
 */
export class BoardRemoval {
  constructor(private readonly session: SharingSession, private readonly applier: ApplyPort | BoardApplier) {}

  async recordRemoval(hubId: string, boardId: string, scope: RemovalScope, name: string): Promise<void> {
    this.session.assertReady(this.session.requireRecord(hubId));
    const record = this.session.load(hubId);
    if (record === undefined) return;
    const key = record.bindings[boardId];
    const bindings = { ...record.bindings };
    const boards = { ...record.boards };
    const orphans = { ...record.orphans };
    delete bindings[boardId];
    delete orphans[boardId];
    if (key === undefined) { await this.session.save({ ...record, bindings, orphans }); return; }
    delete boards[key];
    const removed = { ...record.removed };
    const pendingRemovals = { ...record.pendingRemovals };
    const published = { ...record.published };
    if (scope === 'local') removed[key] = { boardId, name };
    else if (published[key] !== undefined) {
      const appended = await this.appendRemoval(record, key);
      if (appended) delete published[key]; else pendingRemovals[key] = { name };
    }
    await this.session.save({ ...record, bindings, boards, orphans, removed, pendingRemovals, published });
    if (scope === 'team' && key !== undefined && pendingRemovals[key] !== undefined) {
      throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'The board was removed here, but its removal event could not be sent. Publish all retries it.', { boardId, key });
    }
  }

  /** Append the removal event for one key, against the head the storage currently has. */
  private async appendRemoval(record: HubSharingRecord, key: string): Promise<boolean> {
    const layout = this.session.layoutFor(record);
    try {
      const snapshot = await layout.readLog(key);
      if (snapshot === null) return true;
      await layout.appendChanges(key, [{ kind: 'board.removed' }], { expectedHead: snapshot.head, message: 'Remove published Kanban board', at: this.session.now() });
      return true;
    } catch (error) {
      this.session.report(error);
      return false;
    }
  }

  /** Retry the removals this installation still owes the team. */
  async flushPendingRemovals(record: HubSharingRecord): Promise<HubSharingRecord> {
    if (Object.keys(record.pendingRemovals).length === 0) return record;
    const pendingRemovals = { ...record.pendingRemovals };
    const published = { ...record.published };
    for (const key of Object.keys(pendingRemovals)) {
      if (await this.appendRemoval(record, key)) { delete pendingRemovals[key]; delete published[key]; }
    }
    const next = { ...record, pendingRemovals, published };
    await this.session.save(next);
    return next;
  }

  async restore(hubId: string, boardId: string): Promise<void> {
    const record = this.session.requireRecord(hubId);
    const entry = Object.entries(record.removed).find(([, value]) => value.boardId === boardId);
    invariant(entry, 'SHARING_NOT_REMOVED', 'The board is not removed only from this installation.');
    const [key] = entry;
    const removed = { ...record.removed };
    delete removed[key];
    const published = record.published[key];
    if (published === undefined || published.removed) {
      await this.session.save({ ...record, removed });
      throw new KanbanError('SHARING_REMOVED_GONE', 'The team board no longer exists, so it cannot be restored.');
    }
    const hub = this.session.options.hubs.requireHub(hubId);
    const exists = hub.boards.some(candidate => candidate.id === boardId);
    const bindings = { ...record.bindings };
    delete bindings[boardId];
    const next = { ...record, removed, bindings: exists ? { ...bindings, [boardId]: key } : bindings };
    await this.session.save(next);
    await this.applier.applyKey(this.session.requireRecord(hubId), key);
  }
}
