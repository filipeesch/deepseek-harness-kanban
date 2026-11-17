import { KanbanError, invariant } from '../../../shared/errors.js';
import type { HubRepository } from '../../hub-repository.js';
import type { BoardRevisionPort } from '../../board-administration.js';
import type { ProviderState, SharingBinding, SharingProviderResolver } from '../provider.js';
import type { SharedLayoutStore } from '../ports.js';
import type { HubSharingRecord, HubSharingStore } from '../state.js';

/** Everything the synchronization layer may reach: the Hub, the storage, and the clock. */
export interface SharingSessionOptions {
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

/**
 * One Hub's publishing session: the single place that loads and stores its record,
 * resolves its layout, applies the guards every operation shares, and records the
 * revisions a team document produces. A collaborator never touches the store directly.
 */
export class SharingSession {
  constructor(readonly options: SharingSessionOptions) {}

  now(): string { return this.options.now(); }

  id(): string { return this.options.id(); }

  load(hubId: string): HubSharingRecord | undefined { return this.options.store.load(hubId); }

  requireRecord(hubId: string): HubSharingRecord {
    const record = this.options.store.load(hubId);
    invariant(record, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team storage.');
    return record;
  }

  async save(record: HubSharingRecord): Promise<void> { await this.options.save(record); }

  deps() { return this.options.hubs.operationDeps(); }

  layoutFor(record: HubSharingRecord): SharedLayoutStore {
    return this.options.layout(record.hubId, record.binding, record.providerState);
  }

  report(error: unknown): void { this.options.report?.(error); }

  /** No board operation runs while the storage or the layout version blocks the Hub. */
  assertReady(record: HubSharingRecord): void {
    const problem = record.storageReview !== null && record.storageReview !== undefined
      ? { code: record.storageReview.code, message: record.storageReview.message }
      : record.reviewRequired ?? null;
    if (problem !== null) throw new KanbanError(problem.code, problem.message);
  }

  /** Record one workflow write this layer applied from, or published to, team storage. */
  async noteRevision(hubId: string, boardId: string, previous: string | null, next: string, previousPresetMode: 'operator' | 'host' | undefined, nextPresetMode: 'operator' | 'host' | undefined): Promise<void> {
    const revisions = this.options.revisions;
    if (revisions === undefined) return;
    try { await revisions.record({ hubId, boardId, previous, next, previousPresetMode: previous === null ? undefined : previousPresetMode, nextPresetMode, actor: { kind: 'team', source: 'team storage' }, origin: 'team' }); }
    catch (error) { this.report(error); }
  }

  /** Persist the failure one operation raised, so the interface can present it. */
  async persistFailure(record: HubSharingRecord, error: unknown): Promise<void> {
    const code = error instanceof KanbanError ? error.code : 'SHARING_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    await this.save({ ...record, lastError: { code, message }, ...(code === 'SHARING_CONCURRENT_WRITE' ? { reviewRequired: { code, message } } : {}) });
  }

  async removeRevisions(boardId: string): Promise<void> {
    try { await this.options.revisions?.remove?.(boardId); }
    catch (error) { this.report(error); }
  }
}
