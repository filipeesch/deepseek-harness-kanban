import { randomUUID } from 'node:crypto';
import { KanbanError, invariant } from '../../shared/errors.js';
import type { HubSharingView, HubState, SharingCommand } from '../../shared/types.js';
import { boardKeyFromName, normalizeBoardName } from '../../domain/sharing/identity.js';
import type { SharedBoardEntry, SharedHubManifest } from '../../domain/sharing/manifest.js';
import { projectSharingBoards, type LocalSharedBoard } from '../../domain/sharing/projection.js';
import { evaluateBoard, publishedWorkflow, workflowDigest } from '../../domain/sharing/board-plan.js';
import { deriveChanges } from '../../domain/journal/derive.js';
import { recoverBoard, type BoardLogFile } from '../../domain/journal/log.js';
import { stageRenames } from '../../domain/journal/migrate.js';
import * as operations from '../../domain/hub-operations.js';
import type { HubRepository } from '../hub-repository.js';
import { isAuthorizationCommand, type SharingAuthorizationPort } from './auth-coordinator.js';
import type { BindingCandidate, ProviderState, SharingBinding, SharingProviderId, SharingProviderResolver } from './provider.js';
import type { SharedLayoutStore } from './ports.js';
import { LaneRegistry } from './lanes.js';
import { emptyBoard, type HubSharingRecord, type HubSharingStore, type StoredBoard } from './state.js';
import type { TeamFileStore, TeamFileStoreResolution } from './team-file-store.js';
import { buildSharingView, publishedManifest } from './view.js';

export const DEFAULT_SHARING_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;
const EMPTY_MANIFEST: SharedHubManifest = { version: 3, boards: [] };

export interface HubSharingOptions {
  hubs: HubRepository;
  store: HubSharingStore;
  providers: SharingProviderResolver;
  auth?: SharingAuthorizationPort;
  now?: () => string;
  id?: () => string;
  notify?: () => void;
  report?: (error: unknown) => void;
  /** Kept for callers that configured the removed automatic synchronization. */
  debounceMs?: number;
}

export function normalizeSharingInterval(value: number | undefined, fallback = DEFAULT_SHARING_INTERVAL_MINUTES): number {
  const minutes = value ?? fallback;
  invariant(Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_INTERVAL_MINUTES, 'INVALID_INPUT', 'The check interval must be a whole number of minutes between 0 and ' + MAX_INTERVAL_MINUTES + '.');
  invariant(minutes === 0 || minutes >= 1, 'INVALID_INPUT', 'The check interval is either 0 (manual checks) or at least one minute.');
  return minutes;
}

/**
 * Owns the publishing lifecycle for every Hub.
 *
 * The published unit is the board: reading, applying, and publishing all happen per
 * board, and the hub manifest is the only thing that is written whole. Every
 * operation for one Hub runs in a serialized lane.
 */
export class HubSharingService {
  private readonly lanes: LaneRegistry;
  private connectTail: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;
  private readonly id: () => string;
  private disposed = false;

  constructor(private readonly options: HubSharingOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
    this.lanes = new LaneRegistry({ onChange: () => this.options.notify?.() });
  }

  views(): Record<string, HubSharingView> {
    const result: Record<string, HubSharingView> = {};
    for (const record of this.options.store.list()) {
      const hub = this.options.hubs.get(record.hubId);
      if (!hub) continue;
      result[record.hubId] = this.viewOf(record, hub);
    }
    return result;
  }

  view(hubId: string): HubSharingView | undefined {
    const record = this.options.store.load(hubId);
    const hub = this.options.hubs.get(hubId);
    return record && hub ? this.viewOf(record, hub) : undefined;
  }

  private viewOf(record: HubSharingRecord, hub: HubState): HubSharingView {
    const provider = this.options.providers.describe(record.binding);
    return buildSharingView(record, hub, {
      provider,
      ...(provider.requiresAuthorization ? { authorization: this.options.auth?.status() ?? 'not-connected' } : {}),
      syncing: this.lanes.busy(record.hubId),
    });
  }

  publishedHubs(): Array<{ hubId: string; intervalMinutes: number }> {
    return this.options.store.list()
      .filter(record => record.preview === null && this.options.hubs.get(record.hubId) !== undefined)
      .map(record => ({ hubId: record.hubId, intervalMinutes: record.binding.intervalMinutes }));
  }

  isBound(hubId: string, boardId: string): boolean {
    return this.options.store.load(hubId)?.bindings[boardId] !== undefined;
  }

  busy(hubId: string): boolean { return this.lanes.busy(hubId); }

  command(command: SharingCommand): Promise<void> {
    if (isAuthorizationCommand(command)) throw new KanbanError('SHARING_UNAVAILABLE', 'Authorization is handled outside the publishing service.');
    if (command.type === 'sharing.setInterval') return this.setInterval(command.hubId, command.intervalMinutes);
    if (command.type === 'sharing.resolve') return this.resolve(command.hubId, command.boardId, command.choice);
    if (command.type === 'sharing.restore') return this.restore(command.hubId, command.boardId);
    if (command.type === 'sharing.publishOrphan') return this.publishOrphan(command.hubId, command.boardId);
    if (command.type === 'sharing.disconnect') return this.disconnect(command.hubId);
    if (command.type === 'sharing.publishInitial') return this.publishInitial(command.hubId, command.confirmed);
    if (command.type === 'sharing.connect') return this.connect(command);
    if (command.type === 'sharing.changeLocation') return this.changeLocation(command);
    if (command.type === 'sharing.receive') return this.receive(command.hubId);
    if (command.type === 'sharing.check') return this.check(command.hubId, true);
    if (command.type === 'sharing.getUpdates') return this.getUpdates(command.hubId);
    if (command.type === 'sharing.updateBoard') return this.updateBoard(command.hubId, command.boardId);
    if (command.type === 'sharing.publishBoard') return this.publishBoard(command.hubId, command.boardId);
    return this.publishManifest(command.hubId);
  }

  connect(command: Extract<SharingCommand, { type: 'sharing.connect' }>): Promise<void> {
    return this.serializeLocation(() => this.run(command.hubId, async () => this.openLocation(command, false)));
  }

  private serializeLocation<T>(operation: () => Promise<T>): Promise<T> {
    const execution = this.connectTail.then(operation);
    this.connectTail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  private changeLocation(command: Extract<SharingCommand, { type: 'sharing.changeLocation' }>): Promise<void> {
    return this.serializeLocation(() => this.run(command.hubId, async () => {
      invariant(command.confirmed, 'CONFIRMATION_REQUIRED', 'Confirm changing the folder for this Hub.');
      const record = this.requireRecord(command.hubId);
      invariant(record.binding.provider === 'google-drive-local', 'SHARING_UNSUPPORTED_STORAGE', 'Only a Google Drive Local Hub can change its folder.');
      await this.openLocation(command, true, record);
    }));
  }

  private async openLocation(
    command: { hubId: string; settings?: Record<string, string>; repository?: string; provider?: SharingProviderId; intervalMinutes?: number },
    replace: boolean,
    existing?: HubSharingRecord,
  ): Promise<void> {
    if (!replace) invariant(this.options.store.load(command.hubId) === undefined, 'SHARING_ALREADY_CONNECTED', 'This Hub is already connected to a team storage.');
    else invariant(existing !== undefined, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team storage.');
    const hub = this.options.hubs.requireHub(command.hubId);
    const providerId: SharingProviderId = existing?.binding.provider ?? command.provider ?? (command.repository ? 'git' : 'google-drive');
    if (existing !== undefined) invariant(providerId === existing.binding.provider, 'SHARING_UNSUPPORTED_STORAGE', 'The team storage cannot change without disconnecting.');
    const rawSettings = command.settings ?? (command.repository ? { repository: command.repository } : {});
    const candidate: SharingBinding = {
      provider: providerId,
      intervalMinutes: normalizeSharingInterval(command.intervalMinutes, existing?.binding.intervalMinutes ?? this.options.providers.defaultInterval(providerId)),
      settings: this.options.providers.normalize(providerId, rawSettings),
    };
    if (this.options.providers.describe(candidate).requiresAuthorization) {
      const auth = this.options.auth;
      invariant(auth, 'SHARING_UNAVAILABLE', 'Google Drive authorization is unavailable in this host.');
      await auth.ensureConnected();
    }
    const binding = await this.options.providers.prepare(command.hubId, candidate, this.candidates());
    const snapshot = await this.layout(command.hubId, binding, {}).readManifest();
    const at = this.now();
    if (snapshot === null) {
      await this.save(this.emptyRecord(command.hubId, binding, at));
      await this.publishManifestNow(command.hubId, []);
      return;
    }
    const record = this.emptyRecord(command.hubId, binding, at);
    await this.save({
      ...record,
      preview: { token: snapshot.token, manifest: snapshot.manifest },
      lastCheck: { at, token: snapshot.token },
      lastSyncedAt: null,
    });
  }

  receive(hubId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const preview = record.preview;
      invariant(preview, 'SHARING_NO_PREVIEW', 'This Hub has no pending connection preview.');
      const hub = this.options.hubs.requireHub(hubId);
      const bindings = { ...record.bindings };
      for (const board of hub.boards) {
        if (bindings[board.id] !== undefined) continue;
        const entry = preview.manifest.boards.find(candidate => normalizeBoardName(candidate.name) === normalizeBoardName(board.name));
        if (entry !== undefined) bindings[board.id] = entry.key;
      }
      await this.save({
        ...record,
        preview: null,
        seen: preview,
        base: preview,
        bindings,
        lastSyncedAt: this.now(),
        reviewRequired: null,
        lastError: null,
      });
    });
  }

  publishInitial(hubId: string, confirmed: boolean): Promise<void> {
    return this.run(hubId, async () => {
      invariant(confirmed, 'CONFIRMATION_REQUIRED', 'Confirm replacing the team configuration with this Hub.');
      const record = this.requireRecord(hubId);
      const preview = record.preview;
      invariant(preview, 'SHARING_NO_PREVIEW', 'This Hub has no pending connection preview.');
      await this.publishManifestNow(hubId, [], preview.token);
    });
  }

  check(hubId: string, manual = false): Promise<void> {
    return this.run(hubId, async () => this.checkNow(hubId, manual));
  }

  /** Read the manifest and one probe per board. It never applies a team change. */
  private async checkNow(hubId: string, manual: boolean): Promise<void> {
    const record = this.requireRecord(hubId);
    const layout = this.layout(record.hubId, record.binding, record.providerState);
    const at = this.now();
    try {
      const snapshot = await layout.readManifest();
      const manifest = snapshot?.manifest ?? EMPTY_MANIFEST;
      const boards = await this.observeBoards(record, manifest);
      await this.save({
        ...record,
        providerState: layout.state?.() ?? record.providerState,
        storageReview: layout.review?.() ?? null,
        seen: snapshot === null ? null : { token: snapshot.token, manifest },
        preview: record.preview === null ? null : (snapshot === null ? null : { token: snapshot.token, manifest }),
        boards,
        lastCheck: { at, token: snapshot?.token ?? 'none' },
        lastSyncedAt: record.lastSyncedAt ?? null,
        reviewRequired: manual ? null : record.reviewRequired ?? null,
        // A check that read the configuration successfully ends any earlier failure.
        lastError: null,
      });
    } catch (error) {
      await this.persistFailure(record, error);
      throw error;
    }
  }

  /** Observe every published board without applying anything. */
  private async observeBoards(record: HubSharingRecord, manifest: SharedHubManifest): Promise<Record<string, StoredBoard>> {
    const hub = this.options.hubs.requireHub(record.hubId);
    const local = projectSharingBoards(hub, record.bindings);
    const byKey = new Map(local.filter(board => board.key !== undefined).map(board => [board.key!, board]));
    const layout = this.layout(record.hubId, record.binding, record.providerState);
    const boards: Record<string, StoredBoard> = { ...record.boards };
    for (const entry of manifest.boards) {
      const board = byKey.get(entry.key);
      if (board === undefined) continue;
      const stored = boards[entry.key] ?? emptyBoard();
      // A probe that did not change means the log did not change, so the check never
      // reads a board the team did not touch.
      const probe = await layout.probe(entry.key);
      if (probe !== null && probe === stored.probe && stored.head !== null) continue;
      const snapshot = await layout.readLog(entry.key);
      if (snapshot === null) { boards[entry.key] = { ...stored, behind: 0 }; continue; }
      const evaluation = evaluateBoard({ entry, local: board, log: snapshot.log, cursor: stored.seq });
      boards[entry.key] = {
        ...stored,
        head: snapshot.head,
        probe: snapshot.probe,
        published: publishedWorkflow(snapshot.log) === null ? stored.published : workflowDigest(publishedWorkflow(snapshot.log)!),
        behind: evaluation.apply.kind === 'applies' ? evaluation.apply.events : 0,
        draft: evaluation.draft,
        conflict: evaluation.apply.kind === 'conflict' ? evaluation.apply.conflict : null,
      };
    }
    return boards;
  }

  getUpdates(hubId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const manifest = publishedManifest(record);
      for (const entry of manifest.boards) await this.applyEntry(record.hubId, entry);
      await this.refreshObservations(hubId);
    });
  }

  updateBoard(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const key = record.bindings[boardId];
      invariant(key !== undefined, 'SHARING_NOT_PUBLISHED', 'This board is not published to the team.');
      const entry = publishedManifest(record).boards.find(candidate => candidate.key === key);
      invariant(entry, 'SHARING_NOT_PUBLISHED', 'The team no longer publishes this board.');
      await this.applyEntry(hubId, entry);
      await this.refreshObservations(hubId);
    });
  }

  /** Re-read the boards this Hub holds so the view reflects what applying did. */
  private async refreshObservations(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    const boards = await this.observeBoards(record, publishedManifest(record));
    await this.save({ ...record, boards, lastSyncedAt: this.now(), reviewRequired: null, lastError: null });
  }

  /** Apply one published board, creating it locally when this installation does not hold it. */
  private async applyEntry(hubId: string, entry: SharedBoardEntry): Promise<void> {
    const record = this.requireRecord(hubId);
    const layout = this.layout(hubId, record.binding, record.providerState);
    const snapshot = await layout.readLog(entry.key);
    if (snapshot === null) return;
    const hub = this.options.hubs.requireHub(hubId);
    const boardId = Object.entries(record.bindings).find(([, key]) => key === entry.key)?.[0];
    const board = boardId === undefined ? undefined : hub.boards.find(candidate => candidate.id === boardId);
    if (board === undefined) {
      const recovered = recoverBoard(snapshot.log, null);
      if (!recovered.ok) throw this.conflictError(entry.key, recovered.conflict);
      const created = await this.options.hubs.hub(hubId).transact(draft => {
        const added = operations.addBoard(draft, entry.name, this.deps());
        operations.saveBoardWorkflow(draft, added.id, recovered.text, this.deps());
        operations.setBoardProjectScope(draft, added.id, entry.projectKeys, this.deps());
        return added.id;
      }, hub.revision);
      await this.save({ ...record, bindings: { ...record.bindings, [created]: entry.key }, boards: { ...record.boards, [entry.key]: { seq: recovered.cursor, head: snapshot.head, probe: snapshot.probe, behind: 0, published: workflowDigest(recovered.text), draft: false, conflict: null } } });
      return;
    }
    const stored = record.boards[entry.key] ?? emptyBoard();
    const recovered = recoverBoard(snapshot.log, { text: board.workflowYaml, cursor: stored.seq });
    if (!recovered.ok) {
      await this.save({ ...record, boards: { ...record.boards, [entry.key]: { ...stored, head: snapshot.head, probe: snapshot.probe, conflict: recovered.conflict.kind, behind: stored.behind } } });
      throw this.conflictError(entry.key, recovered.conflict);
    }
    const renames = stageRenames(snapshot.log.events.filter(event => event.seq > stored.seq));
    await this.options.hubs.hub(hubId).transact(draft => {
      // The references move first: saving a workflow that no longer defines a task's
      // stage would be refused, and the rename is what makes them agree again.
      for (const rename of renames) {
        for (const task of draft.tasks) if (task.boardId === board.id) renameTaskReferences(task, rename.from, rename.to);
      }
      operations.saveBoardWorkflow(draft, board.id, recovered.text, this.deps());
      operations.setBoardProjectScope(draft, board.id, entry.projectKeys, this.deps());
    }, hub.revision);
    await this.save({
      ...record,
      boards: { ...record.boards, [entry.key]: { seq: recovered.cursor, head: snapshot.head, probe: snapshot.probe, behind: 0, published: workflowDigest(recovered.text), draft: false, conflict: null } },
      lastSyncedAt: this.now(),
      reviewRequired: null,
      lastError: null,
    });
  }

  resolve(hubId: string, boardId: string, choice: 'local' | 'team'): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const key = record.bindings[boardId];
      invariant(key !== undefined, 'SHARING_NOT_CONFLICT', 'The board is not published.');
      const layout = this.layout(hubId, record.binding, record.providerState);
      const snapshot = await layout.readLog(key);
      invariant(snapshot !== null, 'SHARING_NOT_CONFLICT', 'The team board has no published state.');
      const head = recoverBoard(snapshot.log, null);
      invariant(head.ok, 'SHARING_INVALID_DOCUMENT', 'The team board cannot be read.');
      const stored = record.boards[key] ?? emptyBoard();
      if (choice === 'team') {
        const hub = this.options.hubs.requireHub(hubId);
        const renames = stageRenames(snapshot.log.events.filter(event => event.seq > stored.seq));
        await this.options.hubs.hub(hubId).transact(draft => {
          for (const rename of renames) for (const task of draft.tasks) if (task.boardId === boardId) renameTaskReferences(task, rename.from, rename.to);
          operations.saveBoardWorkflow(draft, boardId, head.text, this.deps());
        }, hub.revision);
        await this.save({ ...record, boards: { ...record.boards, [key]: { seq: head.cursor, head: snapshot.head, probe: snapshot.probe, behind: 0, published: workflowDigest(head.text), draft: false, conflict: null } }, reviewRequired: null });
        return;
      }
      // Keeping the local version accepts the divergence: the cursor moves to the head
      // so the board stops asking, and the board stays a draft to publish.
      await this.save({ ...record, boards: { ...record.boards, [key]: { ...stored, seq: head.cursor, head: snapshot.head, probe: snapshot.probe, behind: 0, draft: true, conflict: null } }, reviewRequired: null });
    });
  }

  publishManifest(hubId: string): Promise<void> {
    return this.run(hubId, async () => { await this.publishManifestNow(hubId, []); });
  }

  publishBoard(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => { await this.publishBoardNow(hubId, boardId); });
  }

  setInterval(hubId: string, intervalMinutes: number): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const fallback = this.options.providers.describe(record.binding).defaultIntervalMinutes;
      await this.save({ ...record, binding: { ...record.binding, intervalMinutes: normalizeSharingInterval(intervalMinutes, fallback) } });
    });
  }

  disconnect(hubId: string): Promise<void> {
    return this.run(hubId, async () => this.removeBinding(hubId));
  }

  removeHub(hubId: string): Promise<void> {
    if (this.options.store.load(hubId) === undefined) return Promise.resolve();
    return this.run(hubId, async () => this.removeBinding(hubId));
  }

  removeBoard(hubId: string, boardId: string, scope: 'local' | 'team', name: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.options.store.load(hubId);
      if (!record) return;
      const key = record.bindings[boardId];
      if (key === undefined) {
        if (record.orphans[boardId] === undefined) return;
        const orphans = { ...record.orphans };
        delete orphans[boardId];
        await this.save({ ...record, orphans });
        return;
      }
      const bindings = { ...record.bindings };
      delete bindings[boardId];
      const orphans = { ...record.orphans };
      delete orphans[boardId];
      const boards = { ...record.boards };
      delete boards[key];
      const next: HubSharingRecord = { ...record, bindings, orphans, boards };
      if (scope === 'local') next.removed = { ...record.removed, [key]: { boardId, name } };
      else if (!record.pendingRemovals.includes(key)) next.pendingRemovals = [...record.pendingRemovals, key];
      await this.save(next);
    });
  }

  restore(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const removed = Object.entries(record.removed).find(([, value]) => value.boardId === boardId);
      invariant(removed, 'SHARING_NOT_REMOVED', 'The board is not removed only from this installation.');
      const [key] = removed;
      const entry = publishedManifest(record).boards.find(candidate => candidate.key === key);
      const nextRemoved = { ...record.removed };
      delete nextRemoved[key];
      if (entry === undefined) {
        await this.save({ ...record, removed: nextRemoved });
        throw new KanbanError('SHARING_REMOVED_GONE', 'The team board no longer exists, so it cannot be restored.');
      }
      await this.save({ ...record, removed: nextRemoved, bindings: { ...record.bindings, [boardId]: key } });
      await this.applyEntry(hubId, entry);
    });
  }

  publishOrphan(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      invariant(record.orphans[boardId] !== undefined, 'SHARING_NOT_ORPHAN', 'The board is not an orphan.');
      const orphans = { ...record.orphans };
      delete orphans[boardId];
      await this.save({ ...record, orphans });
      await this.publishManifestNow(hubId, [record.orphans[boardId]?.lastKey ?? '']);
    });
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.options.auth?.cancel();
    await this.lanes.close();
  }

  fileStoreFor(hubId: string): TeamFileStoreResolution {
    const record = this.options.store.load(hubId);
    invariant(record, 'TEAM_FILES_UNAVAILABLE', 'This Hub is not connected to a team storage. Connect one in Team Settings to use team files.');
    const described = this.options.providers.describe(record.binding);
    const store = this.options.providers.createFileStore?.(hubId, record.binding, record.providerState);
    if (store === undefined) {
      throw new KanbanError('TEAM_FILES_UNSUPPORTED', 'Team files are unavailable with ' + described.label + '. Team files need a Git repository, a local folder, or a Google Drive Local folder.', { provider: record.binding.provider });
    }
    return { store: this.lockedFileStore(hubId, store), provider: described.id, label: described.label, address: described.address };
  }

  exclusive<T>(hubId: string, operation: () => Promise<T>): Promise<T> {
    return this.lanes.exclusive(hubId, operation);
  }

  /** A local change is a draft; publishing it is always the user's decision. */
  noteLocalChange(hubId: string): void {
    if (this.options.store.load(hubId) === undefined) return;
    this.options.notify?.();
  }

  /** Publish the hub manifest: board names, order, project scopes, and removals. */
  private async publishManifestNow(hubId: string, reserved: Iterable<string>, expectedToken?: string | null): Promise<void> {
    const record = this.requireRecord(hubId);
    const hub = this.options.hubs.requireHub(hubId);
    const layout = this.layout(hubId, record.binding, record.providerState);
    const local = projectSharingBoards(hub, record.bindings);
    const composed = composeManifest({
      current: publishedManifest(record),
      local,
      pendingRemovals: record.pendingRemovals,
      reserved,
      allocate: (name, taken) => boardKeyFromName(name, taken),
    });
    const written = await layout.writeManifest(composed.manifest, { expectedToken: expectedToken === undefined ? record.seen?.token ?? null : expectedToken, message: 'Update published Kanban configuration' });
    // Every published board needs its log; a board entering the team gets its snapshot.
    const boards = { ...record.boards };
    for (const entry of composed.manifest.boards) {
      // The composed bindings carry the key a board just received, which the stored
      // record does not have yet.
      const board = local.find(candidate => composed.bindings[candidate.boardId] === entry.key || record.bindings[candidate.boardId] === entry.key);
      if (board === undefined) continue;
      const existing = await layout.readLog(entry.key);
      if (existing !== null) { boards[entry.key] = boards[entry.key] ?? { ...emptyBoard(), head: existing.head, probe: existing.probe }; continue; }
      const created = await layout.createLog(entry.key, board.workflow);
      boards[entry.key] = { seq: 0, head: created.head, probe: created.probe, behind: 0, published: workflowDigest(board.workflow), draft: false, conflict: null };
    }
    const stored = { token: written.token, manifest: composed.manifest };
    await this.save({
      ...record,
      providerState: layout.state?.() ?? record.providerState,
      storageReview: layout.review?.() ?? null,
      base: stored,
      seen: stored,
      preview: null,
      bindings: composed.bindings,
      boards,
      pendingRemovals: [],
      syncedRevision: hub.revision,
      lastCheck: { at: this.now(), token: written.token },
      lastSyncedAt: this.now(),
      reviewRequired: null,
      lastError: null,
    });
  }

  /** Publish one board's local changes as events appended to its log. */
  private async publishBoardNow(hubId: string, boardId: string): Promise<void> {
    let record = this.requireRecord(hubId);
    const hub = this.options.hubs.requireHub(hubId);
    const board = hub.boards.find(candidate => candidate.id === boardId);
    invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist.');
    let key = record.bindings[boardId];
    if (key === undefined) {
      // A board entering the team is named by the manifest first, so its log has a key.
      await this.publishManifestNow(hubId, []);
      record = this.requireRecord(hubId);
      key = record.bindings[boardId];
      invariant(key !== undefined, 'SHARING_PUBLISH_BLOCKED', 'The board could not be added to the team configuration.');
    }
    const layout = this.layout(hubId, record.binding, record.providerState);
    const stored = record.boards[key] ?? emptyBoard();
    const snapshot = await layout.readLog(key);
    if (snapshot === null) {
      const created = await layout.createLog(key, board.workflowYaml);
      await this.save({ ...record, boards: { ...record.boards, [key]: { seq: 0, head: created.head, probe: created.probe, behind: 0, published: workflowDigest(board.workflowYaml), draft: false, conflict: null } }, lastSyncedAt: this.now() });
      return;
    }
    const published = publishedWorkflow(snapshot.log);
    invariant(published !== null, 'SHARING_INVALID_DOCUMENT', 'The team board cannot be read.');
    const changes = deriveChanges({ text: published }, { text: board.workflowYaml }, { allocate: () => this.id() });
    if (changes.length === 0) {
      await this.save({ ...record, boards: { ...record.boards, [key]: { ...stored, head: snapshot.head, probe: snapshot.probe, behind: 0, published: workflowDigest(published), draft: false } } });
      return;
    }
    const appended = await layout.appendChanges(key, changes, { expectedHead: snapshot.head, message: 'Update published Kanban board', at: this.now() });
    await this.save({
      ...record,
      providerState: layout.state?.() ?? record.providerState,
      boards: { ...record.boards, [key]: { seq: lastSequence(appended.log), head: appended.head, probe: appended.probe, behind: 0, published: workflowDigest(board.workflowYaml), draft: false, conflict: null } },
      syncedRevision: hub.revision,
      lastSyncedAt: this.now(),
      reviewRequired: null,
      lastError: null,
    });
  }

  private layout(hubId: string, binding: SharingBinding, state: ProviderState): SharedLayoutStore {
    const create = this.options.providers.createLayoutStore;
    if (create === undefined) throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'This host cannot read the published team configuration.', { provider: binding.provider });
    void hubId;
    return create.call(this.options.providers, hubId, binding, state);
  }

  private emptyRecord(hubId: string, binding: SharingBinding, at: string): HubSharingRecord {
    return {
      version: 3, hubId, binding, providerState: {}, syncedRevision: null,
      base: null, seen: null, preview: null,
      bindings: {}, orphans: {}, removed: {}, pendingRemovals: [], boards: {},
      lastCheck: { at, token: 'none' }, lastSyncedAt: null, lastError: null,
    };
  }

  private deps() {
    return this.options.hubs.operationDeps();
  }

  private lockedFileStore(hubId: string, store: TeamFileStore): TeamFileStore {
    const locked: TeamFileStore = {
      ensure: () => store.ensure(),
      list: () => store.list(),
      read: (relative, options) => store.read(relative, options),
      create: (relative, content) => this.exclusive(hubId, () => store.create(relative, content)),
      write: (relative, content, options) => this.exclusive(hubId, () => store.write(relative, content, options)),
      move: (from, to, options) => this.exclusive(hubId, () => store.move(from, to, options)),
    };
    const head = store.head;
    if (head !== undefined) locked.head = () => head.call(store);
    return locked;
  }

  private requireRecord(hubId: string): HubSharingRecord {
    const record = this.options.store.load(hubId);
    invariant(record, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team storage.');
    return record;
  }

  private candidates(): BindingCandidate[] {
    return this.options.store.list().map(record => ({ hubId: record.hubId, provider: record.binding.provider, settings: record.binding.settings }));
  }

  private conflictError(key: string, conflict: { kind: 'identity' | 'lifecycle'; message: string }): KanbanError {
    return new KanbanError('SHARING_REVIEW_REQUIRED', 'The team changed a stage of board "' + key + '" in a way this installation cannot apply on its own. Review the board.', { key, kind: conflict.kind, reason: conflict.message });
  }

  private async save(record: HubSharingRecord): Promise<void> {
    await this.options.store.save(record);
    this.options.notify?.();
  }

  private async persistFailure(record: HubSharingRecord, error: unknown): Promise<void> {
    const code = error instanceof KanbanError ? error.code : 'SHARING_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    await this.save({ ...record, lastError: { code, message }, ...(code === 'SHARING_CONCURRENT_WRITE' ? { reviewRequired: { code, message } } : {}) });
  }

  private async removeBinding(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    try { await this.layout(hubId, record.binding, record.providerState).destroy(); }
    catch (error) { this.options.report?.(error); }
    await this.options.store.delete(hubId);
    this.options.notify?.();
  }

  private run<T>(hubId: string, operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The Kanban plugin is shutting down.');
    return this.lanes.run(hubId, operation);
  }
}

/** Carry one renamed stage identifier into a task's references. */
function renameTaskReferences(task: { columnId: string; pendingTransition?: { fromColumnId: string; columnId: string }; recordedTransition?: { fromColumnId: string; columnId: string }; instructionPending?: { columnId: string } }, from: string, to: string): void {
  if (task.columnId === from) task.columnId = to;
  if (task.pendingTransition !== undefined) {
    if (task.pendingTransition.fromColumnId === from) task.pendingTransition.fromColumnId = to;
    if (task.pendingTransition.columnId === from) task.pendingTransition.columnId = to;
  }
  if (task.recordedTransition !== undefined) {
    if (task.recordedTransition.fromColumnId === from) task.recordedTransition.fromColumnId = to;
    if (task.recordedTransition.columnId === from) task.recordedTransition.columnId = to;
  }
  if (task.instructionPending !== undefined && task.instructionPending.columnId === from) task.instructionPending.columnId = to;
}

function lastSequence(log: BoardLogFile): number {
  return log.events.length === 0 ? log.snapshot.seq : log.events[log.events.length - 1]!.seq;
}

/**
 * Compose the manifest this installation would publish: the published order kept,
 * every held board's current name and scope applied, the boards that entered the
 * team appended, and the removals dropped.
 */
export function composeManifest(input: {
  readonly current: SharedHubManifest;
  readonly local: readonly LocalSharedBoard[];
  readonly pendingRemovals: readonly string[];
  readonly reserved: Iterable<string>;
  readonly allocate: (name: string, taken: Set<string>) => string;
}): { manifest: SharedHubManifest; bindings: Record<string, string> } {
  const pending = new Set(input.pendingRemovals);
  const bindings: Record<string, string> = {};
  for (const board of input.local) if (board.key !== undefined) bindings[board.boardId] = board.key;
  const held = new Map(input.local.filter(board => board.key !== undefined).map(board => [board.key!, board]));
  const taken = new Set<string>([...input.reserved, ...input.current.boards.map(entry => entry.key)]);
  const entries: SharedBoardEntry[] = [];
  for (const entry of input.current.boards) {
    if (pending.has(entry.key)) continue;
    const board = held.get(entry.key);
    if (board === undefined) { entries.push({ ...entry }); continue; }
    entries.push(manifestEntry(entry.key, board));
    held.delete(entry.key);
  }
  for (const board of input.local) {
    if (board.key !== undefined || held.has(board.key ?? '')) continue;
    if ([...held.values()].includes(board)) continue;
    if (entries.some(entry => normalizeBoardName(entry.name) === normalizeBoardName(board.name))) continue;
    const key = input.allocate(board.name, taken);
    taken.add(key);
    bindings[board.boardId] = key;
    entries.push(manifestEntry(key, board));
  }
  return { manifest: { version: 3, boards: entries }, bindings };
}

function manifestEntry(key: string, board: LocalSharedBoard): SharedBoardEntry {
  return { key, name: board.name, ...(board.projectKeys === undefined ? {} : { projectKeys: [...board.projectKeys] }) };
}
