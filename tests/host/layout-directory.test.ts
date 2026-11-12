import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectoryLayoutStore } from '../../src/host/sharing/layout-directory.js';
import { describeLayoutStoreContract, contractLog } from '../support/layout-store-contract.js';
import { serializeLayoutStamp, SHARED_BOARD_DIRECTORY, SHARED_LAYOUT_FILE } from '../../src/domain/sharing/layout.js';
import { exportBoardLogFixture } from '../support/board-log-fixture.js';
import { encodeBoardLog } from '../../src/domain/journal/log.js';

const NL = String.fromCharCode(10);
const directories: string[] = [];

async function directory(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), 'dsh-layout-'));
  directories.push(value);
  return value;
}

async function seeded(): Promise<string> {
  const value = await directory();
  await writeFile(path.join(value, SHARED_LAYOUT_FILE), serializeLayoutStamp(), 'utf8');
  await mkdir(path.join(value, SHARED_BOARD_DIRECTORY), { recursive: true });
  await writeFile(path.join(value, SHARED_BOARD_DIRECTORY, 'delivery.jsonl'), exportBoardLogFixture('name: Delivery' + NL + 'columns:' + NL + '  - id: backlog' + NL + '    key: s1' + NL + '    label: Backlog' + NL), 'utf8');
  return value;
}

afterEach(async () => {
  for (const value of directories.splice(0)) await rm(value, { recursive: true, force: true });
});

describeLayoutStoreContract(
  'directory layout store',
  async () => new DirectoryLayoutStore({ directory: await seeded() }),
  async () => new DirectoryLayoutStore({ directory: await directory() }),
);

describe('directory layout store on disk', () => {
  it('writes a stamp and a board log it can read back', async () => {
    const value = await directory();
    const store = new DirectoryLayoutStore({ directory: value });
    await store.ensure();
    expect(await store.readStamp()).toBeNull();
    expect(await store.writeStamp(4, { expectedVersion: null })).toEqual({ version: 4 });
    const log = await store.createLog('delivery', contractLog());
    expect(log.head).toBeDefined();
    await expect(readFile(path.join(value, SHARED_BOARD_DIRECTORY, 'delivery.jsonl'), 'utf8')).resolves.toContain('workflow.replaced');
  });

  it('refuses a stale stamp write', async () => {
    const value = await seeded();
    const store = new DirectoryLayoutStore({ directory: value });
    await expect(store.writeStamp(4, { expectedVersion: null })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('appends to a board log against its head', async () => {
    const value = await seeded();
    const store = new DirectoryLayoutStore({ directory: value });
    const read = await store.readLog('delivery');
    const appended = await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    expect(appended.log[appended.log.length - 1]!.seq).toBe(read!.log[read!.log.length - 1]!.seq + 1);
    await expect(store.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('reports a conflict copy beside the stamp and inside the board directory', async () => {
    const value = await seeded();
    await writeFile(path.join(value, 'kanban-hub (1).yaml'), serializeLayoutStamp(), 'utf8');
    await writeFile(path.join(value, SHARED_BOARD_DIRECTORY, 'delivery (1).jsonl'), exportBoardLogFixture('name: Copy' + NL + 'columns: []' + NL), 'utf8');
    const store = new DirectoryLayoutStore({ directory: value });
    await store.ensure();
    expect(store.review()).toMatchObject({ code: 'SHARING_CONFLICT_COPY', files: ['kanban-hub (1).yaml', 'kanban-boards/delivery (1).jsonl'] });
  });

  it('reports a board log written by a newer plugin', async () => {
    const value = await seeded();
    await writeFile(path.join(value, SHARED_BOARD_DIRECTORY, 'delivery.jsonl'), '{"kind":"workflow.replaced","text":"columns: []","seq":0,"at":"2026-01-01T00:00:00.000Z","v":9}' + NL, 'utf8');
    const store = new DirectoryLayoutStore({ directory: value });
    await expect(store.readLog('delivery')).rejects.toThrow(expect.objectContaining({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' }));
  });

  it('ignores entries that are not board logs', async () => {
    const value = await seeded();
    await writeFile(path.join(value, SHARED_BOARD_DIRECTORY, 'notes.txt'), 'hello', 'utf8');
    const store = new DirectoryLayoutStore({ directory: value });
    expect((await store.listLogs()).map(entry => entry.key)).toEqual(['delivery']);
  });

  it('reports a missing folder', async () => {
    const store = new DirectoryLayoutStore({ directory: path.join(tmpdir(), 'dsh-missing-' + Math.random().toString(36).slice(2)) });
    await expect(store.ensure()).rejects.toThrow(expect.objectContaining({ code: 'SHARING_FOLDER_MISSING' }));
  });
});

void encodeBoardLog;
