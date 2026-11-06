import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { KanbanError, invariant } from '../../shared/errors.js';
import type { HubSharingView, Problem, SharingAuthView, SharingCommand } from '../../shared/types.js';
import { applySharingPlan, type ApplySharingResult } from '../../domain/sharing/apply.js';
import { sharedDocumentToken, type SharedBoardEntry, type SharedHubDocument } from '../../domain/sharing/document.js';
import { normalizeBoardName } from '../../domain/sharing/identity.js';
import { buildPublishDocument, buildUpdatePlan, publishIsDirty, type SharingBlocker, type SharingPlan } from '../../domain/sharing/plan.js';
import { projectSharingBoards } from '../../domain/sharing/projection.js';
import type { HubRepository } from '../hub-repository.js';
import type { GoogleDriveAuthService } from './google-drive-auth.js';
import type { ProviderState, SharingBinding, SharingProviderId, SharingProviderResolver } from './provider.js';
import type { SharedConfigStore } from './store.js';
import type { HubSharingRecord, HubSharingStore } from './state.js';
import { buildSharingView, publishedDocument, sharingComparison } from './view.js';

export const DEFAULT_SHARING_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;
const EMPTY_DOCUMENT: SharedHubDocument = { version: 1, boards: [] };
const COMMIT_MESSAGE = 'Update published Kanban configuration';

export interface HubSharingOptions {
  hubs: HubRepository;
  store: HubSharingStore;
  providers: SharingProviderResolver;
  auth?: GoogleDriveAuthService;
  now?: () => string;
  id?: () => string;
  notify?: () => void;
  report?: (error: unknown) => void;
  /** Local changes wait this long before an automatic Drive synchronization. */
  debounceMs?: number;
}

export function normalizeSharingInterval(value: number | undefined, fallback = DEFAULT_SHARING_INTERVAL_MINUTES): number {
  const minutes = value ?? fallback;
  invariant(Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_INTERVAL_MINUTES, 'INVALID_INPUT', 'The check interval must be a whole number of minutes between 0 and ' + MAX_INTERVAL_MINUTES + '.');
  invariant(minutes === 0 || minutes >= 1, 'INVALID_INPUT', 'The check interval is either 0 (manual checks) or at least one minute.');
  return minutes;
}

function withEntry(base: SharedHubDocument, entry: SharedBoardEntry): SharedHubDocument {
  const boards = base.boards.map(value => value.key === entry.key ? { ...entry } : value);
  if (!boards.some(value => value.key === entry.key)) boards.push({ ...entry });
  return { version: 1, boards };
}

function stored(document: SharedHubDocument): { token: string; document: SharedHubDocument } {
  return { token: sharedDocumentToken(document), document };
}

/**
 * Owns the publishing lifecycle for every Hub. All operations for one Hub run
 * in a single serialized lane; a public operation invoked from inside a lane
 * operation is rejected rather than deadlocking.
 */
export class HubSharingService {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly inflight = new Set<string>();
  private readonly active = new AsyncLocalStorage<true>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lanes = new Map<string, number>();
  private connectTail: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly debounceMs: number;
  private authState: SharingAuthView = { status: 'not-connected' };
  private disposed = false;

  constructor(private readonly options: HubSharingOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
    this.debounceMs = options.debounceMs ?? 2_000;
  }

  authView(): SharingAuthView {
    return { ...this.authState };
  }

  async refreshAuth(): Promise<void> {
    if (!this.options.auth) { this.authState = { status: 'not-connected' }; return; }
    try { this.authState = await this.options.auth.status(); }
    catch (error) { this.authState = { status: 'error', error: this.problemOf(error) }; }
  }

  private get auth(): GoogleDriveAuthService {
    const auth = this.options.auth;
    invariant(auth, 'SHARING_UNAVAILABLE', 'Google Drive authorization is unavailable in this host.');
    return auth;
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

  private viewOf(record: HubSharingRecord, hub: Parameters<typeof buildSharingView>[1]): HubSharingView {
    const provider = this.options.providers.describe(record.binding);
    return buildSharingView(record, hub, {
      provider,
      ...(provider.id === 'google-drive' ? { authorization: this.authState.status } : {}),
      syncing: this.inflight.has(record.hubId),
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

  busy(hubId: string): boolean { return this.inflight.has(hubId); }

  command(command: SharingCommand): Promise<void> {
    if (command.type === 'sharing.auth.start') return this.authCommand('start');
    if (command.type === 'sharing.auth.cancel') return this.authCommand('cancel');
    if (command.type === 'sharing.auth.disconnect') return this.authCommand('disconnect');
    if (command.type === 'sharing.auth.switch') return this.authCommand('switch');
    if (command.type === 'sharing.drives') return this.authCommand('drives');
    if (command.type === 'sharing.folders') return this.authCommand('folders', command);
    if (command.type === 'sharing.setInterval') return this.setInterval(command.hubId, command.intervalMinutes);
    if (command.type === 'sharing.resolve') return this.resolve(command.hubId, command.boardId, command.choice);
    if (command.type === 'sharing.restore') return this.restore(command.hubId, command.boardId);
    if (command.type === 'sharing.publishOrphan') return this.publishOrphan(command.hubId, command.boardId);
    if (command.type === 'sharing.disconnect') return this.disconnect(command.hubId);
    if (command.type === 'sharing.publishInitial') return this.publishInitial(command.hubId, command.confirmed);
    if (command.type === 'sharing.connect') return this.connect(command);
    if (command.type === 'sharing.receive') return this.receive(command.hubId);
    if (command.type === 'sharing.check') return this.check(command.hubId, true);
    if (command.type === 'sharing.getUpdates') return this.getUpdates(command.hubId);
    return this.publish(command.hubId);
  }

  private authCommand(action: 'start' | 'cancel' | 'disconnect' | 'switch' | 'drives' | 'folders', command?: Extract<SharingCommand, { type: 'sharing.folders' }>): Promise<void> {
    return this.run('__auth__', async () => {
      const auth = this.auth;
      if (action === 'start') await auth.start();
      else if (action === 'cancel') await auth.cancel();
      else if (action === 'disconnect') await auth.disconnect();
      else if (action === 'switch') { await auth.disconnect(); await auth.start(); }
      else if (action === 'drives') await auth.listDrives();
      else if (action === 'folders') await auth.listFolders({ ...(command?.driveId === undefined ? {} : { driveId: command.driveId }), ...(command?.parentId === undefined ? {} : { parentId: command.parentId }) });
      await this.refreshAuth();
      this.options.notify?.();
    });
  }

  connect(command: Extract<SharingCommand, { type: 'sharing.connect' }>): Promise<void> {
    const operation = this.connectTail.then(() => this.run(command.hubId, async () => this.connectNow(command)));
    this.connectTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private connectNow(command: Extract<SharingCommand, { type: 'sharing.connect' }>): Promise<void> {
    return (async () => {
      invariant(this.options.store.load(command.hubId) === undefined, 'SHARING_ALREADY_CONNECTED', 'This Hub is already connected to a team storage.');
      const hub = this.options.hubs.requireHub(command.hubId);
      const providerId: SharingProviderId = command.provider ?? (command.repository ? 'git' : 'google-drive');
      const rawSettings = command.settings ?? (command.repository ? { repository: command.repository } : {});
      const binding: SharingBinding = {
        provider: providerId,
        intervalMinutes: normalizeSharingInterval(command.intervalMinutes, this.options.providers.defaultInterval(providerId)),
        settings: this.options.providers.normalize(providerId, rawSettings),
      };
      if (providerId === 'google-drive') {
        await this.refreshAuth();
        invariant(this.authState.status === 'connected', 'SHARING_RECONNECT_REQUIRED', 'Connect the Google account before choosing a folder.');
        const folderId = binding.settings.folderId;
        const occupied = this.options.store.list().find(record => record.hubId !== command.hubId && record.binding.provider === 'google-drive' && record.binding.settings.folderId === folderId);
        invariant(!occupied, 'SHARING_ADDRESS_IN_USE', 'The selected Google Drive folder is already bound to another Hub.');
      }
      const provider = this.storeFor(command.hubId, binding, {});
      await provider.ensure();
      const remote = await provider.read();
      const providerState = provider.state?.() ?? {};
      const at = this.now();
      if (remote === null) {
        const publish = buildPublishDocument({ base: null, local: projectSharingBoards(hub, {}), bindings: {}, orphans: {}, pendingRemovals: [] });
        const written = await provider.write(publish.document, { expectedToken: null, message: COMMIT_MESSAGE });
        await this.save({
          version: 2, hubId: command.hubId, binding, providerState: provider.state?.() ?? providerState, syncedRevision: hub.revision,
          base: stored({ ...publish.document, boards: publish.document.boards.map(entry => ({ ...entry })) }),
          seen: stored({ ...publish.document, boards: publish.document.boards.map(entry => ({ ...entry })) }),
          bindings: publish.bindings, orphans: {}, removed: {}, pendingRemovals: [], preview: null,
          lastCheck: { at, token: written.token }, lastSyncedAt: at, lastError: null,
        });
        return;
      }
      await this.save({
        version: 2, hubId: command.hubId, binding, providerState, syncedRevision: null,
        base: null, seen: { token: remote.token, document: remote.document }, bindings: {}, orphans: {}, removed: {}, pendingRemovals: [],
        preview: { token: remote.token, document: remote.document }, lastCheck: { at, token: remote.token }, lastError: null,
      });
    })();
  }

  receive(hubId: string): Promise<void> {
    return this.run(hubId, async () => this.receiveNow(hubId));
  }

  publishInitial(hubId: string, confirmed: boolean): Promise<void> {
    return this.run(hubId, async () => {
      invariant(confirmed, 'CONFIRMATION_REQUIRED', 'Confirm replacing the team configuration with this Hub.');
      const record = this.requireRecord(hubId);
      const preview = record.preview;
      invariant(preview, 'SHARING_NO_PREVIEW', 'This Hub has no pending connection preview.');
      const hub = this.options.hubs.requireHub(hubId);
      const publish = buildPublishDocument({
        base: null,
        local: projectSharingBoards(hub, record.bindings),
        bindings: record.bindings,
        orphans: record.orphans,
        pendingRemovals: record.pendingRemovals,
      });
      const provider = this.storeFor(hubId, record.binding, record.providerState);
      const written = await provider.write(publish.document, { expectedToken: preview.token, message: COMMIT_MESSAGE });
      await this.save({
        ...record,
        providerState: provider.state?.() ?? record.providerState,
        base: { token: written.token, document: publish.document },
        seen: { token: written.token, document: publish.document },
        bindings: publish.bindings,
        preview: null,
        pendingRemovals: [],
        syncedRevision: hub.revision,
        lastCheck: { at: this.now(), token: written.token },
        lastSyncedAt: this.now(),
        reviewRequired: null,
        lastError: null,
      });
    });
  }

  check(hubId: string, manual = false): Promise<void> {
    return this.run(hubId, async () => this.checkNow(hubId, manual));
  }

  private async checkNow(hubId: string, manual: boolean): Promise<void> {
    const record = this.requireRecord(hubId);
    const provider = this.storeFor(hubId, record.binding, record.providerState);
    let remote;
    try { remote = await provider.read(undefined, record.seen); }
    catch (error) {
      await this.persistFailure(record, error);
      throw error;
    }
    if (remote === null && record.seen !== null) {
      const failure = new KanbanError('SHARING_DOCUMENT_MISSING', 'The team configuration document is missing from the team storage. It was not removed by this installation.', { address: this.options.providers.describe(record.binding).address });
      await this.save({ ...record, providerState: provider.state?.() ?? record.providerState, lastError: { code: failure.code, message: failure.message } });
      throw failure;
    }
    const at = this.now();
    const published = remote ?? { token: sharedDocumentToken(EMPTY_DOCUMENT), document: EMPTY_DOCUMENT };
    const reviewLatch = !manual && (record.reviewRequired != null);
    const fresh: HubSharingRecord = {
      ...record,
      providerState: provider.state?.() ?? record.providerState,
      seen: remote,
      preview: record.preview === null ? null : remote,
      lastCheck: { at, token: published.token },
      reviewRequired: manual ? null : record.reviewRequired ?? null,
      lastError: manual ? null : reviewLatch ? record.lastError ?? record.reviewRequired ?? null : null,
    };
    await this.save(fresh);
    if (!reviewLatch && fresh.preview === null && this.options.providers.describe(record.binding).syncMode === 'continuous') await this.autoSyncNow(hubId);
  }

  getUpdates(hubId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const provider = this.storeFor(hubId, record.binding, record.providerState);
      let remote;
      try { remote = await provider.read(undefined, record.seen); }
      catch (error) {
        await this.persistFailure(record, error);
        throw error;
      }
      if (remote === null && record.seen !== null) {
        const failure = new KanbanError('SHARING_DOCUMENT_MISSING', 'The team configuration document is missing from the team storage. It was not removed by this installation.', { address: this.options.providers.describe(record.binding).address });
        await this.save({ ...record, providerState: provider.state?.() ?? record.providerState, lastError: { code: failure.code, message: failure.message } });
        throw failure;
      }
      const published = remote ?? { token: sharedDocumentToken(EMPTY_DOCUMENT), document: EMPTY_DOCUMENT };
      const fresh: HubSharingRecord = { ...record, providerState: provider.state?.() ?? record.providerState, seen: remote, lastCheck: { at: this.now(), token: published.token }, reviewRequired: null, lastError: null };
      await this.save(fresh);
      await this.applyUpdatesNow(fresh);
    });
  }

  /** Debounce a local board or workflow save into an automatic synchronization. */
  noteLocalChange(hubId: string): void {
    const record = this.options.store.load(hubId);
    if (!record || this.options.providers.describe(record.binding).syncMode !== 'continuous' || this.disposed) return;
    const existing = this.timers.get(hubId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(hubId);
      void this.check(hubId).catch(error => this.options.report?.(error));
    }, this.debounceMs);
    timer.unref?.();
    this.timers.set(hubId, timer);
  }

  private async autoSyncNow(hubId: string): Promise<void> {
    let record = this.requireRecord(hubId);
    if (record.preview !== null) return;
    if (record.reviewRequired != null) return;
    if (this.options.providers.describe(record.binding).syncMode !== 'continuous') return;
    let hub = this.options.hubs.requireHub(hubId);
    let comparison = sharingComparison(record, hub);
    if (comparison.blockers.length > 0 || comparison.conflicts > 0) return;
    if (comparison.updates > 0) {
      await this.applyUpdatesNow(record);
      record = this.requireRecord(hubId);
      hub = this.options.hubs.requireHub(hubId);
      comparison = sharingComparison(record, hub);
    }
    if (comparison.drafts === 0 && record.pendingRemovals.length === 0) return;
    if (comparison.updates > 0 || comparison.conflicts > 0 || comparison.blockers.length > 0) return;
    await this.publishNow(hubId);
  }

  resolve(hubId: string, boardId: string, choice: 'local' | 'team'): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const hub = this.options.hubs.requireHub(hubId);
      const comparison = sharingComparison(record, hub);
      const conflict = comparison.boards.find(board => board.decision === 'needs-review' && board.boardId === boardId);
      invariant(conflict, 'SHARING_NOT_CONFLICT', 'The board does not have a team conflict to resolve.');
      invariant(conflict.key !== undefined, 'SHARING_NOT_CONFLICT', 'The conflicting board has no published key.');
      const entry = publishedDocument(record).boards.find(candidate => candidate.key === conflict.key);
      invariant(entry, 'SHARING_NOT_CONFLICT', 'The team board for this conflict is no longer available.');
      if (choice === 'team') {
        const plan: SharingPlan = {
          comparison,
          apply: [{ boardId, key: entry.key, name: entry.name, workflow: entry.workflow }],
          removals: [], orphans: [], reconnections: [], conflicts: [],
          nextBase: withEntry(record.base?.document ?? publishedDocument(record), entry),
        };
        await this.options.hubs.hub(hubId).transact(draft => applySharingPlan(draft, plan, { id: this.id, now: this.now }), hub.revision);
      }
      const base = withEntry(record.base?.document ?? publishedDocument(record), entry);
      await this.save({ ...record, base: stored(base), reviewRequired: null });
    });
  }

  publish(hubId: string): Promise<void> {
    return this.run(hubId, async () => { await this.publishNow(hubId); });
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

  /** Called after the Hub is deleted; removes local publishing state and the managed workspace. */
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
      const next: HubSharingRecord = { ...record, bindings, orphans };
      if (scope === 'local') next.removed = { ...record.removed, [key]: { boardId, name } };
      else if (!record.pendingRemovals.includes(key)) next.pendingRemovals = [...record.pendingRemovals, key];
      await this.save(next);
      if (scope === 'team') this.noteLocalChange(hubId);
    });
  }

  restore(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const removed = Object.entries(record.removed).find(([, value]) => value.boardId === boardId);
      invariant(removed, 'SHARING_NOT_REMOVED', 'The board is not removed only from this installation.');
      const [key] = removed;
      const hub = this.options.hubs.requireHub(hubId);
      const entry = publishedDocument(record).boards.find(candidate => candidate.key === key);
      if (!entry) {
        const next = { ...record, removed: { ...record.removed } };
        delete next.removed[key];
        await this.save(next);
        throw new KanbanError('SHARING_REMOVED_GONE', 'The team board no longer exists, so it cannot be restored.');
      }
      invariant(!hub.boards.some(board => normalizeBoardName(board.name) === normalizeBoardName(entry.name)), 'SHARING_NAME_CONFLICT', 'A local board already uses the name "' + entry.name + '".');
      const comparison = sharingComparison(record, hub);
      const plan: SharingPlan = {
        comparison,
        apply: [{ key: entry.key, name: entry.name, workflow: entry.workflow }],
        removals: [], orphans: [], reconnections: [], conflicts: [],
        nextBase: withEntry(record.base?.document ?? publishedDocument(record), entry),
      };
      const result: ApplySharingResult = await this.options.hubs.hub(hubId).transact(draft => applySharingPlan(draft, plan, { id: this.id, now: this.now }), hub.revision);
      const created = result.created[0];
      invariant(created, 'SHARING_RESTORE_FAILED', 'The restored board could not be created.');
      const removedList = { ...record.removed };
      delete removedList[key];
      await this.save({
        ...record,
        base: stored(plan.nextBase),
        bindings: { ...record.bindings, [created.boardId]: key },
        removed: removedList,
      });
    });
  }

  publishOrphan(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const orphan = record.orphans[boardId];
      invariant(orphan !== undefined, 'SHARING_NOT_ORPHAN', 'The board is not an orphan.');
      const hub = this.options.hubs.requireHub(hubId);
      const comparison = sharingComparison(record, hub);
      if (comparison.updates > 0 || comparison.conflicts > 0) {
        throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'Get the team updates before publishing this board.');
      }
      const orphans = { ...record.orphans };
      delete orphans[boardId];
      await this.save({ ...record, orphans });
      try { await this.publishNow(hubId, [orphan.lastKey]); }
      catch (error) {
        const current = this.options.store.load(hubId);
        if (current) await this.save({ ...current, orphans: { ...current.orphans, [boardId]: orphan } }).catch(() => undefined);
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    try { await this.options.auth?.cancel(); } catch { /* authorization is best effort on shutdown */ }
    await Promise.allSettled([...this.tails.values()]);
    this.tails.clear();
  }

  private storeFor(hubId: string, binding: SharingBinding, state: ProviderState): SharedConfigStore {
    return this.options.providers.create(hubId, binding, state);
  }

  private requireRecord(hubId: string): HubSharingRecord {
    const record = this.options.store.load(hubId);
    invariant(record, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team storage.');
    return record;
  }

  private async save(record: HubSharingRecord): Promise<void> {
    await this.options.store.save(record);
    this.options.notify?.();
  }

  private async receiveNow(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    const preview = record.preview;
    invariant(preview, 'SHARING_NO_PREVIEW', 'This Hub has no pending connection preview.');
    await this.applyUpdatesNow({ ...record, seen: preview, preview: null });
  }

  /** Apply the non-conflicting team changes in one Hub transaction, then record the merged base. */
  private async applyUpdatesNow(record: HubSharingRecord): Promise<void> {
    const hub = this.options.hubs.requireHub(record.hubId);
    const plan = buildUpdatePlan({
      base: record.base?.document ?? null,
      published: publishedDocument(record),
      local: projectSharingBoards(hub, record.bindings),
      bindings: record.bindings,
      orphans: record.orphans,
      removed: record.removed,
      pendingRemovals: record.pendingRemovals,
    });
    if (plan.comparison.blockers.length > 0) throw this.refused(plan.comparison.blockers);
    let result: ApplySharingResult = { created: [] };
    if (plan.apply.length > 0 || plan.removals.length > 0 || plan.order !== undefined) {
      result = await this.options.hubs.hub(record.hubId).transact(draft => applySharingPlan(draft, plan, { id: this.id, now: this.now }), hub.revision);
    }
    const bindings = { ...record.bindings };
    for (const entry of plan.apply) if (entry.boardId !== undefined) bindings[entry.boardId] = entry.key;
    for (const created of result.created) bindings[created.boardId] = created.key;
    const orphans = { ...record.orphans };
    for (const orphan of plan.orphans) { delete bindings[orphan.boardId]; orphans[orphan.boardId] = { lastKey: orphan.lastKey, lastPublishedName: orphan.lastPublishedName }; }
    for (const reconnection of plan.reconnections) delete orphans[reconnection.boardId];
    for (const removal of plan.removals) delete bindings[removal];
    await this.save({
      ...record,
      bindings,
      orphans,
      base: stored(plan.nextBase),
      preview: null,
      lastSyncedAt: this.now(),
      reviewRequired: null,
      lastError: null,
    });
  }

  private async publishNow(hubId: string, reserved: Iterable<string> = []): Promise<void> {
    const record = this.requireRecord(hubId);
    const hub = this.options.hubs.requireHub(hubId);
    const comparison = sharingComparison(record, hub);
    if (comparison.blockers.length > 0) throw this.refused(comparison.blockers);
    if (comparison.updates > 0 || comparison.conflicts > 0) throw new KanbanError('SHARING_PUBLISH_BLOCKED', 'Get the team updates and resolve every review before publishing.');
    const publish = buildPublishDocument({
      base: record.base?.document ?? null,
      local: projectSharingBoards(hub, record.bindings),
      bindings: record.bindings,
      orphans: record.orphans,
      pendingRemovals: record.pendingRemovals,
      reserved,
    });
    if (!publishIsDirty(publish.document, record.base?.document ?? null) && record.pendingRemovals.length === 0) return;
    const provider = this.storeFor(hubId, record.binding, record.providerState);
    try {
      const written = await provider.write(publish.document, { expectedToken: record.seen?.token ?? null, message: COMMIT_MESSAGE });
      await this.save({
        ...record,
        providerState: provider.state?.() ?? record.providerState,
        base: { token: written.token, document: publish.document },
        seen: { token: written.token, document: publish.document },
        bindings: publish.bindings,
        pendingRemovals: [],
        syncedRevision: hub.revision,
        lastCheck: { at: this.now(), token: written.token },
        lastSyncedAt: this.now(),
        reviewRequired: null,
        lastError: null,
      });
    } catch (error) {
      if (error instanceof KanbanError && error.code === 'SHARING_STALE_TOKEN') {
        let remote: Awaited<ReturnType<SharedConfigStore['read']>> | undefined;
        try { remote = await provider.read(undefined, record.seen); }
        catch { remote = undefined; }
        if (remote !== undefined && remote !== null) {
          await this.save({ ...record, providerState: provider.state?.() ?? record.providerState, seen: remote, lastCheck: { at: this.now(), token: remote.token }, lastError: null });
        }
      } else {
        await this.persistFailure(record, error);
      }
      throw error;
    }
  }

  /** Any read or write failure is an availability/integrity fact the interface must show. */
  private async persistFailure(record: HubSharingRecord, error: unknown): Promise<void> {
    const code = error instanceof KanbanError ? error.code : 'SHARING_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    await this.save({ ...record, lastError: { code, message }, ...(code === 'SHARING_CONCURRENT_WRITE' ? { reviewRequired: { code, message } } : {}) });
  }

  private async removeBinding(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    try { await this.storeFor(hubId, record.binding, record.providerState).destroy(); }
    catch (error) { this.options.report?.(error); }
    await this.options.store.delete(hubId);
    this.options.notify?.();
  }

  private refused(blockers: SharingBlocker[]): KanbanError {
    return new KanbanError('SHARING_REFUSED', 'The team configuration cannot be applied until these boards are resolved.', { blockers });
  }

  private problemOf(error: unknown): Problem {
    return { code: error instanceof KanbanError ? error.code : 'SHARING_FAILED', message: error instanceof Error ? error.message : String(error) };
  }

  private run<T>(hubId: string, operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The Kanban plugin is shutting down.');
    if (this.active.getStore()) throw new KanbanError('SHARING_REENTRANT', 'A publishing operation cannot start inside another publishing operation.');
    const active = (this.lanes.get(hubId) ?? 0) + 1;
    this.lanes.set(hubId, active);
    this.inflight.add(hubId);
    if (active === 1) this.options.notify?.();
    const prior = this.tails.get(hubId) ?? Promise.resolve();
    const execution = prior.then(() => this.active.run(true, operation));
    this.tails.set(hubId, execution.then(() => undefined, () => undefined));
    return execution.finally(() => {
      const remaining = (this.lanes.get(hubId) ?? 1) - 1;
      if (remaining <= 0) { this.lanes.delete(hubId); this.inflight.delete(hubId); this.options.notify?.(); }
      else this.lanes.set(hubId, remaining);
    });
  }
}
