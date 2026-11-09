import { describe, expect, it } from 'vitest';
import { serializeSharedDocument, sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { KanbanError } from '../../src/shared/errors.js';
import { GoogleDriveSharedConfigStore, createGoogleDriveProviderDescriptor, normalizeFolderAddress } from '../../src/host/sharing/google-drive-store.js';
import type { GoogleDriveClient, GoogleDriveFile } from '../../src/host/sharing/google-drive-client.js';

function documentOf(name: string): SharedHubDocument {
  return { version: 2, boards: [{ key: 'kanban', name, workflow: 'name: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n' }] };
}

class FakeDrive {
  content: string | null = null;
  revision = 0;
  fileId = 'file-1';
  changes = false;
  deleted = false;
  findDocumentCalls = 0;
  pageFeed = false;
  expireCursor = false;
  afterUpdate?: (drive: FakeDrive) => void;
  created = 0;
  private file(): GoogleDriveFile { return { id: this.fileId, name: 'kanban-hub.yaml', headRevisionId: 'r' + this.revision, parents: ['folder-1'] }; }
  async getFile(id?: string): Promise<GoogleDriveFile> { if (id === 'folder-1') return { id: 'folder-1', name: 'Folder' }; if (this.deleted || this.content === null) throw Object.assign(new Error('missing'), { code: 'SHARING_DOCUMENT_MISSING' }); return this.file(); }
  async findDocument(): Promise<GoogleDriveFile | null> { this.findDocumentCalls += 1; return this.content === null ? null : this.file(); }
  async getContent(): Promise<{ content: string; file: GoogleDriveFile }> { if (this.content === null) throw Object.assign(new Error('missing'), { code: 'SHARING_DOCUMENT_MISSING' }); return { content: this.content, file: this.file() }; }
  async getStartPageToken(): Promise<string> { return 'cursor-1'; }
  async listChanges(pageToken?: string): Promise<{ changes: Array<{ fileId: string; file?: GoogleDriveFile }>; nextPageToken?: string; newStartPageToken?: string }> {
    if (this.expireCursor) throw new KanbanError('SHARING_FAILED', 'expired cursor');
    if (this.pageFeed && pageToken !== undefined) {
      const page = Number(pageToken.replace('cursor-', ''));
      if (page < 11) return { changes: [], nextPageToken: 'cursor-' + (page + 1) };
      return { changes: [{ fileId: this.fileId, file: this.file() }], newStartPageToken: 'cursor-12' };
    }
    return { changes: this.changes ? [{ fileId: this.fileId, file: this.file() }] : [], newStartPageToken: 'cursor-next' };
  }
  async createDocument(_folderId: string, content: string): Promise<GoogleDriveFile> { this.created++; this.content = content; this.revision++; return this.file(); }
  async updateContent(_fileId: string, content: string): Promise<GoogleDriveFile> { this.content = content; this.revision++; this.afterUpdate?.(this); return this.file(); }
}

function storeOf(drive: FakeDrive): GoogleDriveSharedConfigStore {
  return new GoogleDriveSharedConfigStore({ client: drive as unknown as GoogleDriveClient, folderId: 'folder-1', state: {} });
}

describe('Google Drive document store', () => {
  it('creates the document when the folder is empty', async () => {
    const drive = new FakeDrive();
    const store = storeOf(drive);
    const document = documentOf('Team');
    const result = await store.write(document, { expectedToken: null, message: 'publish' });
    expect(result.token).toBe(sharedDocumentToken(document));
    expect(drive.created).toBe(1);
    expect(JSON.parse(JSON.stringify(store.state()))).toMatchObject({ fileId: 'file-1' });
  });

  it('reads cached content without downloading when the change feed is quiet', async () => {
    const drive = new FakeDrive();
    const store = storeOf(drive);
    await store.write(documentOf('Team'), { expectedToken: null, message: 'publish' });
    const first = await store.read();
    expect(first?.document.boards[0]!.name).toBe('Team');
    const second = await store.read(undefined, first);
    expect(second?.token).toBe(first?.token);
  });

  it('refuses a stale write and detects a concurrent write after writing', async () => {
    const drive = new FakeDrive();
    drive.content = serializeSharedDocument(documentOf('Team'));
    const store = storeOf(drive);
    const snapshot = await store.read();
    drive.content = serializeSharedDocument(documentOf('Other'));
    await expect(store.write(documentOf('Mine'), { expectedToken: snapshot!.token, message: 'publish' })).rejects.toMatchObject({ code: 'SHARING_STALE_TOKEN' });

    drive.content = serializeSharedDocument(documentOf('Team'));
    const fresh = storeOf(drive);
    const before = await fresh.read();
    drive.afterUpdate = self => { self.afterUpdate = undefined; self.content = serializeSharedDocument(documentOf('Winner')); };
    await expect(fresh.write(documentOf('Mine'), { expectedToken: before!.token, message: 'publish' })).rejects.toMatchObject({ code: 'SHARING_CONCURRENT_WRITE' });
  });

  it('downloads a changed revision instead of returning the cached document', async () => {
    const drive = new FakeDrive();
    const store = storeOf(drive);
    await store.write(documentOf('Team'), { expectedToken: null, message: 'publish' });
    const first = await store.read();
    drive.content = serializeSharedDocument(documentOf('New team'));
    drive.revision += 1;
    drive.changes = true;
    const second = await store.read(undefined, first);
    expect(second?.document.boards[0]?.name).toBe('New team');
  });

  it('forces a full read when the change cursor expired', async () => {
    const drive = new FakeDrive();
    const store = storeOf(drive);
    const original = documentOf('Team');
    const written = await store.write(original, { expectedToken: null, message: 'publish' });
    const cached = { token: written.token, document: original };
    drive.expireCursor = true;
    drive.content = serializeSharedDocument(documentOf('After expiry'));
    const result = await store.read(undefined, cached);
    expect(result?.document.boards[0]?.name).toBe('After expiry');
  });

  it('continues a change feed across checks instead of starving on page eleven', async () => {
    const drive = new FakeDrive();
    const store = storeOf(drive);
    const original = documentOf('Team');
    const written = await store.write(original, { expectedToken: null, message: 'publish' });
    const cached = { token: written.token, document: original };
    drive.pageFeed = true;
    drive.content = serializeSharedDocument(documentOf('Page eleven'));
    drive.revision += 1;
    const first = await store.read(undefined, cached);
    expect(first?.document.boards[0]?.name).toBe('Team');
    const second = await store.read(undefined, first);
    expect(second?.document.boards[0]?.name).toBe('Page eleven');
  });

  it('reports a deleted bound document instead of re-adopting a replacement by name', async () => {
    const drive = new FakeDrive();
    const store = storeOf(drive);
    await store.write(documentOf('Team'), { expectedToken: null, message: 'publish' });
    const beforeDelete = drive.findDocumentCalls;
    drive.deleted = true;
    await expect(store.read()).rejects.toMatchObject({ code: 'SHARING_DOCUMENT_MISSING' });
    expect(drive.findDocumentCalls).toBe(beforeDelete);
  });

  it('never deletes the team document on destroy', async () => {
    const drive = new FakeDrive();
    drive.content = serializeSharedDocument(documentOf('Team'));
    const store = storeOf(drive);
    await store.destroy();
    expect(drive.content).not.toBeNull();
  });
});


describe('Google Drive settings normalization', () => {
  const descriptor = createGoogleDriveProviderDescriptor({ auth: { accessToken: async () => 'token' } });
  it('normalizes a folder link or id and rejects a malformed address', () => {
    expect(normalizeFolderAddress('https://drive.google.com/drive/folders/abcDEF1234567890')).toBe('abcDEF1234567890');
    expect(descriptor.normalizeSettings({ folderId: 'abcDEF1234567890', driveId: 'drive-1', folderName: 'Team' })).toMatchObject({ folderId: 'abcDEF1234567890', driveId: 'drive-1', folderName: 'Team' });
    expect(() => descriptor.normalizeSettings({ folderId: 'bad' })).toThrow(/folder link or id/);
  });
});
