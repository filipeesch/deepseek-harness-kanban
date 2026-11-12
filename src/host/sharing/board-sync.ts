import { KanbanError, invariant } from '../../shared/errors.js';
import { boardKeyFromName, normalizeBoardName } from '../../domain/sharing/identity.js';
import { SHARED_LAYOUT_VERSION } from '../../domain/sharing/layout.js';
import { compareRanks, planRanks, rankBetween, rebalanceRanks } from '../../domain/sharing/board-rank.js';
import { evaluateBoard, orphanedColumns, type BoardMirrorView, type BoardSharingState } from '../../domain/sharing/board-plan.js';
import { projectSharingBoards, type LocalSharedBoard } from '../../domain/sharing/projection.js';
import { deriveBoardChanges, sameScope } from '../../domain/journal/derive.js';
import { appendEvents, eventsAfter, lastSequence, needsCheckpoint, publishedWorkflow, replay, type BoardLog } from '../../domain/journal/log.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { canonicalWorkflow } from '../../domain/schema-parts.js';
import { stageRenames } from '../../domain/journal/migrate.js';
import { renameTaskStage } from '../../domain/stage-update.js';
import { materializeIdentities } from '../../domain/journal/materialize.js';
import type { BoardChange, JournalEvent } from '../../domain/journal/event.js';
import * as operations from '../../domain/hub-operations.js';
import type { HubRepository } from '../hub-repository.js';
import type { SharingProviderResolver, SharingBinding, ProviderState } from './provider.js';
import type { BoardLogSnapshot, SharedLayoutStore } from './ports.js';
import type { HubSharingRecord, HubSharingStore, PreviewBoard, PublishedBoard, StoredBoard } from './state.js';
import type { BoardRevisionPort } from '../board-administration.js';
import { emptyBoard } from './state.js';

/**
 * Every operation on one board: observe it, apply the team's events, publish its local
 * changes, and keep the installed version this installation last applied. Nothing here
 * writes another board's log, so one board that cannot advance never stops the rest.
 */

export interface BoardSyncOptions {
  readonly hubs: HubRepository;
  readonly store: HubSharingStore;
  readonly providers: SharingProviderResolver;
  readonly layout: (hubId: string, binding: SharingBinding, state: ProviderState) => SharedLayoutStore;
  readonly now: () => string;
  readonly id: () => string;
  readonly save: (record: HubSharingRecord) => Promise<void>;
  readonly report?: (error: unknown) => void;
  /** Records the local revisions an applied team document produces; absent keeps none. */
  readonly revisions?: BoardRevisionPort;
}

export type RemovalScope = 'local' | 'team';

/** Two authored workflows are the same when their parsed content is the same. */
function sameWorkflow(left: string, right: string): boolean {
  try { return canonicalWorkflow(parseWorkflow(left)) === canonicalWorkflow(parseWorkflow(right)); }
  catch { return left === right; }
}

export class BoardSync {
  constructor(private readonly options: BoardSyncOptions) {}

  /** Record one workflow write this layer applied from, or published to, team storage. */
  private async noteRevision(hubId: string, boardId: string, previous: string | null, next: string): Promise<void> {
    const revisions = this.options.revisions;
    if (revisions === undefined) return;
    try { await revisions.record({ hubId, boardId, previous, next, actor: { kind: 'team', source: 'team storage' }, origin: 'team' }); }
    catch (error) { this.options.report?.(error); }
  }

  /** No board operation runs while the storage or the layout version blocks the Hub. */
  private assertReady(record: HubSharingRecord): void {
    const problem = record.storageReview !== null && record.storageReview !== undefined
      ? { code: record.storageReview.code, message: record.storageReview.message }
      : record.reviewRequired ?? null;
    if (problem !== null) throw new KanbanError(problem.code, problem.message);
  }

  private requireRecord(hubId: string): HubSharingRecord {
    const record = this.options.store.load(hubId);
    invariant(record, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team storage.');
    return record;
  }

  private deps() { return this.options.hubs.operationDeps(); }

  private layoutFor(record: HubSharingRecord): SharedLayoutStore {
    return this.options.layout(record.hubId, record.binding, record.providerState);
  }

  // ---------------------------------------------------------------- observing

  /** Read the published set and the logs that changed since the last observation. */
  async observe(record: HubSharingRecord, layout: SharedLayoutStore): Promise<{ boards: Record<string, StoredBoard>; published: Record<string, PublishedBoard> }> {
    const bound = new Set(Object.values(record.bindings));
    const hub = this.options.hubs.requireHub(record.hubId);
    const localBoards = new Map(Object.entries(record.bindings).map(([boardId, key]) => [key, hub.boards.find(board => board.id === boardId)]));
    const boards: Record<string, StoredBoard> = { ...record.boards };
    const published: Record<string, PublishedBoard> = {};
    const listed = await layout.listLogs();
    const seen = new Set<string>();
    for (const entry of listed) {
      seen.add(entry.key);
      const stored = boards[entry.key] ?? emptyBoard();
      if (entry.probe === stored.probe && stored.head !== null && stored.present) {
        published[entry.key] = { key: entry.key, name: stored.name ?? entry.key, rank: stored.rank, removed: stored.removal };
        continue;
      }
      let snapshot;
      try { snapshot = await layout.readLog(entry.key); }
      catch (error) {
        if (error instanceof KanbanError && error.code === 'SHARING_DOCUMENT_VERSION_UNSUPPORTED') {
          boards[entry.key] = { ...stored, probe: entry.probe, present: true, problem: { code: error.code, message: error.message }, updates: 0, removal: false, conflict: null, incoming: null };
          published[entry.key] = { key: entry.key, name: stored.name ?? entry.key, rank: stored.rank, removed: false };
          continue;
        }
        throw error;
      }
      if (snapshot === null) continue;
      const pending = eventsAfter(snapshot.log, stored.seq);
      const removal = pending.some(event => event.kind === 'board.removed');
      const identity = foldIdentity({ name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank }, pending);
      published[entry.key] = { key: entry.key, name: identity.name ?? entry.key, rank: identity.rank, removed: removal };
      if (!bound.has(entry.key)) continue;
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
      continue;
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
    let record = this.requireRecord(hubId);
    const layout = this.layoutFor(record);
    const at = this.options.now();
    try {
      const stamp = await layout.readStamp();
      const versionProblem = stamp !== null && stamp.version !== SHARED_LAYOUT_VERSION ? versionError(stamp.version) : null;
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
      await this.options.save({
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
      await this.persistFailure(record, error);
      throw error;
    }
    void manual;
  }

  /** Re-read the boards after an apply or a publish, so the status matches what landed. */
  private async refresh(record: HubSharingRecord, layout: SharedLayoutStore): Promise<HubSharingRecord> {
    const observed = await this.observe(record, layout);
    const next = { ...record, boards: observed.boards, published: observed.published, providerState: layout.state?.() ?? record.providerState, storageReview: layout.review?.() ?? null };
    await this.options.save(next);
    return next;
  }

  private async persistFailure(record: HubSharingRecord, error: unknown): Promise<void> {
    const code = error instanceof KanbanError ? error.code : 'SHARING_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    await this.options.save({ ...record, lastError: { code, message }, ...(code === 'SHARING_CONCURRENT_WRITE' ? { reviewRequired: { code, message } } : {}) });
  }

  // ---------------------------------------------------------------- applying

  async applyBoard(hubId: string, boardId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    this.assertReady(record);
    const key = record.bindings[boardId];
    invariant(key !== undefined, 'SHARING_NOT_PUBLISHED', 'This board is not published to the team.');
    await this.applyKey(record, key);
  }

  /** Apply every published board, reporting each failure without stopping the rest. */
  async applyAll(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    this.assertReady(record);
    const layout = this.layoutFor(record);
    const failures: KanbanError[] = [];
    const bound = new Set(Object.values(record.bindings));
    for (const entry of Object.values(record.published)) {
      // A removed board still has to be applied by an installation that holds it; an
      // installation that never held it has nothing to remove.
      if (entry.removed && !bound.has(entry.key)) continue;
      try { await this.applyKey(this.requireRecord(hubId), entry.key, false); }
      catch (error) {
        failures.push(error instanceof KanbanError ? error : new KanbanError('SHARING_FAILED', error instanceof Error ? error.message : String(error)));
      }
    }
    await this.refresh(this.requireRecord(hubId), layout);
    if (failures.length > 0) {
      const first = failures[0]!;
      const suffix = failures.length === 1 ? '' : ' ' + (failures.length - 1) + ' other board(s) need attention too.';
      throw new KanbanError(first.code, first.message + suffix, { ...first.details, pendingBoards: failures.length });
    }
  }

  /** Apply one published log, creating the local board when this installation lacks it. */
  private async applyKey(record: HubSharingRecord, key: string, alsoRefresh = true): Promise<void> {
    const layout = this.layoutFor(record);
    const snapshot = await layout.readLog(key);
    if (snapshot === null) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'The team board has no published log.', { key });
    const hub = this.options.hubs.requireHub(record.hubId);
    const boardId = Object.entries(record.bindings).find(([, bound]) => bound === key)?.[0];
    const board = boardId === undefined ? undefined : hub.boards.find(candidate => candidate.id === boardId);
    const stored = record.boards[key] ?? emptyBoard();
    const pending = eventsAfter(snapshot.log, stored.seq);
    if (board === undefined) {
      // The team may have published this key again: a matching orphan reconnects to it
      // instead of becoming a second local board.
      const orphanId = Object.entries(record.orphans).find(([, value]) =>
        value.lastKey === key
        || normalizeBoardName(value.lastPublishedName) === normalizeBoardName(record.published[key]?.name ?? ''))?.[0];
      if (orphanId !== undefined) {
        const orphans = { ...record.orphans };
        delete orphans[orphanId];
        const bindings = { ...record.bindings };
        for (const [boundId, boundKey] of Object.entries(bindings)) if (boundKey === key) delete bindings[boundId];
        bindings[orphanId] = key;
        await this.options.save({ ...record, bindings, orphans });
        await this.applyKey(this.requireRecord(record.hubId), key, alsoRefresh);
        return;
      }
      const published = publishedWorkflow(snapshot.log);
      if (published === null) throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The team board cannot be read.', { key });
      const entry = record.published[key];
      const name = entry?.name ?? identityName(snapshot.log) ?? key;
      const identity = foldIdentity({ name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank }, pending);
      const orderClean = this.orderIsClean(record, hub);
      const createdText = materializeIdentities(published);
      const created = await this.options.hubs.hub(record.hubId).transact(draft => {
        const added = operations.addBoard(draft, name, this.deps());
        operations.saveBoardWorkflow(draft, added.id, createdText, this.deps());
        operations.setBoardProjectScope(draft, added.id, appliedScope(snapshot.log), this.deps());
        if (orderClean && identity.rank !== null) reorderBoundBoards(draft, { ...record.bindings, [added.id]: key }, { ...record.boards, [key]: { ...stored, rank: identity.rank } });
        return added.id;
      }, hub.revision);
      await this.noteRevision(record.hubId, created, null, createdText);
      // A board that no longer exists must not keep a binding to this key.
      const bindings = { ...record.bindings };
      for (const [boundId, boundKey] of Object.entries(bindings)) if (boundKey === key) delete bindings[boundId];
      bindings[created] = key;
      const next = { ...record, bindings, boards: { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: published, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, updates: 0, removal: false, incoming: null, conflict: null, problem: null } } };
      await this.options.save(next);
      if (alsoRefresh) await this.refresh(this.requireRecord(record.hubId), layout);
      return;
    }
    if (pending.some(event => event.kind === 'board.removed')) {
      await this.applyRemoval(record, snapshot, key, board.id, nameOf(record, key, board.name));
      return;
    }
    const recovered = replay(snapshot.log, stored.workflow === null ? null : { text: stored.workflow, cursor: stored.seq });
    if (!recovered.ok) {
      await this.options.save({ ...record, boards: { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, updates: Math.max(pending.length, 1), conflict: recovered.conflict.kind, incoming: publishedWorkflow(snapshot.log), problem: null } } });
      throw new KanbanError('SHARING_REVIEW_REQUIRED', 'The team changed a stage of board "' + board.name + '" in a way this installation cannot apply on its own. Review the board.', { key, boardId: board.id, kind: recovered.conflict.kind, reason: recovered.conflict.message });
    }
    const identity = foldIdentity({ name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank }, recovered.events);
    const adoptName = stored.name !== null && board.name === stored.name;
    const adoptScope = sameScope(stored.projectKeys, board.allowedProjectKeys ?? null);
    const adoptWorkflow = stored.workflow === null || sameWorkflow(board.workflowYaml, stored.workflow);
    const orderClean = this.orderIsClean(record, hub);
    const renames = stageRenames(recovered.events.filter(event => event.seq > stored.seq));
    const appliedText = recovered.text;
    const workflowChanged = appliedText !== board.workflowYaml;
    const blocking = adoptWorkflow ? this.blockingColumns(appliedText, hub, board, renames) : null;
    if (blocking !== null) {
      await this.options.save({ ...record, boards: { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, updates: Math.max(pending.length, 1), incoming: appliedText, problem: null } } });
      throw new KanbanError('SHARING_ORPHAN_COLUMNS', 'Applying the team change to board "' + board.name + '" would leave ' + blocking.tasks + ' task' + (blocking.tasks === 1 ? '' : 's') + ' in column "' + blocking.columnId + '". Move them, then get the update again.', { key, boardId: board.id, columnId: blocking.columnId, tasks: blocking.tasks });
    }
    if (identityDiverged(board.workflowYaml, recovered.events)) {
      await this.options.save({ ...record, boards: { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, updates: Math.max(pending.length, 1), conflict: 'identity', incoming: appliedText, problem: null } } });
      throw new KanbanError('SHARING_REVIEW_REQUIRED', 'The team and this installation renamed a stage of board "' + board.name + '" differently. Review the board.', { key, boardId: board.id, kind: 'identity' });
    }
    await this.options.hubs.hub(record.hubId).transact(draft => {
      // The references move first: saving a workflow that no longer defines a task's
      // stage would be refused, and the rename is what makes them agree again.
      if (adoptWorkflow) {
        for (const rename of renames) for (const task of draft.tasks) if (task.boardId === board.id) renameTaskStage(task, rename.from, rename.to);
        if (workflowChanged) operations.saveBoardWorkflow(draft, board.id, appliedText, this.deps());
      }
      if (adoptName && identity.name !== null && identity.name !== board.name) operations.renameBoard(draft, board.id, identity.name, this.deps());
      if (adoptScope && !sameScope(identity.projectKeys, board.allowedProjectKeys ?? null)) operations.setBoardProjectScope(draft, board.id, identity.projectKeys === null ? undefined : [...identity.projectKeys], this.deps());
      if (orderClean && identity.rank !== null) reorderBoundBoards(draft, record.bindings, { ...record.boards, [key]: { ...stored, rank: identity.rank } });
    }, hub.revision);
    if (adoptWorkflow && workflowChanged) await this.noteRevision(record.hubId, board.id, board.workflowYaml, appliedText);
    await this.options.save({
      ...record,
      boards: { ...record.boards, [key]: { ...stored, seq: recovered.cursor, head: snapshot.head, probe: snapshot.probe, present: true, workflow: appliedText, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, updates: 0, removal: false, incoming: null, conflict: null, problem: null } },
      lastSyncedAt: this.options.now(),
      reviewRequired: null,
      lastError: null,
    });
    if (alsoRefresh) await this.refresh(this.requireRecord(record.hubId), layout);
  }

  /** Whether the local board order still matches the applied positions. */
  private orderIsClean(record: HubSharingRecord, hub: { boards: ReadonlyArray<{ id: string }> }): boolean {
    const bound = hub.boards.filter(board => record.bindings[board.id] !== undefined).map(board => record.bindings[board.id]!);
    if (bound.length < 2) return true;
    const ranks = new Map(bound.map(key => [key, record.boards[key]?.rank ?? null]));
    const planned = planRanks(bound, ranks);
    return planned !== null && planned.size === 0;
  }

  /** Apply the team's removal of one board: delete it when empty, otherwise orphan it. */
  private async applyRemoval(record: HubSharingRecord, snapshot: BoardLogSnapshot, key: string, boardId: string, name: string): Promise<void> {
    const hub = this.options.hubs.requireHub(record.hubId);
    const board = hub.boards.find(candidate => candidate.id === boardId);
    const hasTasks = hub.tasks.some(task => task.boardId === boardId);
    const stored = record.boards[key] ?? emptyBoard();
    const dirty = stored.workflow !== null && board !== undefined && board.workflowYaml !== stored.workflow;
    // The placement is kept with its cursor at the removal: a board the team publishes
    // again is then measured from that event, not replayed from the beginning.
    const boards = { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: stored.workflow, updates: 0, removal: true, conflict: null, incoming: null, problem: null } };
    const bindings = { ...record.bindings };
    delete bindings[boardId];
    const orphans = { ...record.orphans };
    if (board !== undefined && (hasTasks || dirty)) {
      orphans[boardId] = { lastKey: key, lastPublishedName: record.published[key]?.name ?? name };
      await this.options.save({ ...record, bindings, boards, orphans, lastSyncedAt: this.options.now() });
      return;
    }
    if (board !== undefined) {
      await this.options.hubs.hub(record.hubId).transact(draft => { operations.deleteBoard(draft, boardId, this.deps()); return draft; }, hub.revision);
      try { await this.options.revisions?.remove?.(boardId); }
      catch (error) { this.options.report?.(error); }
    }
    await this.options.save({ ...record, bindings, boards, orphans, lastSyncedAt: this.options.now() });
  }

  async resolve(hubId: string, boardId: string, choice: 'local' | 'team'): Promise<void> {
    const record = this.requireRecord(hubId);
    this.assertReady(record);
    const key = record.bindings[boardId];
    invariant(key !== undefined, 'SHARING_NOT_CONFLICT', 'The board is not published.');
    const layout = this.layoutFor(record);
    const snapshot = await layout.readLog(key);
    invariant(snapshot !== null, 'SHARING_NOT_CONFLICT', 'The team board has no published board.');
    const stored = record.boards[key] ?? emptyBoard();
    if (choice === 'team') {
      const head = replay(snapshot.log, null);
      invariant(head.ok, 'SHARING_INVALID_DOCUMENT', 'The team board cannot be read.');
      const hub = this.options.hubs.requireHub(hubId);
      const board = hub.boards.find(candidate => candidate.id === boardId);
      invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist.');
      const pending = eventsAfter(snapshot.log, stored.seq);
      const renames = stageRenames(pending);
      const identity = foldIdentity({ name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank }, pending);
      const blocking = this.blockingColumns(head.text, hub, board, renames);
      if (blocking !== null) {
        throw new KanbanError('SHARING_ORPHAN_COLUMNS', 'The team change to board "' + board.name + '" would leave ' + blocking.tasks + ' task' + (blocking.tasks === 1 ? '' : 's') + ' in column "' + blocking.columnId + '". Move them, then choose again.', { boardId, columnId: blocking.columnId, tasks: blocking.tasks });
      }
      try {
      await this.options.hubs.hub(hubId).transact(draft => {
        for (const rename of renames) for (const task of draft.tasks) if (task.boardId === boardId) renameTaskStage(task, rename.from, rename.to);
        operations.saveBoardWorkflow(draft, boardId, head.text, this.deps());
        if (identity.name !== null && identity.name !== board.name) operations.renameBoard(draft, boardId, identity.name, this.deps());
        operations.setBoardProjectScope(draft, boardId, identity.projectKeys === null ? undefined : [...identity.projectKeys], this.deps());
      }, hub.revision);
      await this.noteRevision(hubId, boardId, board.workflowYaml, head.text);
    } catch (error) {
      throw this.refusal(error, head.text, hub, board);
    }
      await this.options.save({ ...record, boards: { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: head.text, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, updates: 0, removal: false, incoming: null, conflict: null, problem: null } }, reviewRequired: null });
      await this.refresh(this.requireRecord(hubId), layout);
      return;
    }
    // Keeping the local version accepts the divergence: the cursor moves to the head so
    // the board stops asking, and the local board stays a draft to publish.
    const publishedText = publishedWorkflow(snapshot.log);
    const identity = foldIdentity({ name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank }, eventsAfter(snapshot.log, stored.seq));
    await this.options.save({ ...record, boards: { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: publishedText, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, updates: 0, removal: false, incoming: null, conflict: null, problem: null } }, reviewRequired: null });
    await this.refresh(this.requireRecord(hubId), layout);
  }

  // ---------------------------------------------------------------- publishing

  async publishBoard(hubId: string, boardId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    this.assertReady(record);
    await this.publishBoardNow(record, boardId, null);
  }

  async publishAll(hubId: string): Promise<void> {
    let record = this.requireRecord(hubId);
    this.assertReady(record);
    record = await this.flushPendingRemovals(record);
    const hub = this.options.hubs.requireHub(hubId);
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
      try { await this.publishBoardNow(this.requireRecord(hubId), board.id, rank, false); }
      catch (error) { failures.push(board.name + ': ' + (error instanceof Error ? error.message : String(error))); }
      record = this.requireRecord(hubId);
    }
    if (failures.length > 0) throw new KanbanError('SHARING_PUBLISH_BLOCKED', failures[0]!, { boards: failures });
    await this.refresh(this.requireRecord(hubId), this.layoutFor(this.requireRecord(hubId)));
  }

  private evaluate(record: HubSharingRecord, local: LocalSharedBoard): { state: BoardSharingState } {
    const hub = this.options.hubs.requireHub(record.hubId);
    const bound = hub.boards.filter(board => record.bindings[board.id] !== undefined).map(board => record.bindings[board.id]!);
    const ranks = new Map(bound.map(key => [key, record.boards[key]?.rank ?? null]));
    const planned = planRanks(bound, ranks);
    const rank = local.key === undefined ? null : planned?.get(local.key) ?? record.boards[local.key]?.rank ?? null;
    return evaluateBoard({ local, mirror: local.key === undefined ? null : this.mirrorOf(record, local.key), orphaned: record.orphans[local.boardId] !== undefined, rank });
  }

  private mirrorOf(record: HubSharingRecord, key: string): BoardMirrorView | null {
    const stored = record.boards[key];
    if (stored === undefined) return null;
    return { cursor: stored.seq, present: stored.present, workflow: stored.workflow, name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank, updates: stored.updates, removal: stored.removal, incoming: stored.incoming, conflict: stored.conflict, problem: stored.problem };
  }

  private async publishBoardNow(record: HubSharingRecord, boardId: string, rankOverride: string | null, alsoRefresh = true): Promise<void> {
    this.assertReady(record);
    const hub = this.options.hubs.requireHub(record.hubId);
    const board = hub.boards.find(candidate => candidate.id === boardId);
    invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist.');
    let key = record.bindings[boardId];
    const layout = this.layoutFor(record);
    if (key !== undefined) {
      const stored = record.boards[key] ?? emptyBoard();
      if (stored.problem?.code === 'SHARING_DOCUMENT_VERSION_UNSUPPORTED') throw new KanbanError(stored.problem.code, stored.problem.message, { key, boardId });
      if (stored.conflict != null) throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'This board needs a review before it can be published.', { key, boardId });
      if (stored.updates > 0 || stored.removal) throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'This board has team changes that have not been applied. Get this board updates before publishing it.', { key, boardId, pending: stored.updates });
    }
    await this.ensureStamp(layout);
    const snapshot = key === undefined ? null : await layout.readLog(key);
    if (key !== undefined && snapshot !== null) {
      const stored = record.boards[key] ?? emptyBoard();
      // A bound board whose published events were never applied must not publish over
      // them: the supported next action is to get that board's updates.
      if (stored.seq < 0) {
        await this.refresh(record, layout);
        throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'This board has team changes that have not been applied. Get this board updates before publishing it.', { key, boardId });
      }
      if (stored.head !== null && snapshot.head !== stored.head) {
        await this.refresh(record, layout);
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
    const at = this.options.now();
    let nextBoards: Record<string, StoredBoard>;
    if (snapshot === null) {
      // The first publish, or a log the storage no longer holds: establish the board whole.
      const genesis = await this.seedIdentities(board.id, local.workflow);
      const batch = deriveBoardChanges(null, { workflow: genesis, name: local.name, projectKeys: local.projectKeys, rank }, { allocate: () => this.options.id() });
      const created = await layout.createLog(key, appendEvents([], batch, at));
      nextBoards = { ...record.boards, [key]: { ...stored, seq: lastSequence(created.log), head: created.head, probe: created.probe, present: true, workflow: genesis, name: local.name, projectKeys: local.projectKeys, rank, updates: 0, removal: false, incoming: null, conflict: null, problem: null } };
    } else {
      const changes = deriveBoardChanges(
        { workflow: stored.workflow, name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank },
        { workflow: local.workflow, name: local.name, projectKeys: local.projectKeys, rank },
        { allocate: () => this.options.id() },
      );
      if (changes.length === 0) {
        nextBoards = { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, name: local.name, projectKeys: local.projectKeys, rank, updates: 0, removal: false, incoming: null, conflict: null, problem: null } };
      } else {
        const withCheckpoint = needsCheckpoint(appendEvents(snapshot.log, changes, at))
          ? [...changes, { kind: 'workflow.replaced', text: local.workflow } as BoardChange]
          : changes;
        const appended = await layout.appendChanges(key, withCheckpoint, { expectedHead: snapshot.head, message: 'Update published Kanban board', at });
        nextBoards = { ...record.boards, [key]: { ...stored, seq: lastSequence(appended.log), head: appended.head, probe: appended.probe, present: true, workflow: local.workflow, name: local.name, projectKeys: local.projectKeys, rank, updates: 0, removal: false, incoming: null, conflict: null, problem: null } };
      }
    }
    const published = { ...record.published, [key]: { key, name: local.name, rank, removed: false } };
    await this.options.save({
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
    if (alsoRefresh) await this.refresh(this.requireRecord(record.hubId), layout);
  }

  /** The position a single board publishes, between its local neighbours. */
  private rankFor(record: HubSharingRecord, key: string, local: LocalSharedBoard): string {
    const hub = this.options.hubs.requireHub(record.hubId);
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

  /** Write the layout stamp when the storage has none, and refuse a version this build does not write. */
  private async ensureStamp(layout: SharedLayoutStore): Promise<void> {
    const stamp = await layout.readStamp();
    if (stamp === null) { await layout.writeStamp(SHARED_LAYOUT_VERSION, { expectedVersion: null }); return; }
    if (stamp.version === SHARED_LAYOUT_VERSION) return;
    if (stamp.version < SHARED_LAYOUT_VERSION) {
      // An older layout is replaced in place: its entries stay untouched, and the stamp
      // this installation writes is the current one.
      await layout.writeStamp(SHARED_LAYOUT_VERSION, { expectedVersion: stamp.version });
      return;
    }
    throw versionError(stamp.version);
  }

  /** Write the stable identity of every stage before the board is first published. */
  private async seedIdentities(boardId: string, workflow: string): Promise<string> {
    const seeded = materializeIdentities(workflow);
    if (seeded === workflow) return workflow;
    const located = this.options.hubs.findBoard(boardId);
    invariant(located, 'BOARD_NOT_FOUND', 'Board does not exist.');
    await this.options.hubs.hub(located.hubId).transact(draft => { operations.saveBoardWorkflow(draft, boardId, seeded, this.deps()); return draft; }, located.hub.revision);
    await this.noteRevision(located.hubId, boardId, workflow, seeded);
    return seeded;
  }

  // ---------------------------------------------------------------- removal and orphans

  async recordRemoval(hubId: string, boardId: string, scope: RemovalScope, name: string): Promise<void> {
    this.assertReady(this.requireRecord(hubId));
    const record = this.options.store.load(hubId);
    if (record === undefined) return;
    const key = record.bindings[boardId];
    const bindings = { ...record.bindings };
    const boards = { ...record.boards };
    const orphans = { ...record.orphans };
    delete bindings[boardId];
    delete orphans[boardId];
    if (key === undefined) { await this.options.save({ ...record, bindings, orphans }); return; }
    delete boards[key];
    const removed = { ...record.removed };
    const pendingRemovals = { ...record.pendingRemovals };
    const published = { ...record.published };
    if (scope === 'local') removed[key] = { boardId, name };
    else if (published[key] !== undefined) {
      const appended = await this.appendRemoval(record, key);
      if (appended) delete published[key]; else pendingRemovals[key] = { name };
    }
    await this.options.save({ ...record, bindings, boards, orphans, removed, pendingRemovals, published });
    if (scope === 'team' && key !== undefined && pendingRemovals[key] !== undefined) {
      throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'The board was removed here, but its removal event could not be sent. Publish all retries it.', { boardId, key });
    }
  }

  /** Append the removal event for one key, against the head the storage currently has. */
  private async appendRemoval(record: HubSharingRecord, key: string): Promise<boolean> {
    const layout = this.layoutFor(record);
    try {
      const snapshot = await layout.readLog(key);
      if (snapshot === null) return true;
      await layout.appendChanges(key, [{ kind: 'board.removed' }], { expectedHead: snapshot.head, message: 'Remove published Kanban board', at: this.options.now() });
      return true;
    } catch (error) {
      this.options.report?.(error);
      return false;
    }
  }

  private async flushPendingRemovals(record: HubSharingRecord): Promise<HubSharingRecord> {
    if (Object.keys(record.pendingRemovals).length === 0) return record;
    const pendingRemovals = { ...record.pendingRemovals };
    const published = { ...record.published };
    for (const key of Object.keys(pendingRemovals)) {
      if (await this.appendRemoval(record, key)) { delete pendingRemovals[key]; delete published[key]; }
    }
    const next = { ...record, pendingRemovals, published };
    await this.options.save(next);
    return next;
  }

  async restore(hubId: string, boardId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    const entry = Object.entries(record.removed).find(([, value]) => value.boardId === boardId);
    invariant(entry, 'SHARING_NOT_REMOVED', 'The board is not removed only from this installation.');
    const [key] = entry;
    const removed = { ...record.removed };
    delete removed[key];
    const published = record.published[key];
    if (published === undefined || published.removed) {
      await this.options.save({ ...record, removed });
      throw new KanbanError('SHARING_REMOVED_GONE', 'The team board no longer exists, so it cannot be restored.');
    }
    const hub = this.options.hubs.requireHub(hubId);
    const exists = hub.boards.some(candidate => candidate.id === boardId);
    const bindings = { ...record.bindings };
    delete bindings[boardId];
    const next = { ...record, removed, bindings: exists ? { ...bindings, [boardId]: key } : bindings };
    await this.options.save(next);
    await this.applyKey(this.requireRecord(hubId), key);
  }

  async publishOrphan(hubId: string, boardId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    const orphan = record.orphans[boardId];
    invariant(orphan !== undefined, 'SHARING_NOT_ORPHAN', 'The board is not an orphan.');
    const orphans = { ...record.orphans };
    delete orphans[boardId];
    const taken = new Set([...Object.keys(record.published), ...Object.values(record.bindings)]);
    const key = boardKeyFromName(orphan.lastPublishedName, taken);
    await this.options.save({ ...record, orphans, bindings: { ...record.bindings, [boardId]: key } });
    await this.publishBoardNow(this.requireRecord(hubId), boardId, null);
  }

  /** The published boards this installation has not adopted, read for the choice at connect. */
  async readPreview(record: HubSharingRecord, layout: SharedLayoutStore): Promise<PreviewBoard[]> {
    const boards: PreviewBoard[] = [];
    for (const listed of await layout.listLogs()) {
      const snapshot = await layout.readLog(listed.key);
      if (snapshot === null) continue;
      const workflow = publishedWorkflow(snapshot.log);
      if (workflow === null) continue;
      const identity = foldIdentity({ name: null, projectKeys: null, rank: null }, snapshot.log);
      if (snapshot.log.some(event => event.kind === 'board.removed')) continue;
      boards.push({ key: listed.key, name: identity.name ?? listed.key, projectKeys: identity.projectKeys, rank: identity.rank, workflow });
    }
    return boards;
  }

  /** Bind the local boards a preview names, so receiving adopts the team's boards by name. */
  async receivePreview(record: HubSharingRecord): Promise<HubSharingRecord> {
    const preview = record.preview;
    invariant(preview, 'SHARING_NO_PREVIEW', 'This Hub has no pending connection preview.');
    const hub = this.options.hubs.requireHub(record.hubId);
    const bindings = { ...record.bindings };
    for (const board of hub.boards) {
      if (bindings[board.id] !== undefined) continue;
      const entry = preview.boards.find(candidate => normalizeBoardName(candidate.name) === normalizeBoardName(board.name));
      if (entry !== undefined) bindings[board.id] = entry.key;
    }
    const published: Record<string, PublishedBoard> = {};
    for (const entry of preview.boards) published[entry.key] = { key: entry.key, name: entry.name, rank: entry.rank, removed: false };
    return { ...record, preview: null, bindings, published, lastSyncedAt: this.options.now(), reviewRequired: null, lastError: null };
  }

  /** Replace the published configuration with this Hub's boards, tombstoning what it drops. */
  async publishInitial(record: HubSharingRecord): Promise<void> {
    const layout = this.layoutFor(record);
    // The keys that were published stay known while the replacement is written, so the
    // new logs cannot collide with the logs that were just tombstoned.
    const published: Record<string, PublishedBoard> = {};
    for (const listed of await layout.listLogs()) {
      const snapshot = await layout.readLog(listed.key);
      if (snapshot === null) continue;
      published[listed.key] = { key: listed.key, name: record.published[listed.key]?.name ?? listed.key, rank: record.published[listed.key]?.rank ?? null, removed: true };
      if (snapshot.log.some(event => event.kind === 'board.removed')) continue;
      await layout.appendChanges(listed.key, [{ kind: 'board.removed' }], { expectedHead: snapshot.head, message: 'Replace published Kanban configuration', at: this.options.now() });
    }
    await this.ensureStamp(layout);
    const cleared: HubSharingRecord = { ...record, preview: null, bindings: {}, boards: {}, published, orphans: {}, removed: {}, pendingRemovals: {} };
    await this.options.save(cleared);
    await this.publishAll(record.hubId);
  }

  /** The stage and task count that block applying, or null when nothing would be orphaned. */
  private blockingColumns(appliedText: string, hub: { tasks: ReadonlyArray<{ boardId: string; columnId: string }> }, board: { id: string; name: string; workflowYaml: string; allowedProjectKeys?: readonly string[] }, renames: readonly { from: string; to: string }[]): { columnId: string; tasks: number } | null {
    const renamed = new Map(renames.map(rename => [rename.from, rename.to]));
    const local = localBoardOf(hub, board);
    const rows = local.taskColumns.map(column => ({ columnId: renamed.get(column.columnId) ?? column.columnId, tasks: column.tasks }));
    const columns = orphanedColumns(appliedText, { ...local, taskColumns: rows });
    if (columns.length === 0) return null;
    const columnId = columns[0]!;
    return { columnId, tasks: rows.filter(column => column.columnId === columnId).reduce((sum, column) => sum + column.tasks, 0) };
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
  /**
   * Name the refusal the same way the previous model did: a board, a stage, and the
   * task count that blocks applying. The interface never offers an override.
   */
  private refusal(error: unknown, appliedText: string, hub: { tasks: ReadonlyArray<{ boardId: string; columnId: string }> }, board: { id: string; name: string; workflowYaml: string; allowedProjectKeys?: readonly string[] }): unknown {
    if (!(error instanceof KanbanError) || (error.code !== 'INVALID_WORKFLOW' && error.code !== 'WORKFLOW_ORPHAN_COLUMNS')) return error;
    const counts = new Map<string, number>();
    for (const task of hub.tasks) if (task.boardId === board.id) counts.set(task.columnId, (counts.get(task.columnId) ?? 0) + 1);
    const local = { boardId: board.id, name: board.name, workflow: board.workflowYaml, projectKeys: board.allowedProjectKeys === undefined ? null : [...board.allowedProjectKeys], tasks: 0, taskColumns: [...counts].map(([columnId, tasks]) => ({ columnId, tasks })) };
    const columns = orphanedColumns(appliedText, local);
    if (columns.length === 0) return error;
    const columnId = columns[0]!;
    const tasks = counts.get(columnId) ?? 0;
    return new KanbanError('SHARING_REFUSED', 'Applying the team change to board "' + board.name + '" would leave ' + tasks + ' task' + (tasks === 1 ? '' : 's') + ' in column "' + columnId + '" that the workflow no longer defines. Move them, then get the update again.', { boardId: board.id, columnId, tasks });
  }
}

/** Fold the identity events of a batch onto the applied identity. */
function foldIdentity(base: { name: string | null; projectKeys: string[] | null; rank: string | null }, events: readonly JournalEvent[]): { name: string | null; projectKeys: string[] | null; rank: string | null } {
  let name = base.name;
  let projectKeys = base.projectKeys;
  let rank = base.rank;
  for (const event of events) {
    if (event.kind === 'board.renamed') name = event.name;
    else if (event.kind === 'board.scope-changed') projectKeys = event.projectKeys === null ? null : [...event.projectKeys];
    else if (event.kind === 'board.rank-changed') rank = event.rank;
  }
  return { name, projectKeys, rank };
}

function versionError(version: number): { code: string; message: string } {
  return version > SHARED_LAYOUT_VERSION
    ? { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.' }
    : { code: 'SHARING_LAYOUT_OUTDATED', message: 'The team storage holds a layout this plugin no longer reads. Connect the storage again to publish the current layout.' };
}

function identityName(log: BoardLog): string | null {
  return foldIdentity({ name: null, projectKeys: null, rank: null }, log).name;
}

function appliedScope(log: BoardLog): string[] | undefined {
  const scope = foldIdentity({ name: null, projectKeys: null, rank: null }, log).projectKeys;
  return scope === null ? undefined : scope;
}

function nameOf(record: HubSharingRecord, key: string, fallback: string): string {
  return record.published[key]?.name ?? fallback;
}

/** Published positions order as text; an unpositioned board comes last. */
function compareNullableRanks(left: string | null, right: string | null): number {
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return compareRanks(left, right);
}

/** Reorder the bound local boards to the applied ranks, leaving unbound boards in place. */
function reorderBoundBoards(draft: { boards: Array<{ id: string }> }, bindings: Record<string, string>, boards: Record<string, StoredBoard>): void {
  const positions: number[] = [];
  const bound: Array<{ id: string; rank: string | null }> = [];
  for (const [index, board] of draft.boards.entries()) {
    const key = bindings[board.id];
    if (key === undefined) continue;
    positions.push(index);
    bound.push({ id: board.id, rank: boards[key]?.rank ?? null });
  }
  const sorted = [...bound].sort((left, right) => compareNullableRanks(left.rank, right.rank) || left.id.localeCompare(right.id));
  for (const [offset, position] of positions.entries()) {
    const value = draft.boards[position]!;
    const replacement = sorted[offset]!;
    if (value.id === replacement.id) continue;
    const target = draft.boards.findIndex(board => board.id === replacement.id);
    if (target < 0) continue;
    const move = draft.boards.splice(target, 1)[0]!;
    draft.boards.splice(position, 0, move);
  }
}

/** One local board as the orphan-column check needs it. */
function localBoardOf(hub: { tasks: ReadonlyArray<{ boardId: string; columnId: string }> }, board: { id: string; name: string; workflowYaml: string; allowedProjectKeys?: readonly string[] }) {
  const counts = new Map<string, number>();
  for (const task of hub.tasks) if (task.boardId === board.id) counts.set(task.columnId, (counts.get(task.columnId) ?? 0) + 1);
  return { boardId: board.id, name: board.name, workflow: board.workflowYaml, projectKeys: board.allowedProjectKeys === undefined ? null : [...board.allowedProjectKeys], tasks: 0, taskColumns: [...counts].map(([columnId, tasks]) => ({ columnId, tasks })) };
}

/** Whether the installed workflow names a stage the team is renaming differently. */
function identityDiverged(workflowText: string, events: readonly JournalEvent[]): boolean {
  let workflow;
  try { workflow = parseWorkflow(workflowText); }
  catch { return false; }
  for (const event of events) {
    if (event.kind !== 'stage.id-changed') continue;
    const column = workflow.columns.find(candidate => candidate.key === event.key);
    if (column === undefined) continue;
    if (column.id !== event.from && column.id !== event.id) return true;
  }
  return false;
}