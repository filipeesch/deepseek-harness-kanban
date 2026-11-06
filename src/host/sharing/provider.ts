import type { z } from 'zod';
import { KanbanError } from '../../shared/errors.js';
import type { SharedConfigStore } from './store.js';

/** Storage identifiers supported by the sharing boundary. */
export type SharingProviderId = 'git' | 'google-drive';
/** The local transport binding; publishing content never lives in this record. */
export interface SharingBinding {
  provider: SharingProviderId;
  intervalMinutes: number;
  settings: Record<string, string>;
}
/** Opaque per-provider synchronization state persisted beside the binding. */
export type ProviderState = Record<string, unknown>;
export type SharingSyncMode = 'explicit' | 'continuous';

export interface ProviderDescription {
  id: SharingProviderId;
  label: string;
  address: string;
  syncMode: SharingSyncMode;
  defaultIntervalMinutes: number;
}

/**
 * One storage adapter plus its configuration rules. A descriptor is the only
 * place that knows how a storage is addressed, validated, and synchronized.
 */
export interface SharingProviderDescriptor {
  id: SharingProviderId;
  label: string;
  syncMode: SharingSyncMode;
  defaultIntervalMinutes: number;
  /** Validate and normalize the stored string settings for this provider. */
  normalizeSettings(settings: Record<string, string>): Record<string, string>;
  describe(binding: SharingBinding): string;
  createStore(hubId: string, binding: SharingBinding, state: ProviderState): SharedConfigStore;
  /** Validate the persisted provider state; an unusable state falls back to empty. */
  normalizeState(state: ProviderState): ProviderState;
}

/** The service-facing resolver; tests can provide a small fake implementation. */
export interface SharingProviderResolver {
  create(hubId: string, binding: SharingBinding, state: ProviderState): SharedConfigStore;
  describe(binding: SharingBinding): ProviderDescription;
  normalize(provider: SharingProviderId, settings: Record<string, string>): Record<string, string>;
  defaultInterval(provider: SharingProviderId): number;
}

export class SharingProviderRegistry implements SharingProviderResolver {
  private readonly descriptors: Map<SharingProviderId, SharingProviderDescriptor>;

  constructor(descriptors: readonly SharingProviderDescriptor[]) {
    this.descriptors = new Map(descriptors.map(value => [value.id, value]));
    if (this.descriptors.size !== descriptors.length) throw new KanbanError('SHARING_PROVIDER_DUPLICATE', 'A sharing storage is registered twice.');
  }

  get(id: SharingProviderId): SharingProviderDescriptor {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The "' + String(id) + '" team storage is not supported.', { provider: id });
    return descriptor;
  }

  normalize(id: SharingProviderId, settings: Record<string, string>): Record<string, string> {
    return this.get(id).normalizeSettings(settings);
  }

  create(hubId: string, binding: SharingBinding, state: ProviderState): SharedConfigStore {
    const descriptor = this.get(binding.provider);
    return descriptor.createStore(hubId, binding, descriptor.normalizeState(state));
  }

  describe(binding: SharingBinding): ProviderDescription {
    const descriptor = this.get(binding.provider);
    return {
      id: descriptor.id,
      label: descriptor.label,
      address: descriptor.describe(binding),
      syncMode: descriptor.syncMode,
      defaultIntervalMinutes: descriptor.defaultIntervalMinutes,
    };
  }

  defaultInterval(id: SharingProviderId): number {
    return this.get(id).defaultIntervalMinutes;
  }
}

/** Narrow a stored provider id without trusting the record. */
export function isSharingProviderId(value: unknown): value is SharingProviderId {
  return value === 'git' || value === 'google-drive';
}

export type ProviderStateSchema = z.ZodType<ProviderState>;
