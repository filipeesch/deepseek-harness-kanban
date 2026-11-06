import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { KanbanError, invariant } from '../../shared/errors.js';
import type { HubSharingView, SharingCommand } from '../../shared/types.js';
import { applySharingPlan, type ApplySharingResult } from '../../domain/sharing/apply.js';
import { sharedDocumentToken, type SharedBoardEntry, type SharedHubDocument } from '../../domain/sharing/document.js';
import { normalizeBoardName } from '../../domain/sharing/identity.js';
import { buildPublishDocument, buildUpdatePlan, publishIsDirty, type SharingBlocker, type SharingPlan } from '../../domain/sharing/plan.js';
import { projectSharingBoards } from '../../domain/sharing/projection.js';
import type { HubRepository } from '../hub-repository.js';
import type { SharedConfigStore, SharedConfigStoreFactory } from './store.js';
import type { HubSharingRecord, HubSharingStore } from './state.js';
import { buildSharingView, publishedDocument, sharingComparison } from './view.js';

export const DEFAULT_SHARING_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;
const EMPTY_DOCUMENT: SharedHubDocument = { version: 1, boards: [] };
const COMMIT_MESSAGE = 'Update published Kanban configuration';

export interface HubSharingOptions {
  hubs: HubRepository;
  store: HubSharingStore;
  providers: SharedConfigStoreFactory;
  now?: () => string;
  id?: () => string;
  notify?: () => void;
  report?: (error: unknown) => void;
}

function connectivityError(error: unknown): boolean {
  return error instanceof KanbanError && (error.code === 'SHARING_UNREACHABLE' || error.code === 'SHARING_AUTH' || error.code === 'SHARING_FAILED');
}

function normalizeRepository(value: string): string {
  const repository = value.trim();
  invariant(repository.length > 0 && repository.length <= 2048 && !/[\0\r\n]/.test(repository), 'INVALID_INPUT', 'A repository address is required.');
  return repository;
}

export function normalizeSharingInterval(value: number | undefined): number {
  const minutes = value ?? DEFAULT_SHARING_INTERVAL_MINUTES;
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
  private readonly now: () => string;
  private readonly id: () => string;
  private disposed = false;

  constructor(private readonly options: HubSharingOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
  }

  views(): Record<string, HubSharingView> {
    const result: Record<string, HubSharingView> = {};
    for (const record of this.options.store.list()) {
      const hub = this.options.hubs.get(record.hubId);
      if (!hub) continue;
      result[record.hubId] = buildSharingView(record, hub);
    }
    return result;
  }

  view(hubId: string): HubSharingView | undefined {
    const record = this.options.store.load(hubId);
    const hub = this.options.hubs.get(hubId);
    return record && hub ? buildSharingView(record, hub) : undefined;
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
    if (command.type === 'sharing.setInterval') return this.setInterval(command.hubId, command.intervalMinutes);
    if (command.type === 'sharing.resolve') return this.resolve(command.hubId, command.boardId, command.choice);
    if (command.type === 'sharing.restore') return this.restore(command.hubId, command.boardId);
    if (command.type === 'sharing.publishOrphan') return this.publishOrphan(command.hubId, command.boardId);
    if (command.type === 'sharing.disconnect') return this.disconnect(command.hubId);
    if (command.type === 'sharing.publishInitial') return this.publishInitial(command.hubId, command.confirmed);
    if (command.type === 'sharing.connect') return this.connect(command);
    if (command.type === 'sharing.receive') return this.receive(command.hubId);
    if (command.type === 'sharing.check') return this.check(command.hubId);
    if (command.type === 'sharing.getUpdates') return this.getUpdates(command.hubId);
    return this.publish(command.hubId);
  }

  connect(command: Extract<SharingCommand, { type: 'sharing.connect' }>): Promise<void> {
    return this.run(command.hubId, async () => {
      invariant(this.options.store.load(command.hubId) === undefined, 'SHARING_ALREADY_CONNECTED', 'This Hub is already connected to a team repository.');
      const hub = this.options.hubs.requireHub(command.hubId);
      const binding = { provider: 'git' as const, repository: normalizeRepository(command.repository), intervalMinutes: normalizeSharingInterval(command.intervalMinutes) };
      const provider = this.providers(command.hubId, binding);
      await provider.ensure();
      const remote = await provider.read();
      const at = this.now();
      if (remote === null) {
        const publish = buildPublishDocument({ base: null, local: projectSharingBoards(hub, {}), bindings: {}, orphans: {}, pendingRemovals: [] });
        const written = await provider.write(publish.document, { expectedToken: null, message: COMMIT_MESSAGE });
        await this.save({
          version: 1, hubId: command.hubId, binding,
          base: stored({ ...publish.document, boards: publish.document.boards.map(entry => ({ ...entry })) }),
          seen: stored({ ...publish.document, boards: publish.document.boards.map(entry => ({ ...entry })) }),
          bindings: publish.bindings, orphans: {}, removed: {}, pendingRemovals: [], preview: null,
          lastCheck: { at, token: written.token }, lastError: null,
        });
        return;
      }
      await this.save({
        version: 1, hubId: command.hubId, binding,
        base: null, seen: { token: remote.token, document: remote.document }, bindings: {}, orphans: {}, removed: {}, pendingRemovals: [],
        preview: { token: remote.token, document: remote.document }, lastCheck: { at, token: remote.token }, lastError: null,
      });
    });
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
      const written = await this.providers(hubId, record.binding).write(publish.document, { expectedToken: preview.token, message: COMMIT_MESSAGE });
      await this.save({
        ...record,
        base: { token: written.token, document: publish.document },
        seen: { token: written.token, document: publish.document },
        bindings: publish.bindings,
        preview: null,
        pendingRemovals: [],
        lastCheck: { at: this.now(), token: written.token },
        lastError: null,
      });
    });
  }

  check(hubId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      let remote;
      try { remote = await this.providers(hubId, record.binding).read(); }
      catch (error) {
        await this.persistFailure(record, error);
        throw error;
      }
      if (remote === null && record.seen !== null) {
        const failure = new KanbanError('SHARING_DOCUMENT_MISSING', 'The team configuration document is missing from the repository. It was not removed by this installation.', { repository: record.binding.repository });
        await this.save({ ...record, lastError: { code: failure.code, message: failure.message } });
        throw failure;
      }
      const at = this.now();
      const published = remote ?? { token: sharedDocumentToken(EMPTY_DOCUMENT), document: EMPTY_DOCUMENT };
      await this.save({
        ...record,
        seen: remote,
        preview: record.preview === null ? null : remote,
        lastCheck: { at, token: published.token },
        lastError: null,
      });
    });
  }

  getUpdates(hubId: string): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      let remote;
      try { remote = await this.providers(hubId, record.binding).read(); }
      catch (error) {
        await this.persistFailure(record, error);
        throw error;
      }
      if (remote === null && record.seen !== null) {
        const failure = new KanbanError('SHARING_DOCUMENT_MISSING', 'The team configuration document is missing from the repository. It was not removed by this installation.', { repository: record.binding.repository });
        await this.save({ ...record, lastError: { code: failure.code, message: failure.message } });
        throw failure;
      }
      const published = remote ?? { token: sharedDocumentToken(EMPTY_DOCUMENT), document: EMPTY_DOCUMENT };
      const fresh: HubSharingRecord = { ...record, seen: remote, lastCheck: { at: this.now(), token: published.token }, lastError: null };
      await this.save(fresh);
      await this.applyUpdatesNow(fresh);
    });
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
        await this.options.hubs.hub(hubId).transact(draft => applySharingPlan(draft, plan, { id: this.id, now: this.now }));
      }
      const base = withEntry(record.base?.document ?? publishedDocument(record), entry);
      await this.save({ ...record, base: stored(base) });
    });
  }

  publish(hubId: string): Promise<void> {
    return this.run(hubId, async () => { await this.publishNow(hubId); });
  }

  setInterval(hubId: string, intervalMinutes: number): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      await this.save({ ...record, binding: { ...record.binding, intervalMinutes: normalizeSharingInterval(intervalMinutes) } });
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

  /**
   * Record a board deletion that already happened in the Hub aggregate. A
   * local-only removal keeps the team board out of later updates; a team-wide
   * removal is published with the next publish. An orphan has no binding left,
   * so deleting it only forgets its orphan anchor.
   */
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
      const result: ApplySharingResult = await this.options.hubs.hub(hubId).transact(draft => applySharingPlan(draft, plan, { id: this.id, now: this.now }));
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
        // A failed or blocked publish must leave the board as the orphan it was.
        const current = this.options.store.load(hubId);
        if (current) await this.save({ ...current, orphans: { ...current.orphans, [boardId]: orphan } }).catch(() => undefined);
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled([...this.tails.values()]);
    this.tails.clear();
  }

  private providers(hubId: string, binding: HubSharingRecord['binding']): SharedConfigStore {
    return this.options.providers.create(hubId, binding);
  }

  private requireRecord(hubId: string): HubSharingRecord {
    const record = this.options.store.load(hubId);
    invariant(record, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team repository.');
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
    const hub = this.options.hubs.requireHub(hubId);
    const plan = buildUpdatePlan({
      base: null,
      published: preview.document,
      local: projectSharingBoards(hub, record.bindings),
      bindings: record.bindings,
      orphans: record.orphans,
      removed: record.removed,
      pendingRemovals: record.pendingRemovals,
    });
    if (plan.comparison.blockers.length > 0) throw this.refused(plan.comparison.blockers);
    await this.applyUpdatesNow({ ...record, seen: preview, preview: null }, plan);
  }

  /** Apply the non-conflicting team changes in one Hub transaction, then record the merged base. */
  private async applyUpdatesNow(record: HubSharingRecord, supplied?: SharingPlan): Promise<void> {
    const hub = this.options.hubs.requireHub(record.hubId);
    const plan = supplied ?? buildUpdatePlan({
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
      result = await this.options.hubs.hub(record.hubId).transact(draft => applySharingPlan(draft, plan, { id: this.id, now: this.now }));
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
    const provider = this.providers(hubId, record.binding);
    try {
      const written = await provider.write(publish.document, { expectedToken: record.seen?.token ?? null, message: COMMIT_MESSAGE });
      await this.save({
        ...record,
        base: { token: written.token, document: publish.document },
        seen: { token: written.token, document: publish.document },
        bindings: publish.bindings,
        pendingRemovals: [],
        lastCheck: { at: this.now(), token: written.token },
        lastError: null,
      });
    } catch (error) {
      if (error instanceof KanbanError && error.code === 'SHARING_STALE_TOKEN') {
        // Refresh only when the provider still returns a usable document; a failed
        // refresh must never make the seen document look empty.
        let remote: Awaited<ReturnType<SharedConfigStore['read']>> | undefined;
        try { remote = await provider.read(); }
        catch { remote = undefined; }
        if (remote !== undefined && remote !== null) {
          await this.save({ ...record, seen: remote, lastCheck: { at: this.now(), token: remote.token }, lastError: null });
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
    await this.save({ ...record, lastError: { code, message } });
  }

  private async removeBinding(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    try { await this.providers(hubId, record.binding).destroy(); }
    catch (error) { this.options.report?.(error); }
    await this.options.store.delete(hubId);
    this.options.notify?.();
  }

  private refused(blockers: SharingBlocker[]): KanbanError {
    return new KanbanError('SHARING_REFUSED', 'The team configuration cannot be applied until these boards are resolved.', { blockers });
  }

  private run<T>(hubId: string, operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The Kanban plugin is shutting down.');
    if (this.active.getStore()) throw new KanbanError('SHARING_REENTRANT', 'A publishing operation cannot start inside another publishing operation.');
    this.inflight.add(hubId);
    const prior = this.tails.get(hubId) ?? Promise.resolve();
    const execution = prior.then(() => this.active.run(true, operation));
    this.tails.set(hubId, execution.then(() => undefined, () => undefined));
    return execution.finally(() => { this.inflight.delete(hubId); });
  }
}
