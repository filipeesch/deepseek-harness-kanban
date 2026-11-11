import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectoryLayoutStore } from '../../src/host/sharing/layout-directory.js';
import { describeLayoutStoreContract, contractManifest, CONTRACT_WORKFLOW } from '../support/layout-store-contract.js';
import { serializeSharedManifest, SHARED_MANIFEST_FILE } from '../../src/domain/sharing/manifest.js';
import { exportBoardLogFixture } from '../support/board-log-fixture.js';

const directories: string[] = [];

async function directory(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), 'dsh-layout-'));
  directories.push(value);
  return value;
}

async function seeded(): Promise<string> {
  const value = await directory();
  await writeFile(path.join(value, SHARED_MANIFEST_FILE), serializeSharedManifest(contractManifest()), 'utf8');
  await mkdir(path.join(value, 'kanban-boards'), { recursive: true });
  await writeFile(path.join(value, 'kanban-boards', 'delivery.yaml'), exportBoardLogFixture(CONTRACT_WORKFLOW), 'utf8');
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
  it('reads a manifest and a board log it wrote', async () => {
    const value = await directory();
    const store = new DirectoryLayoutStore({ directory: value });
    await store.ensure();
    expect(await store.readManifest()).toBeNull();
    const written = await store.writeManifest(contractManifest(), { expectedToken: null, message: 'm' });
    expect(written.token).toBeDefined();
    const log = await store.createLog('delivery', CONTRACT_WORKFLOW);
    expect(log.log.snapshot.text).toBe(CONTRACT_WORKFLOW);
    expect(await readFile(path.join(value, 'kanban-boards', 'delivery.yaml'), 'utf8')).toContain('snapshot:');
  });

  it('refuses a stale manifest write', async () => {
    const value = await seeded();
    const store = new DirectoryLayoutStore({ directory: value });
    await expect(store.writeManifest(contractManifest(['delivery', 'ops']), { expectedToken: null, message: 'm' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('appends to a board log against its head', async () => {
    const value = await seeded();
    const store = new DirectoryLayoutStore({ directory: value });
    const read = await store.readLog('delivery');
    const appended = await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' });
    expect(appended.log.events.map(event => event.seq)).toEqual([1]);
    expect(await store.readLog('delivery')).not.toBeNull();
    await expect(store.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
  });

  it('reports a conflict copy beside the manifest', async () => {
    const value = await seeded();
    await writeFile(path.join(value, 'kanban-hub (1).yaml'), serializeSharedManifest(contractManifest()), 'utf8');
    const store = new DirectoryLayoutStore({ directory: value });
    await store.ensure();
    expect(store.review()).toMatchObject({ code: 'SHARING_CONFLICT_COPY', files: ['kanban-hub (1).yaml'] });
  });

  it('reports a board log written by a newer plugin', async () => {
    const value = await seeded();
    await writeFile(path.join(value, 'kanban-boards', 'delivery.yaml'), 'version: 9\nsnapshot: {seq: 0, text: "columns: []"}\nevents: []\n', 'utf8');
    const store = new DirectoryLayoutStore({ directory: value });
    await expect(store.readLog('delivery')).rejects.toThrow(expect.objectContaining({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' }));
  });

  it('reports a missing folder', async () => {
    const store = new DirectoryLayoutStore({ directory: path.join(tmpdir(), 'dsh-missing-' + Math.random().toString(36).slice(2)) });
    await expect(store.ensure()).rejects.toThrow(expect.objectContaining({ code: 'SHARING_FOLDER_MISSING' }));
  });
});
