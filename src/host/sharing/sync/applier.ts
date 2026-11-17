import { KanbanError, invariant } from '../../../shared/errors.js';
import { normalizeBoardName } from '../../../domain/sharing/identity.js';
import { planRanks } from '../../../domain/sharing/board-rank.js';
import { orphanedColumns } from '../../../domain/sharing/board-plan.js';
import { boardDiffers, workflowDiffers } from '../../../domain/sharing/document.js';
import { sameScope } from '../../../domain/journal/derive.js';
import { eventsAfter, lastSequence, publishedWorkflow, replay } from '../../../domain/journal/log.js';
import { stageRenames } from '../../../domain/journal/migrate.js';
import { materializeIdentities } from '../../../domain/journal/materialize.js';
import { renameTaskStage } from '../../../domain/stage-update.js';
import * as operations from '../../../domain/hub-operations.js';
import type { BoardLogSnapshot } from '../ports.js';
import { emptyBoard, type HubSharingRecord, type StoredBoard } from '../state.js';
import { needsPluginUpdate } from '../board-compatibility.js';
import { appliedPreset, appliedScope, foldIdentity, identityDiverged, identityName, mirrorIdentity, nameOf } from './identity.js';
import { reorderBoundBoards } from './order.js';
import type { BoardObserver } from './observer.js';
import type { SharingSession } from './session.js';

/**
 * Applying the team's events to one board: creating a board this installation lacks,
 * updating one it holds, applying a removal, and resolving a choice. Every failure is
 * scoped to its board, so another board still applies.
 */
export class BoardApplier {
  constructor(private readonly session: SharingSession, private readonly observer: BoardObserver) {}

  async applyBoard(hubId: string, boardId: string): Promise<void> {
    const record = this.session.requireRecord(hubId);
    this.session.assertReady(record);
    const key = record.bindings[boardId];
    invariant(key !== undefined, 'SHARING_NOT_PUBLISHED', 'This board is not published to the team.');
    await this.applyKey(record, key);
  }

  /** Apply every published board, reporting each failure without stopping the rest. */
  async applyAll(hubId: string): Promise<void> {
    const record = this.session.requireRecord(hubId);
    this.session.assertReady(record);
    const layout = this.session.layoutFor(record);
    const failures: KanbanError[] = [];
    const bound = new Set(Object.values(record.bindings));
    for (const entry of Object.values(record.published)) {
      // A removed board still has to be applied by an installation that holds it; an
      // installation that never held it has nothing to remove.
      if (entry.removed && !bound.has(entry.key)) continue;
      // A board this installation cannot read is that board's own state: it must not
      // fail the updates of the boards that can be applied.
      if (needsPluginUpdate(record.boards[entry.key]?.problem)) continue;
      try { await this.applyKey(this.session.requireRecord(hubId), entry.key, false); }
      catch (error) {
        failures.push(error instanceof KanbanError ? error : new KanbanError('SHARING_FAILED', error instanceof Error ? error.message : String(error)));
      }
    }
    await this.observer.refresh(this.session.requireRecord(hubId), layout);
    if (failures.length > 0) {
      const first = failures[0]!;
      const suffix = failures.length === 1 ? '' : ' ' + (failures.length - 1) + ' other board(s) need attention too.';
      throw new KanbanError(first.code, first.message + suffix, { ...first.details, pendingBoards: failures.length });
    }
  }

  /** Apply one published log, creating the local board when this installation lacks it. */
  async applyKey(record: HubSharingRecord, key: string, alsoRefresh = true): Promise<void> {
    const layout = this.session.layoutFor(record);
    const snapshot = await layout.readLog(key);
    if (snapshot === null) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'The team board has no published log.', { key });
    const hub = this.session.options.hubs.requireHub(record.hubId);
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
        await this.session.save({ ...record, bindings, orphans });
        await this.applyKey(this.session.requireRecord(record.hubId), key, alsoRefresh);
        return;
      }
      const published = publishedWorkflow(snapshot.log);
      if (published === null) throw new KanbanError('SHARING_INVALID_DOCUMENT', 'The team board cannot be read.', { key });
      const entry = record.published[key];
      const name = entry?.name ?? identityName(snapshot.log) ?? key;
      const identity = foldIdentity(mirrorIdentity(stored), pending);
      const orderClean = this.orderIsClean(record, hub);
      const createdText = materializeIdentities(published);
      const created = await this.session.options.hubs.hub(record.hubId).transact(draft => {
        const added = operations.addBoard(draft, name, this.session.deps());
        // The team's recorded choice travels with the board. An absent one keeps the
        // legacy host-default meaning of a board this installation never authored.
        if (identity.presetMode === null) delete added.defaultPresetMode;
        else added.defaultPresetMode = identity.presetMode;
        operations.saveBoardWorkflow(draft, added.id, createdText, this.session.deps());
        operations.setBoardProjectScope(draft, added.id, appliedScope(snapshot.log), this.session.deps());
        if (orderClean && identity.rank !== null) reorderBoundBoards(draft, { ...record.bindings, [added.id]: key }, { ...record.boards, [key]: { ...stored, rank: identity.rank } });
        return added.id;
      }, hub.revision);
      await this.session.noteRevision(record.hubId, created, null, createdText, undefined, identity.presetMode ?? undefined);
      // A board that no longer exists must not keep a binding to this key.
      const bindings = { ...record.bindings };
      for (const [boundId, boundKey] of Object.entries(bindings)) if (boundKey === key) delete bindings[boundId];
      bindings[created] = key;
      const next = { ...record, bindings, boards: { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: published, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, presetMode: identity.presetMode, updates: 0, removal: false, incoming: null, conflict: null, problem: null } } };
      await this.session.save(next);
      if (alsoRefresh) await this.observer.refresh(this.session.requireRecord(record.hubId), layout);
      return;
    }
    if (pending.some(event => event.kind === 'board.removed')) {
      await this.applyRemoval(record, snapshot, key, board.id, nameOf(record, key, board.name));
      return;
    }
    const recovered = replay(snapshot.log, stored.workflow === null ? null : { text: stored.workflow, cursor: stored.seq });
    if (!recovered.ok) {
      await this.session.save({ ...record, boards: { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, updates: Math.max(pending.length, 1), conflict: recovered.conflict.kind, incoming: publishedWorkflow(snapshot.log), problem: null } } });
      throw new KanbanError('SHARING_REVIEW_REQUIRED', 'The team changed a stage of board "' + board.name + '" in a way this installation cannot apply on its own. Review the board.', { key, boardId: board.id, kind: recovered.conflict.kind, reason: recovered.conflict.message });
    }
    const identity = foldIdentity(mirrorIdentity(stored), recovered.events);
    const adoptName = stored.name !== null && board.name === stored.name;
    const adoptScope = sameScope(stored.projectKeys, board.allowedProjectKeys ?? null);
    // A first apply adopts the team's board whole, including its recorded default. A
    // later apply adopts the document only when this installation has not edited it and
    // the recorded default only when this installation has not changed it locally.
    const adoptWorkflow = stored.workflow === null || !workflowDiffers(board.workflowYaml, stored.workflow);
    const adoptPreset = stored.workflow === null || (board.defaultPresetMode ?? null) === (stored.presetMode ?? null);
    const orderClean = this.orderIsClean(record, hub);
    const renames = stageRenames(recovered.events.filter(event => event.seq > stored.seq));
    const appliedText = recovered.text;
    const workflowChanged = appliedText !== board.workflowYaml;
    const blocking = adoptWorkflow ? this.blockingColumns(appliedText, hub, board, renames) : null;
    if (blocking !== null) {
      await this.session.save({ ...record, boards: { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, updates: Math.max(pending.length, 1), incoming: appliedText, problem: null } } });
      throw new KanbanError('SHARING_ORPHAN_COLUMNS', 'Applying the team change to board "' + board.name + '" would leave ' + blocking.tasks + ' task' + (blocking.tasks === 1 ? '' : 's') + ' in column "' + blocking.columnId + '". Move them, then get the update again.', { key, boardId: board.id, columnId: blocking.columnId, tasks: blocking.tasks });
    }
    if (identityDiverged(board.workflowYaml, recovered.events)) {
      await this.session.save({ ...record, boards: { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, present: true, updates: Math.max(pending.length, 1), conflict: 'identity', incoming: appliedText, problem: null } } });
      throw new KanbanError('SHARING_REVIEW_REQUIRED', 'The team and this installation renamed a stage of board "' + board.name + '" differently. Review the board.', { key, boardId: board.id, kind: 'identity' });
    }
    await this.session.options.hubs.hub(record.hubId).transact(draft => {
      // The references move first: saving a workflow that no longer defines a task's
      // stage would be refused, and the rename is what makes them agree again.
      if (adoptWorkflow) {
        for (const rename of renames) for (const task of draft.tasks) if (task.boardId === board.id) renameTaskStage(task, rename.from, rename.to);
        if (workflowChanged) operations.saveBoardWorkflow(draft, board.id, appliedText, this.session.deps());
      }
      if (adoptName && identity.name !== null && identity.name !== board.name) operations.renameBoard(draft, board.id, identity.name, this.session.deps());
      if (adoptScope && !sameScope(identity.projectKeys, board.allowedProjectKeys ?? null)) operations.setBoardProjectScope(draft, board.id, identity.projectKeys === null ? undefined : [...identity.projectKeys], this.session.deps());
      if (adoptPreset) {
        const target = operations.requireBoard(draft, board.id);
        if (identity.presetMode === null) delete target.defaultPresetMode;
        else target.defaultPresetMode = identity.presetMode;
      }
      if (orderClean && identity.rank !== null) reorderBoundBoards(draft, record.bindings, { ...record.boards, [key]: { ...stored, rank: identity.rank } });
    }, hub.revision);
    const nextPreset = adoptPreset ? identity.presetMode ?? undefined : board.defaultPresetMode;
    if ((adoptWorkflow && workflowChanged) || (adoptPreset && nextPreset !== board.defaultPresetMode)) {
      await this.session.noteRevision(record.hubId, board.id, board.workflowYaml, adoptWorkflow ? appliedText : board.workflowYaml, board.defaultPresetMode, nextPreset);
    }
    await this.session.save({
      ...record,
      boards: { ...record.boards, [key]: { ...stored, seq: recovered.cursor, head: snapshot.head, probe: snapshot.probe, present: true, workflow: appliedText, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, presetMode: adoptPreset ? identity.presetMode : stored.presetMode ?? null, updates: 0, removal: false, incoming: null, conflict: null, problem: null } },
      lastSyncedAt: this.session.now(),
      reviewRequired: null,
      lastError: null,
    });
    if (alsoRefresh) await this.observer.refresh(this.session.requireRecord(record.hubId), layout);
  }

  /** Resolve a board that needs a choice, applying the team version or keeping the local one. */
  async resolve(hubId: string, boardId: string, choice: 'local' | 'team'): Promise<void> {
    const record = this.session.requireRecord(hubId);
    this.session.assertReady(record);
    const key = record.bindings[boardId];
    invariant(key !== undefined, 'SHARING_NOT_CONFLICT', 'The board is not published.');
    const layout = this.session.layoutFor(record);
    const snapshot = await layout.readLog(key);
    invariant(snapshot !== null, 'SHARING_NOT_CONFLICT', 'The team board has no published board.');
    const stored = record.boards[key] ?? emptyBoard();
    if (choice === 'team') {
      const head = replay(snapshot.log, null);
      invariant(head.ok, 'SHARING_INVALID_DOCUMENT', 'The team board cannot be read.');
      const hub = this.session.options.hubs.requireHub(hubId);
      const board = hub.boards.find(candidate => candidate.id === boardId);
      invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist.');
      const pending = eventsAfter(snapshot.log, stored.seq);
      const renames = stageRenames(pending);
      const identity = foldIdentity(mirrorIdentity(stored), pending);
      // Resolving the workflow to the team version does not discard an unpublished
      // local default: it stays local work until this board is published.
      const adoptPreset = (board.defaultPresetMode ?? null) === (stored.presetMode ?? null);
      const blocking = this.blockingColumns(head.text, hub, board, renames);
      if (blocking !== null) {
        throw new KanbanError('SHARING_ORPHAN_COLUMNS', 'The team change to board "' + board.name + '" would leave ' + blocking.tasks + ' task' + (blocking.tasks === 1 ? '' : 's') + ' in column "' + blocking.columnId + '". Move them, then choose again.', { boardId, columnId: blocking.columnId, tasks: blocking.tasks });
      }
      try {
        await this.session.options.hubs.hub(hubId).transact(draft => {
          for (const rename of renames) for (const task of draft.tasks) if (task.boardId === boardId) renameTaskStage(task, rename.from, rename.to);
          operations.saveBoardWorkflow(draft, boardId, head.text, this.session.deps());
          if (identity.name !== null && identity.name !== board.name) operations.renameBoard(draft, boardId, identity.name, this.session.deps());
          operations.setBoardProjectScope(draft, boardId, identity.projectKeys === null ? undefined : [...identity.projectKeys], this.session.deps());
          if (adoptPreset) {
            const target = operations.requireBoard(draft, boardId);
            if (identity.presetMode === null) delete target.defaultPresetMode;
            else target.defaultPresetMode = identity.presetMode;
          }
        }, hub.revision);
        await this.session.noteRevision(hubId, boardId, board.workflowYaml, head.text, board.defaultPresetMode, adoptPreset ? identity.presetMode ?? undefined : board.defaultPresetMode);
      } catch (error) {
        throw this.refusal(error, head.text, hub, board);
      }
      await this.session.save({ ...record, boards: { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: head.text, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, presetMode: appliedPreset(snapshot.log), updates: 0, removal: false, incoming: null, conflict: null, problem: null } }, reviewRequired: null });
      await this.observer.refresh(this.session.requireRecord(hubId), layout);
      return;
    }
    // Keeping the local version accepts the divergence: the cursor moves to the head so
    // the board stops asking, and the local board stays a draft to publish.
    const publishedText = publishedWorkflow(snapshot.log);
    const identity = foldIdentity(mirrorIdentity(stored), eventsAfter(snapshot.log, stored.seq));
    await this.session.save({ ...record, boards: { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: publishedText, name: identity.name, projectKeys: identity.projectKeys, rank: identity.rank, presetMode: appliedPreset(snapshot.log), updates: 0, removal: false, incoming: null, conflict: null, problem: null } }, reviewRequired: null });
    await this.observer.refresh(this.session.requireRecord(hubId), layout);
  }

  /** Apply the team's removal of one board: delete it when empty, otherwise orphan it. */
  private async applyRemoval(record: HubSharingRecord, snapshot: BoardLogSnapshot, key: string, boardId: string, name: string): Promise<void> {
    const hub = this.session.options.hubs.requireHub(record.hubId);
    const board = hub.boards.find(candidate => candidate.id === boardId);
    const hasTasks = hub.tasks.some(task => task.boardId === boardId);
    const stored = record.boards[key] ?? emptyBoard();
    // Publishable local work is decided the same way everywhere, so a board whose only
    // local change is a rename, a scope, or the recorded default is kept as an orphan
    // rather than deleted under the team's removal.
    const dirty = board !== undefined && boardDiffers(
      { workflow: board.workflowYaml, name: board.name, projectKeys: board.allowedProjectKeys ?? null, rank: stored.rank, presetMode: board.defaultPresetMode },
      { workflow: stored.workflow ?? board.workflowYaml, name: stored.name, projectKeys: stored.projectKeys, rank: stored.rank, presetMode: stored.presetMode ?? null },
    );
    // The placement is kept with its cursor at the removal: a board the team publishes
    // again is then measured from that event, not replayed from the beginning.
    const boards = { ...record.boards, [key]: { ...stored, seq: lastSequence(snapshot.log), head: snapshot.head, probe: snapshot.probe, present: true, workflow: stored.workflow, updates: 0, removal: true, conflict: null, incoming: null, problem: null } };
    const bindings = { ...record.bindings };
    delete bindings[boardId];
    const orphans = { ...record.orphans };
    if (board !== undefined && (hasTasks || dirty)) {
      orphans[boardId] = { lastKey: key, lastPublishedName: record.published[key]?.name ?? name };
      await this.session.save({ ...record, bindings, boards, orphans, lastSyncedAt: this.session.now() });
      return;
    }
    if (board !== undefined) {
      await this.session.options.hubs.hub(record.hubId).transact(draft => { operations.deleteBoard(draft, boardId, this.session.deps()); return draft; }, hub.revision);
      await this.session.removeRevisions(boardId);
    }
    await this.session.save({ ...record, bindings, boards, orphans, lastSyncedAt: this.session.now() });
  }

  /** Whether the local board order still matches the applied positions. */
  private orderIsClean(record: HubSharingRecord, hub: { boards: ReadonlyArray<{ id: string }> }): boolean {
    const bound = hub.boards.filter(board => record.bindings[board.id] !== undefined).map(board => record.bindings[board.id]!);
    if (bound.length < 2) return true;
    const ranks = new Map(bound.map(key => [key, record.boards[key]?.rank ?? null]));
    const planned = planRanks(bound, ranks);
    return planned !== null && planned.size === 0;
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

/** One local board as the orphan-column check needs it. */
function localBoardOf(hub: { tasks: ReadonlyArray<{ boardId: string; columnId: string }> }, board: { id: string; name: string; workflowYaml: string; allowedProjectKeys?: readonly string[] }) {
  const counts = new Map<string, number>();
  for (const task of hub.tasks) if (task.boardId === board.id) counts.set(task.columnId, (counts.get(task.columnId) ?? 0) + 1);
  return { boardId: board.id, name: board.name, workflow: board.workflowYaml, projectKeys: board.allowedProjectKeys === undefined ? null : [...board.allowedProjectKeys], tasks: 0, taskColumns: [...counts].map(([columnId, tasks]) => ({ columnId, tasks })) };
}
