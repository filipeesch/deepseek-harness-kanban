import { describe, expect, it } from 'vitest';
import { GoogleDriveLayoutStore, driveBoardFileName } from '../../src/host/sharing/google-drive-layout-store.js';
import type { GoogleDriveClient, GoogleDriveFile } from '../../src/host/sharing/google-drive-client.js';
import { KanbanError } from '../../src/shared/errors.js';
import { serializeSharedManifest } from '../../src/domain/sharing/manifest.js';
import { exportBoardLogFixture } from '../support/board-log-fixture.js';
import { CONTRACT_WORKFLOW, contractManifest } from '../support/layout-store-contract.js';

interface FakeFile extends GoogleDriveFile { content: string }

/** An in-memory Drive folder, so the layout store's compare-and-verify path is exercised. */
class FakeDrive {
  readonly files = new Map<string, FakeFile>();
  private counter = 0;
  readonly folder: GoogleDriveFile = { id: 'folder', name: 'Team' };

  constructor() {
    // The bound folder is itself a file object in the Drive API.
    this.files.set('folder', { id: 'folder', name: 'Team', mimeType: 'application/vnd.google-apps.folder', driveId: 'drive', trashed: false, content: '' } as FakeFile);
  }

  private file(name: string, content: string, parents: string[] = ['folder']): FakeFile {
    this.counter += 1;
    return { id: 'file-' + this.counter, name, mimeType: 'text/yaml', headRevisionId: 'rev-' + this.counter, driveId: 'drive', trashed: false, content, parents } as FakeFile;
  }

  seed(name: string, content: string): FakeFile {
    const file = this.file(name, content);
    this.files.set(file.id, file);
    return file;
  }

  asClient(): GoogleDriveClient {
    return {
      getFile: async (fileId: string) => {
        const file = this.files.get(fileId);
        if (file === undefined) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'Missing.');
        return file;
      },
      getContent: async (fileId: string) => {
        const file = this.files.get(fileId);
        if (file === undefined) throw new KanbanError('SHARING_DOCUMENT_MISSING', 'Missing.');
        return { content: file.content, file };
      },
      findDocument: async () => [...this.files.values()].find(file => file.name === 'kanban-hub.yaml' && file.trashed !== true) ?? null,
      findFile: async (_folderId: string, name: string) => [...this.files.values()].find(file => file.name === name && file.trashed !== true) ?? null,
      createFile: async (_folderId: string, name: string, content: string) => {
        const file = this.file(name, content);
        this.files.set(file.id, file);
        return file;
      },
      updateContent: async (fileId: string, content: string) => {
        const file = this.files.get(fileId)!;
        this.counter += 1;
        file.content = content;
        file.headRevisionId = 'rev-' + this.counter;
        return file;
      },
      getStartPageToken: async () => 'token',
      listChanges: async () => ({ changes: [] }),
    } as unknown as GoogleDriveClient;
  }
}

function storeFor(drive: FakeDrive, state: Record<string, unknown> = {}): GoogleDriveLayoutStore {
  return new GoogleDriveLayoutStore({ client: drive.asClient(), folderId: 'folder', state });
}

describe('Google Drive layout store', () => {
  it('creates the manifest and verifies what landed', async () => {
    const drive = new FakeDrive();
    const store = storeFor(drive);
    expect(await store.readManifest()).toBeNull();
    const written = await store.writeManifest(contractManifest(), { expectedToken: null, message: 'm' });
    expect((await store.readManifest())!.token).toBe(written.token);
  });

  it('refuses a stale manifest write', async () => {
    const drive = new FakeDrive();
    drive.seed('kanban-hub.yaml', serializeSharedManifest(contractManifest()));
    const store = storeFor(drive);
    await expect(store.writeManifest(contractManifest(['delivery']), { expectedToken: null, message: 'm' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('creates a board log by file name and adopts it by name later', async () => {
    const drive = new FakeDrive();
    drive.seed('kanban-hub.yaml', serializeSharedManifest(contractManifest()));
    const created = await storeFor(drive).createLog('delivery', CONTRACT_WORKFLOW);
    expect(drive.files.get(created.log === undefined ? '' : [...drive.files.keys()].find(key => drive.files.get(key)!.name === driveBoardFileName('delivery'))!)!.name).toBe('kanban-board-delivery.yaml');
    const reader = storeFor(drive);
    const read = await reader.readLog('delivery');
    expect(read!.head).toBe(created.head);
    expect(read!.log.snapshot.text).toBe(CONTRACT_WORKFLOW);
  });

  it('appends against the head and refuses a stale head', async () => {
    const drive = new FakeDrive();
    drive.seed('kanban-hub.yaml', serializeSharedManifest(contractManifest()));
    drive.seed(driveBoardFileName('delivery'), exportBoardLogFixture(CONTRACT_WORKFLOW));
    const store = storeFor(drive);
    const read = await store.readLog('delivery');
    const appended = await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    expect(appended.log.events.map(event => event.seq)).toEqual([1]);
    await expect(store.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('remembers the board file id in provider state', async () => {
    const drive = new FakeDrive();
    drive.seed('kanban-hub.yaml', serializeSharedManifest(contractManifest()));
    const store = storeFor(drive);
    await store.createLog('delivery', CONTRACT_WORKFLOW);
    const state = store.state();
    expect(Object.keys(state.boardFileIds as Record<string, string>)).toEqual(['delivery']);
  });

  it('reports a board log from a newer plugin', async () => {
    const drive = new FakeDrive();
    drive.seed('kanban-hub.yaml', serializeSharedManifest(contractManifest()));
    drive.seed(driveBoardFileName('delivery'), 'version: 9\nsnapshot: {seq: 0, text: "columns: []"}\nevents: []\n');
    await expect(storeFor(drive).readLog('delivery')).rejects.toThrow(expect.objectContaining({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' }));
  });
});
