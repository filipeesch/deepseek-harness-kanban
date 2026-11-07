import os from 'node:os';
import path from 'node:path';
import { KanbanError, invariant } from '../../shared/errors.js';
import { DirectorySharedConfigStore, normalizeDirectoryState } from './directory-store.js';
import {
  abbreviateHome,
  absoluteFolderPath,
  assertOutsideManagedRoot,
  createSuggestedFolder,
  folderIdentity,
  inspectFolder,
  resolveManagedRoot,
  suggestedFolderPath,
  type FolderPathOptions,
} from './local-folder-path.js';
import type { BindingCandidate, ProviderState, SharingProviderDescriptor } from './provider.js';

/**
 * The shared directory store, exported under its storage-specific name for
 * callers that speak in terms of the local-folder storage.
 */
export { DirectorySharedConfigStore as LocalFolderSharedConfigStore } from './directory-store.js';
export type { DirectoryStoreOptions as LocalFolderStoreOptions } from './directory-store.js';

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }

export interface LocalFolderProviderOptions extends FolderPathOptions {
  /** A directory the plugin owns and never accepts as a team storage. */
  managedRoot?: string;
}

/** The local folder descriptor: continuous synchronization over one directory, no account. */
export function createLocalFolderProviderDescriptor(options: LocalFolderProviderOptions = {}): SharingProviderDescriptor {
  const pathOptions: FolderPathOptions = {
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  };
  return {
    id: 'local-folder',
    label: 'Local folder',
    syncMode: 'continuous',
    defaultIntervalMinutes: 1,
    requiresAuthorization: false,
    normalizeSettings(settings) {
      const value = (settings.path ?? settings.folder ?? settings.address ?? '').trim();
      if (value.length === 0) throw new KanbanError('INVALID_INPUT', 'A folder path is required.');
      if (value.length > 4096 || /[\0\r\n]/.test(value)) throw new KanbanError('INVALID_INPUT', 'The folder path is not valid.');
      return { path: value };
    },
    describe(binding) {
      const value = text(binding.settings.path);
      if (value === undefined) return '';
      return abbreviateHome(absoluteFolderPath(value, pathOptions), options.home ?? os.homedir());
    },
    async prepareBinding(candidate: BindingCandidate, existing: readonly BindingCandidate[]) {
      const received = absoluteFolderPath(candidate.settings.path ?? '', pathOptions);
      const suggested = suggestedFolderPath(candidate.hubId, pathOptions);
      // Only the location the plugin itself proposed may be created on connect.
      if (folderIdentity(received, options.platform) === folderIdentity(suggested, options.platform)) await createSuggestedFolder(candidate.hubId, pathOptions);
      const inspected = await inspectFolder(received, pathOptions);
      assertOutsideManagedRoot(inspected.path, await resolveManagedRoot(options.managedRoot));
      const identityOf = (value: string | undefined): string => folderIdentity(absoluteFolderPath(value ?? '', pathOptions), options.platform);
      // A folder belongs to at most one Hub, whichever filesystem-backed storage claims it.
      const occupied = existing.find(record => record.hubId !== candidate.hubId
        && (record.provider === 'local-folder' || record.provider === 'google-drive-local')
        && identityOf(record.settings.path) === inspected.identity);
      invariant(!occupied, 'SHARING_ADDRESS_IN_USE', 'The selected folder is already bound to another Hub.');
      return { path: inspected.path };
    },
    createStore(hubId, binding, state) {
      if (binding.provider !== 'local-folder') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not a local folder.', { provider: binding.provider });
      const directory = text(binding.settings.path);
      if (directory === undefined) throw new KanbanError('INVALID_INPUT', 'A folder path is required.');
      return new DirectorySharedConfigStore({ directory, state });
    },
    normalizeState,
  };
}

function normalizeState(state: ProviderState): ProviderState {
  return normalizeDirectoryState(state);
}
