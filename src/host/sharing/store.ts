import type { SharedHubDocument } from '../../domain/sharing/document.js';
import { KanbanError } from '../../shared/errors.js';
import type { SharingBinding } from './state.js';

export interface SharedDocumentSnapshot { token: string; document: SharedHubDocument }

/**
 * Transport boundary. A provider reads and writes one whole document with an
 * opaque version token; it never decides merges and never exposes its
 * revision-control mechanics to the caller.
 */
export interface SharedConfigStore {
  ensure(): Promise<void>;
  read(signal?: AbortSignal): Promise<SharedDocumentSnapshot | null>;
  write(document: SharedHubDocument, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }>;
  destroy(): Promise<void>;
}

export interface SharedConfigStoreFactory {
  create(hubId: string, binding: SharingBinding): SharedConfigStore;
}

/** The only provider in this version; anything else fails explicitly. */
export function assertSupportedProvider(binding: SharingBinding): void {
  if (binding.provider !== 'git') throw new KanbanError('SHARING_PROVIDER_UNSUPPORTED', 'The "' + String(binding.provider) + '" publishing provider is not supported.', { provider: binding.provider });
}
