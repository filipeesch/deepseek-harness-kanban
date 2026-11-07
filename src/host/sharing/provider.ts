import { KanbanError } from '../../shared/errors.js';
import { SHARING_STORAGES, type SharingStorage } from '../../shared/types.js';
import type { SharedConfigStore } from './store.js';

/** Storage identifiers supported by the sharing boundary, derived from the shared list. */
export type SharingProviderId = SharingStorage;
/** The local transport binding; publishing content never lives in this record. */
export interface SharingBinding {
  provider: SharingProviderId;
  intervalMinutes: number;
  settings: Record<string, string>;
}
/** Opaque per-provider synchronization state persisted beside the binding. */
export type ProviderState = Record<string, unknown>;
export type SharingSyncMode = 'explicit' | 'continuous';

/** A binding as stored by any Hub, used to refuse an address another Hub already owns. */
export interface BindingCandidate {
  hubId: string;
  provider: SharingProviderId;
  settings: Record<string, string>;
}

export interface ProviderDescription {
  id: SharingProviderId;
  label: string;
  address: string;
  syncMode: SharingSyncMode;
  defaultIntervalMinutes: number;
  /** The storage needs an external authorization before a binding is accepted. */
  requiresAuthorization: boolean;
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
  /** The storage needs an external authorization before a binding is accepted. */
  requiresAuthorization: boolean;
  /** Validate and normalize the stored string settings for this provider. */
  normalizeSettings(settings: Record<string, string>): Record<string, string>;
  describe(binding: SharingBinding): string;
  createStore(hubId: string, binding: SharingBinding, state: ProviderState): SharedConfigStore;
  /** Validate the persisted provider state; an unusable state falls back to empty. */
  normalizeState(state: ProviderState): ProviderState;
  /**
   * Validate a candidate binding before it is stored and return the settings to
   * persist. A storage may resolve its address to a canonical form, refuse an
   * address another Hub already owns, or create the location it suggested.
   */
  prepareBinding?(candidate: BindingCandidate, existing: readonly BindingCandidate[]): Promise<Record<string, string>>;
}

/** The service-facing resolver; tests can provide a small fake implementation. */
export interface SharingProviderResolver {
  create(hubId: string, binding: SharingBinding, state: ProviderState): SharedConfigStore;
  describe(binding: SharingBinding): ProviderDescription;
  normalize(provider: SharingProviderId, settings: Record<string, string>): Record<string, string>;
  defaultInterval(provider: SharingProviderId): number;
  /** Apply the provider's own connection rules and return the binding to store. */
  prepare(hubId: string, binding: SharingBinding, existing: readonly BindingCandidate[]): Promise<SharingBinding>;
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
      requiresAuthorization: descriptor.requiresAuthorization,
    };
  }

  defaultInterval(id: SharingProviderId): number {
    return this.get(id).defaultIntervalMinutes;
  }

  async prepare(hubId: string, binding: SharingBinding, existing: readonly BindingCandidate[]): Promise<SharingBinding> {
    const descriptor = this.get(binding.provider);
    if (!descriptor.prepareBinding) return binding;
    return { ...binding, settings: await descriptor.prepareBinding({ hubId, provider: binding.provider, settings: binding.settings }, existing) };
  }
}

/** Narrow a stored provider id without trusting the record. */
export function isSharingProviderId(value: unknown): value is SharingProviderId {
  return typeof value === 'string' && (SHARING_STORAGES as readonly string[]).includes(value);
}
