import { randomUUID } from 'node:crypto';
import { KanbanError, invariant } from '../../shared/errors.js';
import type { HubSharingView, HubState, SharingCommand } from '../../shared/types.js';
import type { HubRepository } from '../hub-repository.js';
import { isAuthorizationCommand, type SharingAuthorizationPort } from './auth-coordinator.js';
import type { ProviderState, SharingBinding, SharingProviderId, SharingProviderResolver } from './provider.js';
import type { SharedLayoutStore } from './ports.js';
import { LaneRegistry } from './lanes.js';
import type { HubSharingRecord, HubSharingStore } from './state.js';
import type { TeamFileStore, TeamFileStoreResolution } from './team-file-store.js';
import { buildSharingView, type SharingViewContext } from './view.js';
import { BoardSync, type RemovalScope } from './board-sync.js';
import type { BoardRevisionPort } from '../board-administration.js';
import { BindingLifecycle } from './binding.js';
import { DEFAULT_SHARING_INTERVAL_MINUTES, normalizeSharingInterval } from './interval.js';

export { DEFAULT_SHARING_INTERVAL_MINUTES, normalizeSharingInterval };

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
  /** Records every workflow write an applied or published team document produces. */
  revisions?: BoardRevisionPort;
}

/**
 * Owns the publishing lifecycle for every Hub.
 *
 * The published unit is the board: reading, applying, and publishing all happen per
 * board, and the layout stamp is the only Hub-level entry. Command routing and the
 * binding lifecycle live here; the per-board work is delegated.
 */
export class HubSharingService {
  private readonly lanes: LaneRegistry;
  private connectTail: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly sync: BoardSync;
  private readonly lifecycle: BindingLifecycle;
  private disposed = false;

  constructor(private readonly options: HubSharingOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
    this.lanes = new LaneRegistry({ onChange: () => this.options.notify?.() });
    const save = async (record: HubSharingRecord): Promise<void> => {
      await this.options.store.save(record);
      this.options.notify?.();
    };
    const layout = (hubId: string, binding: SharingBinding, state: ProviderState): SharedLayoutStore => this.layout(hubId, binding, state);
    this.sync = new BoardSync({
      hubs: this.options.hubs,
      store: this.options.store,
      providers: this.options.providers,
      layout,
      now: this.now,
      id: this.id,
      save,
      ...(this.options.report === undefined ? {} : { report: this.options.report }),
      ...(this.options.revisions === undefined ? {} : { revisions: this.options.revisions }),
    });
    this.lifecycle = new BindingLifecycle({
      hubs: this.options.hubs,
      store: this.options.store,
      providers: this.options.providers,
      boards: this.sync,
      layout,
      now: this.now,
      save,
      ...(this.options.report === undefined ? {} : { report: this.options.report }),
    });
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
    const context: SharingViewContext = {
      provider,
      ...(provider.requiresAuthorization ? { authorization: this.options.auth?.status() ?? 'not-connected' } : {}),
      syncing: this.lanes.busy(record.hubId),
    };
    return buildSharingView(record, hub, context);
  }

  publishedHubs(): Array<{ hubId: string; intervalMinutes: number }> {
    return this.options.store.list()
      .filter(record => record.preview === null && this.options.hubs.get(record.hubId) !== undefined)
      .map(record => ({ hubId: record.hubId, intervalMinutes: record.binding.intervalMinutes }));
  }

  /** The workflow this installation last applied for one board, when the Hub is connected to a team storage. */
  publishedWorkflow(hubId: string, boardId: string): string | undefined {
    const record = this.options.store.load(hubId);
    const key = record?.bindings[boardId];
    if (record === undefined || key === undefined) return undefined;
    return record.boards[key]?.workflow ?? undefined;
  }

  isBound(hubId: string, boardId: string): boolean {
    return this.options.store.load(hubId)?.bindings[boardId] !== undefined;
  }

  busy(hubId: string): boolean { return this.lanes.busy(hubId); }

  command(command: SharingCommand): Promise<void> {
    if (isAuthorizationCommand(command)) throw new KanbanError('SHARING_UNAVAILABLE', 'Authorization is handled outside the publishing service.');
    switch (command.type) {
      case 'sharing.setInterval': return this.setInterval(command.hubId, command.intervalMinutes);
      case 'sharing.resolve': return this.resolve(command.hubId, command.boardId, command.choice);
      case 'sharing.restore': return this.restore(command.hubId, command.boardId);
      case 'sharing.publishOrphan': return this.publishOrphan(command.hubId, command.boardId);
      case 'sharing.disconnect': return this.disconnect(command.hubId);
      case 'sharing.publishInitial': return this.publishInitial(command.hubId, command.confirmed);
      case 'sharing.connect': return this.connect(command);
      case 'sharing.changeLocation': return this.changeLocation(command);
      case 'sharing.receive': return this.receive(command.hubId);
      case 'sharing.check': return this.check(command.hubId, true);
      case 'sharing.getUpdates': return this.getUpdates(command.hubId);
      case 'sharing.updateBoard': return this.updateBoard(command.hubId, command.boardId);
      case 'sharing.publishBoard': return this.publishBoard(command.hubId, command.boardId);
      case 'sharing.publishAll': return this.publishAll(command.hubId);
      default: throw new KanbanError('SHARING_UNSUPPORTED_COMMAND', 'This publishing command is not supported.');
    }
  }

  connect(command: Extract<SharingCommand, { type: 'sharing.connect' }>): Promise<void> {
    return this.serializeLocation(() => this.run(command.hubId, async () => {
      await this.ensureAuthorization(command.provider ?? (command.repository ? 'git' : 'google-drive'));
      await this.lifecycle.openLocation(command, false);
    }));
  }

  private changeLocation(command: Extract<SharingCommand, { type: 'sharing.changeLocation' }>): Promise<void> {
    return this.serializeLocation(() => this.run(command.hubId, async () => {
      invariant(command.confirmed, 'CONFIRMATION_REQUIRED', 'Confirm changing the folder for this Hub.');
      const record = this.requireRecord(command.hubId);
      invariant(record.binding.provider === 'google-drive-local', 'SHARING_UNSUPPORTED_STORAGE', 'Only a Google Drive Local Hub can change its folder.');
      await this.ensureAuthorization('google-drive-local');
      await this.lifecycle.openLocation(command, true, record);
    }));
  }

  private async ensureAuthorization(provider: SharingProviderId): Promise<void> {
    const auth = this.options.auth;
    if (auth === undefined) return;
    if (!this.options.providers.describe({ provider, intervalMinutes: 0, settings: {} }).requiresAuthorization) return;
    await auth.ensureConnected();
  }

  private serializeLocation<T>(operation: () => Promise<T>): Promise<T> {
    const execution = this.connectTail.then(operation);
    this.connectTail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  receive(hubId: string): Promise<void> {
    return this.run(hubId, async () => { await this.lifecycle.receive(hubId); });
  }

  publishInitial(hubId: string, confirmed: boolean): Promise<void> {
    return this.run(hubId, async () => { await this.lifecycle.publishInitial(hubId, confirmed); });
  }

  check(hubId: string, manual = false): Promise<void> {
    return this.run(hubId, async () => { await this.sync.check(hubId, manual); });
  }

  getUpdates(hubId: string): Promise<void> {
    return this.run(hubId, async () => {
      await this.sync.check(hubId, false);
      await this.sync.applyAll(hubId);
    });
  }

  updateBoard(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => { await this.sync.applyBoard(hubId, boardId); });
  }

  publishBoard(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => { await this.sync.publishBoard(hubId, boardId); });
  }

  publishAll(hubId: string): Promise<void> {
    return this.run(hubId, async () => { await this.sync.publishAll(hubId); });
  }

  resolve(hubId: string, boardId: string, choice: 'local' | 'team'): Promise<void> {
    return this.run(hubId, async () => { await this.sync.resolve(hubId, boardId, choice); });
  }

  restore(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => { await this.sync.restore(hubId, boardId); });
  }

  publishOrphan(hubId: string, boardId: string): Promise<void> {
    return this.run(hubId, async () => { await this.sync.publishOrphan(hubId, boardId); });
  }

  setInterval(hubId: string, intervalMinutes: number): Promise<void> {
    return this.run(hubId, async () => {
      const record = this.requireRecord(hubId);
      const fallback = this.options.providers.describe(record.binding).defaultIntervalMinutes;
      await this.options.store.save({ ...record, binding: { ...record.binding, intervalMinutes: normalizeSharingInterval(intervalMinutes, fallback) } });
      this.options.notify?.();
    });
  }

  disconnect(hubId: string): Promise<void> {
    return this.run(hubId, async () => { await this.lifecycle.disconnect(hubId); this.options.notify?.(); });
  }

  removeHub(hubId: string): Promise<void> {
    if (this.options.store.load(hubId) === undefined) return Promise.resolve();
    return this.disconnect(hubId);
  }

  removeBoard(hubId: string, boardId: string, scope: RemovalScope, name: string): Promise<void> {
    return this.run(hubId, async () => { await this.sync.recordRemoval(hubId, boardId, scope, name); });
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

  private layout(hubId: string, binding: SharingBinding, state: ProviderState): SharedLayoutStore {
    const create = this.options.providers.createLayoutStore;
    if (create === undefined) throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'This host cannot read the published team configuration.', { provider: binding.provider });
    return this.options.providers.createLayoutStore(hubId, binding, state);
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

  private run<T>(hubId: string, operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The Kanban plugin is shutting down.');
    return this.lanes.run(hubId, operation);
  }
}
