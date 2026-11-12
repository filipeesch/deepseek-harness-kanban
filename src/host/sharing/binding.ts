import { invariant } from '../../shared/errors.js';
import { SHARED_LAYOUT_VERSION } from '../../domain/sharing/layout.js';
import type { HubSharingRecord, HubSharingStore } from './state.js';
import { emptyRecord } from './state.js';
import type { SharingBinding, SharingProviderId, SharingProviderResolver } from './provider.js';
import type { SharedLayoutStore } from './ports.js';
import type { HubRepository } from '../hub-repository.js';
import type { BoardSync } from './board-sync.js';
import { normalizeSharingInterval } from './interval.js';

/** The commands that change where a Hub publishes, and the state those changes need. */
export interface BindingLifecycleOptions {
  readonly hubs: HubRepository;
  readonly store: HubSharingStore;
  readonly providers: SharingProviderResolver;
  readonly boards: BoardSync;
  readonly layout: (hubId: string, binding: SharingBinding, state: Record<string, unknown>) => SharedLayoutStore;
  readonly now: () => string;
  readonly save: (record: HubSharingRecord) => Promise<void>;
  readonly report?: (error: unknown) => void;
}

/** A typed reason the connection did not produce a published layout of this version. */
const OUTDATED_LAYOUT = 'The team storage holds a layout written by an older plugin version. It is left untouched, and this Hub is published in the current layout.';

export class BindingLifecycle {
  constructor(private readonly options: BindingLifecycleOptions) {}

  async openLocation(
    command: { hubId: string; settings?: Record<string, string>; repository?: string; provider?: SharingProviderId; intervalMinutes?: number },
    replace: boolean,
    existing?: HubSharingRecord,
  ): Promise<void> {
    if (!replace) invariant(this.options.store.load(command.hubId) === undefined, 'SHARING_ALREADY_CONNECTED', 'This Hub is already connected to a team storage.');
    else invariant(existing !== undefined, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team storage.');
    this.options.hubs.requireHub(command.hubId);
    const providerId: SharingProviderId = existing?.binding.provider ?? command.provider ?? (command.repository ? 'git' : 'google-drive');
    if (existing !== undefined) invariant(providerId === existing.binding.provider, 'SHARING_UNSUPPORTED_STORAGE', 'The team storage cannot change without disconnecting.');
    const rawSettings = command.settings ?? (command.repository ? { repository: command.repository } : {});
    const candidate: SharingBinding = {
      provider: providerId,
      intervalMinutes: normalizeSharingInterval(command.intervalMinutes, existing?.binding.intervalMinutes ?? this.options.providers.defaultInterval(providerId)),
      settings: this.options.providers.normalize(providerId, rawSettings),
    };
    const binding = await this.options.providers.prepare(command.hubId, candidate, this.candidates());
    const layout = this.options.layout(command.hubId, binding, {});
    const at = this.options.now();
    const stamp = await layout.readStamp();
    const record = emptyRecord(command.hubId, binding, at);
    if (stamp !== null && stamp.version > SHARED_LAYOUT_VERSION) {
      await this.options.save({ ...record, reviewRequired: versionProblem() });
      return;
    }
    const outdated = stamp !== null && stamp.version < SHARED_LAYOUT_VERSION;
    // Published boards are the logs that exist, so a storage without a stamp but with
    // logs already holds a published layout and must be offered the connection choice.
    const hasPublishedLogs = stamp === null ? (await layout.listLogs()).length > 0 : true;
    if (!outdated && !hasPublishedLogs) {
      await this.options.save({ ...record, lastSyncedAt: null });
      await this.options.boards.publishInitial(record);
      return;
    }
    if (outdated) {
      const notice = { code: 'SHARING_LAYOUT_OUTDATED', message: OUTDATED_LAYOUT };
      await this.options.save({ ...record, notice, lastSyncedAt: null });
      await this.options.boards.publishInitial({ ...record, notice });
      return;
    }
    const preview = await this.options.boards.readPreview(record, layout);
    await this.options.save({ ...record, preview: { boards: preview }, lastCheck: { at, token: String(stamp?.version ?? 'none') } });
  }

  async receive(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    const next = await this.options.boards.receivePreview(record);
    await this.options.save(next);
    // "Get the team boards" adopts the published content, not only the bindings, so the
    // local boards start from the version the team published.
    await this.options.boards.applyAll(hubId);
  }

  async publishInitial(hubId: string, confirmed: boolean): Promise<void> {
    invariant(confirmed, 'CONFIRMATION_REQUIRED', 'Confirm replacing the team configuration with this Hub.');
    const record = this.requireRecord(hubId);
    invariant(record.preview !== null, 'SHARING_NO_PREVIEW', 'This Hub has no pending connection preview.');
    await this.options.boards.publishInitial(record);
  }

  async disconnect(hubId: string): Promise<void> {
    const record = this.requireRecord(hubId);
    try { await this.options.layout(hubId, record.binding, record.providerState).destroy(); }
    catch (error) { this.options.report?.(error); }
    await this.options.store.delete(hubId);
  }


  candidates() {
    return this.options.store.list().map(record => ({ hubId: record.hubId, provider: record.binding.provider, settings: record.binding.settings }));
  }

  private requireRecord(hubId: string): HubSharingRecord {
    const record = this.options.store.load(hubId);
    invariant(record, 'SHARING_NOT_PUBLISHED', 'This Hub is not connected to a team storage.');
    return record;
  }
}

function versionProblem(): { code: string; message: string } {
  return { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'The team configuration was written by a newer plugin version. Update the plugin to read or publish it.' };
}
