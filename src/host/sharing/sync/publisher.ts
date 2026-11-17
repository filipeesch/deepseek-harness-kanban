import { KanbanError, invariant } from '../../../shared/errors.js';
import { boardKeyFromName } from '../../../domain/sharing/identity.js';
import { planRanks, rankBetween, rebalanceRanks } from '../../../domain/sharing/board-rank.js';
import { evaluateBoard, type BoardMirrorView, type BoardSharingState } from '../../../domain/sharing/board-plan.js';
import { projectSharingBoards, type LocalSharedBoard } from '../../../domain/sharing/projection.js';
import { deriveBoardChanges } from '../../../domain/journal/derive.js';
import { appendEvents, lastSequence, needsCheckpoint } from '../../../domain/journal/log.js';
import { materializeIdentities } from '../../../domain/journal/materialize.js';
import type { BoardChange } from '../../../domain/journal/event.js';
import * as operations from '../../../domain/hub-operations.js';
import { needsPluginUpdate } from '../board-compatibility.js';
import { emptyBoard, type HubSharingRecord, type StoredBoard } from '../state.js';
import { mirrorView } from './identity.js';
import type { BoardObserver } from './observer.js';
import type { SharingSession } from './session.js';
import type { LayoutStampPolicy } from './stamp.js';

/** The removals a bulk publish retries before it starts. */
export interface RemovalPort {
  flushPendingRemovals(record: HubSharingRecord): Promise<HubSharingRecord>;
}

/**
 * Publishing one board's local differences, and every pending board of the Hub. A board
 * with nothing to append appends nothing, so publishing is idempotent.
 */
export class BoardPublisher {
  constructor(
    private readonly session: SharingSession,
    private readonly observer: BoardObserver,
    private readonly removal: RemovalPort,
    private readonly stamp: LayoutStampPolicy,
  ) {}

  async publishBoard(hubId: string, boardId: string): Promise<void> {
    const record = this.session.requireRecord(hubId);
    this.session.assertReady(record);
    await this.publishBoardNow(record, boardId, null);
  }

  async publishAll(hubId: string): Promise<void> {
    let record = this.session.requireRecord(hubId);
    this.session.assertReady(record);
    record = await this.removal.flushPendingRemovals(record);
    const hub = this.session.options.hubs.requireHub(hubId);
    const local = projectSharingBoards(hub, record.bindings);
    const bound = local.filter(board => board.key !== undefined);
    const order = bound.map(board => board.key!);
    const ranks = new Map(order.map(key => [key, record.boards[key]?.rank ?? null]));
    const planned = planRanks(order, ranks) ?? rebalanceRanks(order);
    const failures: string[] = [];
    for (const board of hub.boards) {
      const key = record.bindings[board.id];
      const view = this.evaluate(record, local.find(entry => entry.boardId === board.id)!);
      const rank = key === undefined ? null : planned.get(key) ?? record.boards[key]?.rank ?? null;
      const due = view.state === 'draft' || (key !== undefined && planned.has(key));
      if (!due) continue;
      if (view.state === 'updates-available' || view.state === 'needs-review' || view.state === 'orphan' || view.state === 'update-required') continue;
      try { await this.publishBoardNow(this.session.requireRecord(hubId), board.id, rank, false); }
      catch (error) { failures.push(board.name + ': ' + (error instanceof Error ? error.message : String(error))); }
      record = this.session.requireRecord(hubId);
    }
    if (failures.length > 0) throw new KanbanError('SHARING_PUBLISH_BLOCKED', failures[0]!, { boards: failures });
    await this.observer.refresh(this.session.requireRecord(hubId), this.session.layoutFor(this.session.requireRecord(hubId)));
  }

  /** Publish one board's differences, appending nothing when it has none. */
  async publishBoardNow(record: HubSharingRecord, boardId: string, rankOverride: string | null, alsoRefresh = true): Promise<void> {
    this.session.assertReady(record);
    const hub = this.session.options.hubs.requireHub(record.hubId);
    const board = hub.boards.find(candidate => candidate.id === boardId);
    invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist.');
    let key = record.bindings[boardId];
    const layout = this.session.layoutFor(record);
    if (key !== undefined) {
      const stored = record.boards[key] ?? emptyBoard();
      if (stored.problem != null && needsPluginUpdate(stored.problem)) throw new KanbanError(stored.problem.code, stored.problem.message, { key, boardId });
      if (stored.conflict != null) throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'This board needs a review before it can be published.', { key, boardId });
      if (stored.updates > 0 || stored.removal) throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'This board has team changes that have not been applied. Get this board updates before publishing it.', { key, boardId, pending: stored.updates });
    }
    const snapshot = key === undefined ? null : await layout.readLog(key);
    await this.stamp.ensure(layout);
    if (key !== undefined && snapshot !== null) {
      const stored = record.boards[key] ?? emptyBoard();
      // A bound board whose published events were never applied must not publish over
      // them: the supported next action is to get that board's updates.
      if (stored.seq < 0) {
        await this.observer.refresh(record, layout);
        throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'This board has team changes that have not been applied. Get this board updates before publishing it.', { key, boardId });
      }
      if (stored.head !== null && snapshot.head !== stored.head) {
        await this.observer.refresh(record, layout);
        throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'This board changed in the team storage since it was read. Get this board updates before publishing it.', { key, boardId });
      }
    }
    if (key === undefined) {
      const taken = new Set([...Object.keys(record.published), ...Object.values(record.bindings)]);
      key = boardKeyFromName(board.name, taken);
    }
    const local = projectSharingBoards(hub, { ...record.bindings, [boardId]: key }).find(entry => entry.boardId === boardId)!;
    const rank = rankOverride ?? this.rankFor(record, key, local);
    const stored = record.boards[key] ?? emptyBoard();
    const at = this.session.now();
    let nextBoards: Record<string, StoredBoard>;
    if (snapshot === null) {
      // The first publish, or a log the storage no longer holds: establish the board whole.
      const genesis = await this.seedIdentities(board.id, local.workflow);
      const batch = deriveBoardChanges(null, { workflow: genesis, name: local.name, projectKeys: local.projectKeys, rank, presetMode: local.defaultPresetMode }, { allocate: () => this.session.id() });
      const created = await layout.createLog(key, appendEvents([], batch, at));
      nextBoards = { ...record.boards, [key]: { ...stored, seq: lastSequence(created.log), head: created.head, probe: created.probe, present: true, workflow: genesis, name: local.name, projectKeys: local.projectKeys, rank, presetMode: local.defaultPresetMode ?? null, updates: 0, removal: false, incoming: null, conflict: null, problem: null } };
    } else {
      const changes = deriveBoardChanges(
        { workflow: stored.workflow, name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank, presetMode: stored.presetMode ?? null },
        { workflow: local.workflow, name: local.name, projectKeys: local.projectKeys, rank, presetMode: local.defaultPresetMode },
        { allocate: () => this.session.id() },
      );
      if (changes.length === 0) {
        nextBoards = { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, name: local.name, projectKeys: local.projectKeys, rank, presetMode: local.defaultPresetMode ?? null, updates: 0, removal: false, incoming: null, conflict: null, problem: null } };
      } else {
        const withCheckpoint = needsCheckpoint(appendEvents(snapshot.log, changes, at))
          ? [...changes, { kind: 'workflow.replaced', text: local.workflow } as BoardChange]
          : changes;
        const appended = await layout.appendChanges(key, withCheckpoint, { expectedHead: snapshot.head, message: 'Update published Kanban board', at });
        nextBoards = { ...record.boards, [key]: { ...stored, seq: lastSequence(appended.log), head: appended.head, probe: appended.probe, present: true, workflow: local.workflow, name: local.name, projectKeys: local.projectKeys, rank, presetMode: local.defaultPresetMode ?? null, updates: 0, removal: false, incoming: null, conflict: null, problem: null } };
      }
    }
    const published = { ...record.published, [key]: { key, name: local.name, rank, removed: false } };
    await this.session.save({
      ...record,
      bindings: { ...record.bindings, [boardId]: key },
      boards: nextBoards,
      published,
      providerState: layout.state?.() ?? record.providerState,
      storageReview: layout.review?.() ?? null,
      lastSyncedAt: at,
      reviewRequired: null,
      lastError: null,
    });
    if (alsoRefresh) await this.observer.refresh(this.session.requireRecord(record.hubId), layout);
  }

  /** The position a single board publishes, between its local neighbours. */
  private rankFor(record: HubSharingRecord, key: string, local: LocalSharedBoard): string {
    const hub = this.session.options.hubs.requireHub(record.hubId);
    const order = hub.boards.filter(board => board.id === local.boardId || record.bindings[board.id] !== undefined).map(board => board.id === local.boardId ? key : record.bindings[board.id]!);
    const index = order.indexOf(key);
    let before: string | null = null;
    for (let cursor = index - 1; cursor >= 0; cursor--) { const value = record.boards[order[cursor]!]?.rank ?? null; if (value !== null) { before = value; break; } }
    let after: string | null = null;
    for (let cursor = index + 1; cursor < order.length; cursor++) { const value = record.boards[order[cursor]!]?.rank ?? null; if (value !== null) { after = value; break; } }
    const rank = rankBetween(before, after);
    if (rank === null) throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'The board order needs a full publish because no position is left between its neighbours.', { key });
    return rank;
  }

  /** Write the stable identity of every stage before the board is first published. */
  private async seedIdentities(boardId: string, workflow: string): Promise<string> {
    const seeded = materializeIdentities(workflow);
    if (seeded === workflow) return workflow;
    const located = this.session.options.hubs.findBoard(boardId);
    invariant(located, 'BOARD_NOT_FOUND', 'Board does not exist.');
    await this.session.options.hubs.hub(located.hubId).transact(draft => { operations.saveBoardWorkflow(draft, boardId, seeded, this.session.deps()); return draft; }, located.hub.revision);
    await this.session.noteRevision(located.hubId, boardId, workflow, seeded, located.board.defaultPresetMode, located.board.defaultPresetMode);
    return seeded;
  }

  /** One board's publishing state, from what was applied and what the last check saw. */
  private evaluate(record: HubSharingRecord, local: LocalSharedBoard): { state: BoardSharingState } {
    const hub = this.session.options.hubs.requireHub(record.hubId);
    const bound = hub.boards.filter(board => record.bindings[board.id] !== undefined).map(board => record.bindings[board.id]!);
    const ranks = new Map(bound.map(key => [key, record.boards[key]?.rank ?? null]));
    const planned = planRanks(bound, ranks);
    const rank = local.key === undefined ? null : planned?.get(local.key) ?? record.boards[local.key]?.rank ?? null;
    return evaluateBoard({ local, mirror: local.key === undefined ? null : mirrorOf(record, local.key), orphaned: record.orphans[local.boardId] !== undefined, rank });
  }
}

/** The applied version of one board, as the board rules read it. */
function mirrorOf(record: HubSharingRecord, key: string): BoardMirrorView | null {
  const stored = record.boards[key];
  return stored === undefined ? null : mirrorView(stored);
}
