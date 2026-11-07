import { sharedDocumentToken, parseSharedDocument, serializeSharedDocument, type SharedHubDocument } from '../../domain/sharing/document.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import { assertExpectedToken, assertWrittenToken } from './verified-write.js';
import { GoogleDriveClient, type GoogleDriveFile } from './google-drive-client.js';
import { type ProviderState, type SharingBinding, type SharingProviderDescriptor } from './provider.js';
import type { SharedConfigStore, SharedDocumentSnapshot } from './store.js';

export interface GoogleDriveStoreOptions {
  client: GoogleDriveClient;
  folderId: string;
  driveId?: string;
  state: ProviderState;
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }

/** Drive document state persisted beside the binding. */
function normalizeState(state: ProviderState): ProviderState {
  return {
    ...(text(state.fileId) ? { fileId: text(state.fileId) } : {}),
    ...(text(state.headRevisionId) ? { headRevisionId: text(state.headRevisionId) } : {}),
    ...(text(state.changesPageToken) ? { changesPageToken: text(state.changesPageToken) } : {}),
    ...(text(state.driveId) ? { driveId: text(state.driveId) } : {}),
  };
}

/**
 * One Hub document in a Drive folder. It owns the whole-document read/write
 * contract, the change cursor, and the best-effort concurrent-write check.
 */
export class GoogleDriveSharedConfigStore implements SharedConfigStore {
  private readonly client: GoogleDriveClient;
  private readonly folderId: string;
  private readonly stateValue: ProviderState;
  private folderChecked = false;

  constructor(options: GoogleDriveStoreOptions) {
    this.client = options.client;
    this.folderId = options.folderId;
    this.stateValue = normalizeState(options.state);
    if (options.driveId) this.stateValue.driveId = options.driveId;
  }

  state(): ProviderState { return { ...this.stateValue }; }

  private get fileId(): string | undefined { return text(this.stateValue.fileId); }
  private get driveId(): string | undefined { return text(this.stateValue.driveId); }

  private rememberFile(file: GoogleDriveFile): void {
    this.stateValue.fileId = file.id;
  }

  private setWrittenFile(file: GoogleDriveFile): void {
    this.stateValue.fileId = file.id;
    if (file.headRevisionId) this.stateValue.headRevisionId = file.headRevisionId;
  }

  async ensure(): Promise<void> {
    if (!this.folderChecked) {
      this.folderChecked = true;
      try { const folder = await this.client.getFile(this.folderId); if (folder.driveId) this.stateValue.driveId = folder.driveId; }
      catch (error) {
        if (error instanceof KanbanError && error.code === 'SHARING_DOCUMENT_MISSING') throw new KanbanError('SHARING_FOLDER_MISSING', 'The selected Google Drive folder is not accessible.', { folderId: this.folderId });
        throw error;
      }
    }
    if (this.fileId) {
      const file = await this.client.getFile(this.fileId);
      if (file.trashed === true) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'The team document is in the Drive trash.');
      this.rememberFile(file);
      return;
    }
    const found = await this.client.findDocument(this.folderId, this.driveId);
    if (found) this.rememberFile(found);
  }

  private async advanceCursor(): Promise<{ changed: boolean; forceFullRead: boolean }> {
    const cursor = text(this.stateValue.changesPageToken);
    try {
      if (!cursor) {
        this.stateValue.changesPageToken = await this.client.getStartPageToken(this.driveId);
        return { changed: false, forceFullRead: true };
      }
      let pageToken = cursor;
      let changed = false;
      for (let page = 0; page < 10; page++) {
        const result = await this.client.listChanges(pageToken, this.driveId);
        const fileId = this.fileId;
        if (fileId && result.changes.some(change => change.fileId === fileId || change.file?.id === fileId)) changed = true;
        if (result.newStartPageToken) { this.stateValue.changesPageToken = result.newStartPageToken; break; }
        if (!result.nextPageToken) break;
        // Persist the continuation so a busy feed cannot starve the next check.
        this.stateValue.changesPageToken = result.nextPageToken;
        pageToken = result.nextPageToken;
      }
      return { changed, forceFullRead: false };
    } catch (error) {
      if (error instanceof KanbanError && error.code === 'SHARING_FAILED') {
        this.stateValue.changesPageToken = await this.client.getStartPageToken(this.driveId);
        return { changed: false, forceFullRead: true };
      }
      throw error;
    }
  }

  async read(signal?: AbortSignal, cached?: SharedDocumentSnapshot | null): Promise<SharedDocumentSnapshot | null> {
    signal?.throwIfAborted();
    await this.ensure();
    const fileId = this.fileId;
    if (!fileId) return null;
    let forceFullRead = false;
    if (cached && text(this.stateValue.changesPageToken)) {
      const cursor = await this.advanceCursor();
      forceFullRead = cursor.forceFullRead;
      if (!cursor.changed && !forceFullRead) return cached;
    } else {
      const cursor = await this.advanceCursor();
      forceFullRead = cursor.forceFullRead;
    }
    signal?.throwIfAborted();
    const file = await this.client.getFile(fileId);
    if (file.trashed === true) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'The team document is in the Drive trash.');
    const revision = file.headRevisionId;
    if (!forceFullRead && cached && revision !== undefined && revision === text(this.stateValue.headRevisionId)) return cached;
    const content = await this.client.getContent(fileId);
    const document = parseSharedDocument(content.content);
    this.stateValue.headRevisionId = revision ?? null;
    return { token: sharedDocumentToken(document), document };
  }

  async write(document: SharedHubDocument, options: { expectedToken: string | null; message: string }, signal?: AbortSignal): Promise<{ token: string }> {
    signal?.throwIfAborted();
    await this.ensure();
    const written = serializeSharedDocument(document);
    const token = sharedDocumentToken(document);
    let fileId = this.fileId;
    if (!fileId) {
      assertExpectedToken(options.expectedToken, null);
      // Observe from before the create so a concurrent change cannot slip behind a cursor
      // that was obtained after the snapshot we claim to have synchronized.
      const cursor = this.stateValue.changesPageToken ?? await this.client.getStartPageToken(this.driveId);
      const created = await this.client.createDocument(this.folderId, written);
      this.setWrittenFile(created);
      const verified = await this.client.getContent(created.id);
      assertWrittenToken(token, sharedDocumentToken(parseSharedDocument(verified.content)));
      this.stateValue.changesPageToken = cursor;
      return { token };
    }
    const before = await this.client.getContent(fileId);
    assertExpectedToken(options.expectedToken, sharedDocumentToken(parseSharedDocument(before.content)));
    const updated = await this.client.updateContent(fileId, written);
    this.setWrittenFile(updated);
    const after = await this.client.getContent(fileId);
    assertWrittenToken(token, sharedDocumentToken(parseSharedDocument(after.content)));
    return { token };
  }

  async destroy(): Promise<void> {
    // The folder and the document belong to the team; disconnecting never deletes them.
  }
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
    syncMode: 'continuous',
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
    createStore(hubId, binding, state) {
      if (binding.provider !== 'google-drive') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not Google Drive.', { provider: binding.provider });
      const folderId = binding.settings.folderId;
      if (!folderId) throw new KanbanError('INVALID_INPUT', 'A Google Drive folder is required.');
      return new GoogleDriveSharedConfigStore({
        client: new GoogleDriveClient({ accessToken: () => options.auth.accessToken(), ...(options.auth.refreshAccessToken === undefined ? {} : { refresh: () => options.auth.refreshAccessToken!() }), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }),
        folderId,
        ...(binding.settings.driveId === undefined ? {} : { driveId: binding.settings.driveId }),
        state,
      });
    },
    normalizeState,
  };
}
