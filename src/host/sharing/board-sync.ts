import type { HubSharingRecord, PreviewBoard } from './state.js';
import type { SharedLayoutStore } from './ports.js';
import type { Observation } from './sync/observer.js';
import { BoardObserver } from './sync/observer.js';
import { BoardApplier } from './sync/applier.js';
import { BoardRemoval, type RemovalScope } from './sync/removal.js';
import { BoardPublisher } from './sync/publisher.js';
import { ConnectionOperations } from './sync/connection.js';
import { SharingSession, type SharingSessionOptions } from './sync/session.js';
import { LayoutStampPolicy } from './sync/stamp.js';

/** Everything the synchronization layer may reach: the Hub, the storage, and the clock. */
export type BoardSyncOptions = SharingSessionOptions;

export type { RemovalScope };

/**
 * The syncing layer of one Hub: a thin facade over the session and the collaborators
 * that observe the published layout, apply the team's events, publish local changes,
 * remove boards, and drive a new storage connection. It owns the sequencing and the
 * public surface, and no board rule.
 */
export class BoardSync {
  private readonly session: SharingSession;
  private readonly observer: BoardObserver;
  private readonly applier: BoardApplier;
  private readonly publisher: BoardPublisher;
  private readonly removal: BoardRemoval;
  /** The connection-time operations, of which a lifecycle drives the port it declares. */
  readonly connection: ConnectionOperations;

  constructor(options: BoardSyncOptions) {
    this.session = new SharingSession(options);
    const stamp = new LayoutStampPolicy();
    this.observer = new BoardObserver(this.session, stamp);
    this.applier = new BoardApplier(this.session, this.observer);
    this.removal = new BoardRemoval(this.session, this.applier);
    this.publisher = new BoardPublisher(this.session, this.observer, this.removal, stamp);
    this.connection = new ConnectionOperations(this.session, this.applier, this.publisher, stamp);
  }

  // ---------------------------------------------------------------- observing

  observe(record: HubSharingRecord, layout: SharedLayoutStore): Promise<Observation> {
    return this.observer.observe(record, layout);
  }

  check(hubId: string, manual: boolean): Promise<void> { return this.observer.check(hubId, manual); }

  // ---------------------------------------------------------------- applying

  applyBoard(hubId: string, boardId: string): Promise<void> { return this.applier.applyBoard(hubId, boardId); }

  applyAll(hubId: string): Promise<void> { return this.applier.applyAll(hubId); }

  resolve(hubId: string, boardId: string, choice: 'local' | 'team'): Promise<void> { return this.applier.resolve(hubId, boardId, choice); }

  // ---------------------------------------------------------------- publishing

  publishBoard(hubId: string, boardId: string): Promise<void> { return this.publisher.publishBoard(hubId, boardId); }

  publishAll(hubId: string): Promise<void> { return this.publisher.publishAll(hubId); }

  // ---------------------------------------------------------------- removal and orphans

  recordRemoval(hubId: string, boardId: string, scope: RemovalScope, name: string): Promise<void> {
    return this.removal.recordRemoval(hubId, boardId, scope, name);
  }

  restore(hubId: string, boardId: string): Promise<void> { return this.removal.restore(hubId, boardId); }

  publishOrphan(hubId: string, boardId: string): Promise<void> { return this.connection.publishOrphan(hubId, boardId); }

  // ---------------------------------------------------------------- connection

  readPreview(record: HubSharingRecord, layout: SharedLayoutStore): Promise<PreviewBoard[]> {
    return this.connection.readPreview(record, layout);
  }

  receivePreview(record: HubSharingRecord): Promise<HubSharingRecord> { return this.connection.receivePreview(record); }

  publishInitial(record: HubSharingRecord): Promise<void> { return this.connection.publishInitial(record); }
}
