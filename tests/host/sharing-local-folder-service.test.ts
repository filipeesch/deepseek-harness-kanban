import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SHARED_DOCUMENT_FILE, parseSharedDocument, serializeSharedDocument, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { createLocalFolderProviderDescriptor } from '../../src/host/sharing/local-folder-store.js';
import { SharingProviderRegistry, type SharingProviderResolver } from '../../src/host/sharing/provider.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import type { HubSharingRecord, HubSharingStore } from '../../src/host/sharing/state.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-01T00:00:00.000Z';
const flow = (label: string): string => ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    label: ' + label, ''].join('\n');

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const teamDocument = (label: string): SharedHubDocument => ({ version: 1, boards: [{ key: 'kanban', name: 'Kanban', workflow: flow(label) }] });

function memorySharingStore(): HubSharingStore {
  const records = new Map<string, HubSharingRecord>();
  return {
    load: hubId => { const value = records.get(hubId); return value === undefined ? undefined : structuredClone(value); },
    list: () => [...records.values()].map(value => structuredClone(value)),
    save: async value => { records.set(value.hubId, structuredClone(value)); },
    delete: async hubId => { records.delete(hubId); },
    close: async () => {},
  };
}

async function fixture(options: { afterRead?: (count: number, directory: string) => Promise<void> } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kanban-folder-service-'));
  roots.push(directory);
  const hubs = await HubRepository.open(new MemoryHubStorage(), { id: (() => { let n = 0; return () => 'id-' + (++n); })(), now: () => NOW });
  const hubId = hubs.defaultHubId();
  const boardId = hubs.requireHub(hubId).boards[0]!.id;
  const store = memorySharingStore();
  const registry = new SharingProviderRegistry([createLocalFolderProviderDescriptor({ home: directory })]);
  let reads = 0;
  const providers: SharingProviderResolver = options.afterRead === undefined ? registry : {
    create: (id, binding, state) => {
      const created = registry.create(id, binding, state);
      const read = created.read.bind(created);
      created.read = async (signal?: AbortSignal, cached?: Parameters<typeof read>[1]) => {
        const value = await read(signal, cached);
        await options.afterRead!(++reads, directory);
        return value;
      };
      return created;
    },
    describe: binding => registry.describe(binding),
    normalize: (provider, settings) => registry.normalize(provider, settings),
    defaultInterval: provider => registry.defaultInterval(provider),
    prepare: (id, binding, existing) => registry.prepare(id, binding, existing),
  };
  const service = new HubSharingService({ hubs, store, providers, now: () => NOW, debounceMs: 5 });
  await service.connect({ type: 'sharing.connect', hubId, provider: 'local-folder', settings: { path: directory }, intervalMinutes: 1 });
  return { directory, hubs, hubId, boardId, store, service };
}

async function documentText(directory: string): Promise<string> {
  return readFile(path.join(directory, SHARED_DOCUMENT_FILE), 'utf8');
}

describe('local folder publishing', () => {
  it('connects to an empty folder and publishes the Hub', async () => {
    const { directory, hubId, service } = await fixture();
    expect(service.view(hubId)).toMatchObject({ provider: 'local-folder', providerLabel: 'Local folder', syncMode: 'continuous', intervalMinutes: 1, status: 'published' });
    const document = parseSharedDocument(await documentText(directory));
    expect(document.boards).toHaveLength(1);
    expect(document.boards[0]!.name).toBe('Kanban');
  });

  it('refuses a second Hub on the same folder', async () => {
    const f = await fixture();
    const second = await f.hubs.createHub('Second');
    await expect(f.service.connect({ type: 'sharing.connect', hubId: second.id, provider: 'local-folder', settings: { path: f.directory }, intervalMinutes: 1 })).rejects.toMatchObject({ code: 'SHARING_ADDRESS_IN_USE' });
  });

  it('reports a conflict copy as review and blocks automatic synchronization', async () => {
    const f = await fixture();
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('local'), f.hubs.requireHub(f.hubId).revision);
    const published = await documentText(f.directory);
    await writeFile(path.join(f.directory, 'kanban-hub (1).yaml'), published, 'utf8');

    await f.service.check(f.hubId);

    const view = f.service.view(f.hubId)!;
    expect(view.status).toBe('needs-review');
    expect(view.blockers[0]).toMatchObject({ code: 'SHARING_CONFLICT_COPY' });
    expect(view.blockers[0]!.message).toContain('kanban-hub (1).yaml');
    expect(view.pending).toBe(1);
    expect(await documentText(f.directory)).toBe(published);

    await rm(path.join(f.directory, 'kanban-hub (1).yaml'));
    await f.service.check(f.hubId);

    expect(f.service.view(f.hubId)!.status).toBe('published');
    const synced = parseSharedDocument(await documentText(f.directory));
    expect(synced.boards[0]!.workflow).toBe(flow('local'));
  });

  it('recovers the team document after a lost publish race', async () => {
    const f = await fixture();
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('local'), f.hubs.requireHub(f.hubId).revision);
    // The team changed the same document after the last check.
    await writeFile(path.join(f.directory, SHARED_DOCUMENT_FILE), serializeSharedDocument(teamDocument('Team')), 'utf8');

    await expect(f.service.publish(f.hubId)).rejects.toMatchObject({ code: 'SHARING_STALE_TOKEN' });

    // The failed publish must leave the team's current document in `seen`, so the
    // both-sides change is visible instead of being masked by a stale cache.
    const view = f.service.view(f.hubId)!;
    expect(view.conflicts).toBe(1);
    expect(view.status).toBe('needs-review');
  });

  it('stops an automatic synchronization when a copy appears after the check read', async () => {
    const copies: string[] = [];
    const f = await fixture({
      afterRead: async (count, directory) => {
        // The connect read is first; the copy lands right after the check read.
        if (count !== 2) return;
        copies.push('kanban-hub (1).yaml');
        await writeFile(path.join(directory, 'kanban-hub (1).yaml'), 'other version', 'utf8');
      },
    });
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('local'), f.hubs.requireHub(f.hubId).revision);
    const published = await documentText(f.directory);

    await f.service.check(f.hubId);

    expect(copies).toHaveLength(1);
    const view = f.service.view(f.hubId)!;
    expect(view.status).toBe('needs-review');
    expect(view.blockers[0]!.message).toContain('kanban-hub (1).yaml');
    // The detected review stopped the automatic write: nothing was published.
    expect(await documentText(f.directory)).toBe(published);
  });

  it('synchronizes a local save automatically after the debounce', async () => {
    const f = await fixture();
    await f.hubs.hub(f.hubId).saveBoardWorkflow(f.boardId, flow('local'), f.hubs.requireHub(f.hubId).revision);
    f.service.noteLocalChange(f.hubId);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(parseSharedDocument(await documentText(f.directory)).boards[0]!.workflow).toBe(flow('local'));
  });

  it('applies a team-only change automatically', async () => {
    const f = await fixture();
    await writeFile(path.join(f.directory, SHARED_DOCUMENT_FILE), [
      'version: 1',
      'boards:',
      '  - key: kanban',
      '    name: Kanban',
      '    workflow: |',
      '      name: Team',
      '      initial_column: backlog',
      '      columns:',
      '        - id: backlog',
      '          label: Backlog',
      '',
    ].join('\n'), 'utf8');

    await f.service.check(f.hubId);

    expect(f.service.view(f.hubId)!.status).toBe('published');
    expect(f.hubs.requireHub(f.hubId).boards[0]!.workflowYaml).toContain('name: Team');
  });

  it('leaves the folder and the document when the Hub is disconnected', async () => {
    const f = await fixture();
    const published = await documentText(f.directory);
    await f.service.disconnect(f.hubId);
    expect(f.service.view(f.hubId)).toBeUndefined();
    expect(await documentText(f.directory)).toBe(published);
  });
});
