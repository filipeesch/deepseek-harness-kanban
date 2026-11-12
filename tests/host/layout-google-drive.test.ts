import { describe, expect, it } from 'vitest';
import { GoogleDriveLayoutStore } from '../../src/host/sharing/google-drive-layout-store.js';
import type { GoogleDriveClient, GoogleDriveFile } from '../../src/host/sharing/google-drive-client.js';
import { KanbanError } from '../../src/shared/errors.js';
import { serializeLayoutStamp, driveBoardFileName, SHARED_LAYOUT_FILE } from '../../src/domain/sharing/layout.js';
import { exportBoardLogFixture } from '../support/board-log-fixture.js';
import { contractLog } from '../support/layout-store-contract.js';

const NL = String.fromCharCode(10);
interface FakeFile extends GoogleDriveFile { content: string }

/** An in-memory Drive folder, so the layout store's compare-and-verify path is exercised. */
class FakeDrive {
  readonly files = new Map<string, FakeFile>();
  private counter = 0;
  readonly folder: GoogleDriveFile = { id: 'folder', name: 'Team' };

  constructor() {
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
      findLayoutStamp: async () => [...this.files.values()].find(file => file.name === SHARED_LAYOUT_FILE && file.trashed !== true) ?? null,
      findFile: async (_folderId: string, name: string) => [...this.files.values()].find(file => file.name === name && file.trashed !== true) ?? null,
      listFiles: async (_folderId: string, prefix: string) => [...this.files.values()].filter(file => file.trashed !== true && (file.name ?? '').startsWith(prefix)),
      createFile: async (_folderId: string, name: string, content: string) => {
        const file = this.file(name, content);
        this.files.set(file.id, file);
        return file;
      },
      createLayoutStamp: async (_folderId: string, content: string) => {
        const file = this.file(SHARED_LAYOUT_FILE, content);
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
  it('creates the layout stamp and verifies what landed', async () => {
    const drive = new FakeDrive();
    const store = storeFor(drive);
    expect(await store.readStamp()).toBeNull();
    expect(await store.writeStamp(4, { expectedVersion: null })).toEqual({ version: 4 });
    expect(await store.readStamp()).toEqual({ version: 4 });
  });

  it('refuses a stale stamp write', async () => {
    const drive = new FakeDrive();
    drive.seed(SHARED_LAYOUT_FILE, serializeLayoutStamp());
    const store = storeFor(drive);
    await expect(store.writeStamp(4, { expectedVersion: null })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('creates a board log by file name and adopts it by name later', async () => {
    const drive = new FakeDrive();
    drive.seed(SHARED_LAYOUT_FILE, serializeLayoutStamp());
    const created = await storeFor(drive).createLog('delivery', contractLog());
    expect([...drive.files.values()].some(file => file.name === driveBoardFileName('delivery'))).toBe(true);
    const reader = storeFor(drive);
    const read = await reader.readLog('delivery');
    expect(read!.head).toBe(created.head);
    expect(read!.log[0]!.kind).toBe('workflow.replaced');
  });

  it('lists the published boards and appends against the head', async () => {
    const drive = new FakeDrive();
    drive.seed(SHARED_LAYOUT_FILE, serializeLayoutStamp());
    drive.seed(driveBoardFileName('delivery'), exportBoardLogFixture('name: Delivery' + NL + 'columns: []' + NL));
    const store = storeFor(drive);
    expect((await store.listLogs()).map(entry => entry.key)).toEqual(['delivery']);
    const read = await store.readLog('delivery');
    const appended = await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    expect(appended.log).toHaveLength(read!.log.length + 1);
    await expect(store.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('remembers the board file id in provider state', async () => {
    const drive = new FakeDrive();
    drive.seed(SHARED_LAYOUT_FILE, serializeLayoutStamp());
    const store = storeFor(drive);
    await store.createLog('delivery', contractLog());
    const state = store.state();
    expect(Object.keys(state.boardFileIds as Record<string, string>)).toEqual(['delivery']);
  });

  it('reports a board log from a newer plugin', async () => {
    const drive = new FakeDrive();
    drive.seed(SHARED_LAYOUT_FILE, serializeLayoutStamp());
    drive.seed(driveBoardFileName('delivery'), '{"kind":"workflow.replaced","text":"columns: []","seq":0,"at":"2026-01-01T00:00:00.000Z","v":9}' + NL);
    await expect(storeFor(drive).readLog('delivery')).rejects.toThrow(expect.objectContaining({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' }));
  });
});
