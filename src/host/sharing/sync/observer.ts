import { normalizeBoardName } from '../../../domain/sharing/identity.js';
import { eventsAfter, publishedWorkflow, replay } from '../../../domain/journal/log.js';
import { boardProblemOf } from '../board-compatibility.js';
import { emptyBoard, type HubSharingRecord, type PublishedBoard, type StoredBoard } from '../state.js';
import type { SharedLayoutStore } from '../ports.js';
import { foldIdentity, identityDiverged, isTombstoned, mirrorIdentity } from './identity.js';
import type { SharingSession } from './session.js';
import type { LayoutStampPolicy } from './stamp.js';

/** What one observation saw, ready to be stored on the record. */
export interface Observation {
  boards: Record<string, StoredBoard>;
  published: Record<string, PublishedBoard>;
}

/**
 * Reading the published layout and applying nothing. A check only records what the
 * storage holds; applying stays an explicit action for the affected board.
 */
export class BoardObserver {
  constructor(private readonly session: SharingSession, private readonly stamp: LayoutStampPolicy) {}

  /** Read the published set and the logs that changed since the last observation. */
  async observe(record: HubSharingRecord, layout: SharedLayoutStore): Promise<Observation> {
    const hub = this.session.options.hubs.requireHub(record.hubId);
    const bound = new Set(Object.values(record.bindings));
    const localBoards = new Map(Object.entries(record.bindings).map(([boardId, key]) => [key, hub.boards.find(board => board.id === boardId)]));
    const boards: Record<string, StoredBoard> = { ...record.boards };
    const published: Record<string, PublishedBoard> = {};
    const listed = await layout.listLogs();
    const seen = new Set<string>();
    for (const entry of listed) {
      seen.add(entry.key);
      const stored = boards[entry.key] ?? emptyBoard();
      // A board that carries a problem is always re-read: an unchanged probe would
      // otherwise keep a plugin-update state after the plugin was updated.
      if (entry.probe === stored.probe && stored.head !== null && stored.present && stored.problem == null) {
        published[entry.key] = { key: entry.key, name: stored.name ?? entry.key, rank: stored.rank, removed: stored.removal };
        continue;
      }
      let snapshot;
      try { snapshot = await layout.readLog(entry.key); }
      catch (error) {
        // A board this installation cannot read is that board's plugin-update state: it
        // is neither applied nor published over, and every other board still synchronizes.
        const problem = boardProblemOf(error);
        if (problem === null) throw error;
        boards[entry.key] = { ...stored, probe: entry.probe, present: true, problem, updates: 0, removal: false, conflict: null, incoming: null };
        published[entry.key] = { key: entry.key, name: stored.name ?? entry.key, rank: stored.rank, removed: false };
        continue;
      }
      if (snapshot === null) continue;
      // An unbound tombstone cannot affect a local board and must not obstruct
      // observation of unrelated live boards, even if its old contents are newer.
      if (!bound.has(entry.key) && isTombstoned(snapshot.log)) {
        published[entry.key] = { key: entry.key, name: stored.name ?? entry.key, rank: stored.rank, removed: true };
        continue;
      }
      const pending = eventsAfter(snapshot.log, stored.seq);
      const removal = pending.some(event => event.kind === 'board.removed');
      const identity = foldIdentity(mirrorIdentity(stored), pending);
      published[entry.key] = { key: entry.key, name: identity.name ?? entry.key, rank: identity.rank, removed: removal };
      if (!bound.has(entry.key)) {
        // A board this installation could not read before and can read now is adoptable
        // again: the recorded plugin-update state must not outlive the reason for it, and
        // the identity this observation read travels with it, so the next check can
        // report the team's name instead of the storage key.
        if (stored.problem != null) {
          boards[entry.key] = { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, problem: null, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank };
        }
        continue;
      }
      if (pending.length === 0) {
        boards[entry.key] = { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, updates: 0, removal: false, conflict: null, incoming: null, problem: null };
        continue;
      }
      const dry = replay(snapshot.log, stored.workflow === null ? null : { text: stored.workflow, cursor: stored.seq });
      // A local rename the team never saw is a divergence: applying is not safe until
      // the user chooses, so the board is presented as a review before anything lands.
      const localBoard = localBoards.get(entry.key);
      const diverged = localBoard !== undefined && identityDiverged(localBoard.workflowYaml, pending);
      boards[entry.key] = {
        ...stored,
        head: snapshot.head,
        probe: snapshot.probe,
        present: true,
        updates: pending.length,
        removal,
        conflict: diverged ? 'identity' : dry.ok ? null : dry.conflict.kind,
        incoming: diverged || !dry.ok ? publishedWorkflow(snapshot.log) : null,
        problem: null,
      };
    }
    // A log the storage no longer lists is absent, not removed: keep the mirror so a
    // publish can recreate it, and mark it absent so the board reads as a draft.
    for (const [key, stored] of Object.entries(boards)) {
      if (seen.has(key)) continue;
      boards[key] = { ...stored, present: false, head: null, probe: null, updates: 0, removal: false, conflict: null, incoming: null };
    }
    return { boards, published };
  }

  /** Read the layout, observe every board, and persist what was seen. */
  async check(hubId: string, manual: boolean): Promise<void> {
    let record = this.session.requireRecord(hubId);
    const layout = this.session.layoutFor(record);
    const at = this.session.now();
    try {
      const stamp = await layout.readStamp();
      const versionProblem = stamp !== null && stamp.version !== this.stamp.version ? this.stamp.versionProblem(stamp.version) : null;
      // A Hub that already published knows its layout must be there: if the stamp is
      // gone, the storage was changed outside the plugin and nothing may be applied.
      const missing = stamp === null && (Object.keys(record.boards).length > 0 || Object.keys(record.published).length > 0);
      let boards = record.boards;
      let published = record.published;
      if (versionProblem === null && !missing) {
        ({ boards, published } = await this.observe(record, layout));
        // A board the team publishes again reconnects to the orphan it left here.
        const rebound = this.reconnectOrphans({ ...record, boards, published });
        if (rebound.changed) {
          record = { ...record, bindings: rebound.bindings, orphans: rebound.orphans };
          ({ boards, published } = await this.observe(record, layout));
        }
      }
      const keepReview = record.reviewRequired?.code === 'SHARING_CONCURRENT_WRITE' ? record.reviewRequired : null;
      await this.session.save({
        ...record,
        providerState: layout.state?.() ?? record.providerState,
        storageReview: layout.review?.() ?? null,
        boards,
        published,
        lastCheck: { at, token: stamp === null ? 'none' : String(stamp.version) },
        lastSyncedAt: record.lastSyncedAt ?? null,
        reviewRequired: versionProblem ?? keepReview,
        lastError: missing ? { code: 'SHARING_DOCUMENT_MISSING', message: 'The team configuration is missing from the storage. Refresh or reconnect the Hub.' } : null,
      });
    } catch (error) {
      await this.session.persistFailure(record, error);
      throw error;
    }
    void manual;
  }

  /** Re-read the boards after an apply or a publish, so the status matches what landed. */
  async refresh(record: HubSharingRecord, layout: SharedLayoutStore): Promise<HubSharingRecord> {
    const observed = await this.observe(record, layout);
    const next = { ...record, boards: observed.boards, published: observed.published, providerState: layout.state?.() ?? record.providerState, storageReview: layout.review?.() ?? null };
    await this.session.save(next);
    return next;
  }

  /** Rebind a local board to a published key that matches the orphan it became. */
  private reconnectOrphans(record: HubSharingRecord): { bindings: HubSharingRecord['bindings']; orphans: HubSharingRecord['orphans']; changed: boolean } {
    const bindings = { ...record.bindings };
    const orphans = { ...record.orphans };
    const used = new Set(Object.values(bindings));
    const candidates = Object.values(record.published).filter(entry => !entry.removed && !used.has(entry.key));
    let changed = false;
    for (const [boardId, orphan] of Object.entries(record.orphans)) {
      if (bindings[boardId] !== undefined) continue;
      const byKey = candidates.find(entry => entry.key === orphan.lastKey && !used.has(entry.key));
      const byName = candidates.find(entry => normalizeBoardName(entry.name) === normalizeBoardName(orphan.lastPublishedName) && !used.has(entry.key));
      const match = byKey ?? byName;
      if (match === undefined) continue;
      bindings[boardId] = match.key;
      used.add(match.key);
      delete orphans[boardId];
      changed = true;
    }
    return { bindings, orphans, changed };
  }
}
