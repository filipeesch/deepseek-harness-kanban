import type { SharedHubDocument } from '../../domain/sharing/document.js';
import type { ProviderState, SharingBinding } from './provider.js';

export interface SharedDocumentSnapshot { token: string; document: SharedHubDocument }

/**
 * Transport boundary. A provider reads and writes one whole document with an
 * opaque version token; it never decides merges and never exposes its
 * transport mechanics to the caller.
 */
export interface SharedConfigStore {
  ensure(): Promise<void>;
  read(signal?: AbortSignal, cached?: SharedDocumentSnapshot | null): Promise<SharedDocumentSnapshot | null>;
  write(document: SharedHubDocument, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }>;
  destroy(): Promise<void>;
  /** State the service must persist beside the binding, when the provider needs one. */
  state?(): ProviderState;
}

export interface SharedConfigStoreFactory {
  create(hubId: string, binding: SharingBinding, state?: ProviderState): SharedConfigStore;
}
