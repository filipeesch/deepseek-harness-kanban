import { KanbanError, invariant } from '../../shared/errors.js';
import { GoogleDriveClient, type GoogleDriveFile } from './google-drive-client.js';
import { GoogleDriveLayoutStore } from './google-drive-layout-store.js';
import { type ProviderState, type SharingBinding, type SharingProviderDescriptor } from './provider.js';

export interface GoogleDriveStoreOptions {
  client: GoogleDriveClient;
  folderId: string;
  driveId?: string;
  state: ProviderState;
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }

/** Drive publishing state persisted beside the binding. */
function normalizeState(state: ProviderState): ProviderState {
  return {
    ...(text(state.manifestFileId) ? { manifestFileId: text(state.manifestFileId) } : {}),
    ...(text(state.driveId) ? { driveId: text(state.driveId) } : {}),
    ...(typeof state.boardFileIds === 'object' && state.boardFileIds !== null ? { boardFileIds: state.boardFileIds } : {}),
  };
}

export interface GoogleDriveProviderOptions {
  auth: { accessToken(): Promise<string>; refreshAccessToken?(): Promise<string> };
  fetch?: typeof fetch;
}

/** Parse a Drive folder link, `id=` URL, or raw id into a stable folder id. */
export function normalizeFolderAddress(value: string): string {
  const trimmed = value.trim();
  const fromFolders = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(trimmed);
  if (fromFolders?.[1]) return fromFolders[1];
  const fromQuery = /[?&]id=([A-Za-z0-9_-]{10,})/.exec(trimmed);
  if (fromQuery?.[1]) return fromQuery[1];
  return trimmed;
}

export function createGoogleDriveProviderDescriptor(options: GoogleDriveProviderOptions): SharingProviderDescriptor {
  return {
    id: 'google-drive',
    label: 'Google Drive',
    syncMode: 'explicit',
    defaultIntervalMinutes: 1,
    requiresAuthorization: true,
    normalizeSettings(settings) {
      const folderId = normalizeFolderAddress(settings.folderId ?? settings.folder ?? settings.address ?? '');
      if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) throw new KanbanError('INVALID_INPUT', 'A Google Drive folder link or id is required.');
      return {
        folderId,
        ...(settings.driveId?.trim() ? { driveId: settings.driveId.trim() } : {}),
        ...(settings.folderName?.trim() ? { folderName: settings.folderName.trim() } : {}),
        ...(settings.driveName?.trim() ? { driveName: settings.driveName.trim() } : {}),
      };
    },
    describe(binding) {
      const folder = binding.settings.folderName ?? binding.settings.folderId ?? 'Google Drive folder';
      const drive = binding.settings.driveName;
      return drive ? drive + ' / ' + folder : folder;
    },
    async prepareBinding(candidate, existing) {
      const folderId = candidate.settings.folderId;
      invariant(!existing.some(record => record.hubId !== candidate.hubId && record.provider === 'google-drive' && record.settings.folderId === folderId), 'SHARING_ADDRESS_IN_USE', 'The selected Google Drive folder is already bound to another Hub.');
      return candidate.settings;
    },
    createLayoutStore(_hubId, binding, state) {
      if (binding.provider !== 'google-drive') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not Google Drive.', { provider: binding.provider });
      const folderId = binding.settings.folderId;
      if (!folderId) throw new KanbanError('INVALID_INPUT', 'A Google Drive folder is required.');
      return new GoogleDriveLayoutStore({
        client: new GoogleDriveClient({ accessToken: () => options.auth.accessToken(), ...(options.auth.refreshAccessToken === undefined ? {} : { refresh: () => options.auth.refreshAccessToken!() }), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }),
        folderId,
        ...(binding.settings.driveId === undefined ? {} : { driveId: binding.settings.driveId }),
        state,
      });
    },
    normalizeState,
  };
}
