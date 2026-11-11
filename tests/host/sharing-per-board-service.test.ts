import { describe, expect, it } from 'vitest';
import { defaultHubState } from '../../src/domain/hub-schema.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { HubSharingService } from '../../src/host/sharing/service.js';
import { emptyBoard, type HubSharingStore } from '../../src/host/sharing/state.js';
import type { ProviderDescription, ProviderState, SharingBinding, SharingProviderId } from '../../src/host/sharing/provider.js';
import type { SharedLayoutStore } from '../../src/host/sharing/ports.js';
import { serializeSharedManifest } from '../../src/domain/sharing/manifest.js';
import { createBoardLog, encodeBoardLog, headToken } from '../../src/domain/journal/log.js';
import { workflowDigest } from '../../src/domain/sharing/board-plan.js';
import { MemoryLayoutStore } from '../support/memory-layout-store.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { MemoryHubStorage } from './helpers.js';

const NOW = '2026-01-02T00:00:00.000Z';
const NL = String.fromCharCode(10);
const FLOW = ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', '  - id: plan', '    key: s2', '    label: Plan', ''].join(NL);

function description(binding: SharingBinding): ProviderDescription {
  return { id: binding.provider, label: 'Local folder', address: binding.settings.path ?? '', syncMode: 'explicit', defaultIntervalMinutes: 5, requiresAuthorization: false, supportsFiles: true };
}

function memorySharing(): HubSharingStore {
  const records = new Map<string, never>();
  return {
    load: id => { const value = records.get(id); return value === undefined ? undefined : structuredClone(value); },
    list: () => [...records.values()].map(value => structuredClone(value)),
    save: async value => { records.set(value.hubId, structuredClone(value) as never); },
    delete: async id => { records.delete(id); },
    close: async () => {},
  };
}

interface Fixture {
  hubs: HubRepository;
  service: HubSharingService;
  layout: MemoryLayoutStore;
  close: () => Promise<void>;
}

async function fixture(seed?: { manifest: Array<{ key: string; name: string; projectKeys?: string[] }>; logs: Record<string, string>; token?: string }): Promise<Fixture> {
  const storage = new MemoryHubStorage();
  const seeded = defaultHubState('hub', 'Hub', 'board', 'Board', NOW);
  // A task needs a registered project, so the fixture owns one.
  seeded.projects = [{ id: 'project', projectKey: 'project', name: 'Project', projectPath: '/repo' }];
  storage.hubs.set('hub', seeded);
  const hubs = await HubRepository.open(storage, { id: () => 'generated', now: () => NOW });
  const layout = new MemoryLayoutStore(seed === undefined ? {} : { manifest: { version: 3, boards: seed.manifest }, logs: seed.logs });
  const service = new HubSharingService({
    hubs,
    store: memorySharing(),
    providers: {
      createLayoutStore: (): SharedLayoutStore => layout,
      describe: (binding: SharingBinding) => description(binding),
      normalize: (_provider: SharingProviderId, settings: Record<string, string>) => settings,
      prepare: async (_hubId: string, binding: SharingBinding) => binding,
      defaultInterval: () => 5,
    },
    now: () => NOW,
    id: (() => { let n = 0; return () => 'id-' + (++n); })(),
  });
  return { hubs, service, layout, close: async () => { await service.close(); await hubs.close(); } };
}

function boardOf(f: Fixture): string { return f.hubs.requireHub('hub').boards[0]!.id; }

describe('per-board publishing service', () => {
  it('publishes the manifest and one log per board when the storage is empty', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const view = f.service.view('hub')!;
    expect(view.status).toBe('published');
    expect(view.boards[0]).toMatchObject({ state: 'in-sync', bound: true });
    expect(await f.layout.readManifest()).not.toBeNull();
    expect(await f.layout.readLog(view.boards[0]!.key!)).not.toBeNull();
    await f.close();
  });

  it('creates a board the team publishes, from its log', async () => {
    const f = await fixture({ manifest: [{ key: 'team', name: 'Team board' }], logs: { team: FLOW } });
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    expect(f.service.view('hub')?.status).toBe('preview');
    await f.service.receive('hub');
    await f.service.getUpdates('hub');
    const created = f.hubs.requireHub('hub').boards.find(board => board.name === 'Team board');
    expect(created).toBeDefined();
    expect(created!.workflowYaml).toBe(FLOW);
    expect(f.service.view('hub')?.boards.find(board => board.name === 'Team board')).toMatchObject({ state: 'in-sync', bound: true });
    await f.close();
  });

  it('applies a team rename and migrates the local tasks in the same update', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => {
      draft.tasks.push({
        id: 'task', boardId, projectId: 'project', title: 'T', description: '',
        columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: NOW, updatedAt: NOW,
      } as never);
      return draft;
    }, hub.revision);
    const key = f.service.view('hub')!.boards[0]!.key!;
    const snapshot = await f.layout.readLog(key);
    const published = parseWorkflow(snapshot!.log.snapshot.text);
    const identity = published.columns[0]!.key!;
    const from = published.columns[0]!.id;
    await f.layout.appendChanges(key, [{ kind: 'stage.id-changed', key: identity, from, id: 'inbox' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.service.getUpdates('hub');
    const task = f.hubs.requireHub('hub').tasks.find(candidate => candidate.id === 'task')!;
    expect(task.columnId).toBe('inbox');
    expect(f.hubs.requireHub('hub').boards[0]!.workflowYaml).toContain('id: inbox');
    await f.close();
  });

  it('refuses to publish a board that has unapplied team events', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const key = f.service.view('hub')!.boards[0]!.key!;
    const snapshot = await f.layout.readLog(key);
    await f.layout.appendChanges(key, [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.hubs.hub('hub').saveBoardWorkflow(boardId, FLOW.replace('label: Backlog', 'label: Mine'));
    await expect(f.service.publishBoard('hub', boardId)).rejects.toThrow(expect.objectContaining({ code: 'SHARING_PUBLISH_BLOCKED' }));
    await f.close();
  });

  it('applies another board even when one needs a choice', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    // A second board enters the team.
    const first = f.hubs.requireHub('hub').boards[0]!;
    await f.hubs.hub('hub').transact(draft => { const added = { ...draft.boards[0]!, id: 'second', name: 'Second' }; draft.boards.push(added); return draft; }, f.hubs.requireHub('hub').revision);
    await f.service.publishManifest('hub');
    const boardId = boardOf(f);
    // The first board diverges locally, the second receives a change.
    const views = f.service.view('hub')!;
    const firstKey = views.boards.find(board => board.boardId === boardId)!.key!;
    const secondKey = views.boards.find(board => board.name === 'Second')!.key!;
    const snapshot = await f.layout.readLog(firstKey);
    await f.layout.appendChanges(firstKey, [{ kind: 'stage.id-changed', key: 's1', from: 'backlog', id: 'inbox' }], { expectedHead: snapshot!.head, message: 'm', at: NOW });
    await f.hubs.hub('hub').saveBoardWorkflow(boardId, FLOW.replace('initial_column: backlog', 'initial_column: todo').replace('  - id: backlog', '  - id: todo'));
    const secondSnapshot = await f.layout.readLog(secondKey);
    await f.layout.appendChanges(secondKey, [{ kind: 'workflow.field-changed', field: 'name', value: 'Second renamed' }], { expectedHead: secondSnapshot!.head, message: 'm', at: NOW });
    await expect(f.service.getUpdates('hub')).rejects.toThrow();
    // The board that could advance did.
    expect(f.hubs.requireHub('hub').boards.find(board => board.name === 'Second')!.workflowYaml).toContain('name: Second renamed');
    expect(f.service.view('hub')?.boards.find(board => board.boardId === boardId)?.state).toBe('needs-review');
    await f.close();
  });

  it('keeps a removed board that holds work as an orphan and publishes it under a new key', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    const hub = f.hubs.requireHub('hub');
    await f.hubs.hub('hub').transact(draft => {
      draft.tasks.push({ id: 'task', boardId, projectId: 'project', title: 'T', description: '', columnId: 'backlog', position: 0, sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: NOW, updatedAt: NOW } as never);
      return draft;
    }, hub.revision);
    const key = f.service.view('hub')!.boards[0]!.key!;
    // The team drops the board from the manifest.
    await f.layout.writeManifest({ version: 3, boards: [] }, { expectedToken: (await f.layout.readManifest())!.token });
    await f.service.getUpdates('hub');
    const view = f.service.view('hub')!;
    expect(view.boards[0]).toMatchObject({ state: 'orphan' });
    expect(f.hubs.requireHub('hub').tasks).toHaveLength(1);
    expect(key).toBeDefined();
    await f.service.publishOrphan('hub', boardId);
    const rebound = f.service.view('hub')!.boards.find(board => board.boardId === boardId)!;
    expect(rebound.state).not.toBe('orphan');
    expect(rebound.key).toBeDefined();
    await f.close();
  });

  it('removes a team-removed board that holds no work', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    await f.hubs.hub('hub').transact(draft => { draft.boards.push({ ...draft.boards[0]!, id: 'extra', name: 'Extra' }); return draft; }, f.hubs.requireHub('hub').revision);
    await f.service.publishManifest('hub');
    const extra = f.service.view('hub')!.boards.find(board => board.name === 'Extra')!;
    expect(extra.key).toBeDefined();
    await f.layout.writeManifest({ version: 3, boards: [{ key: f.service.view('hub')!.boards[0]!.key!, name: 'Board' }] }, { expectedToken: (await f.layout.readManifest())!.token });
    await f.service.getUpdates('hub');
    expect(f.hubs.requireHub('hub').boards.some(board => board.id === 'extra')).toBe(false);
    expect(f.hubs.requireHub('hub').boards.some(board => board.id === boardId)).toBe(true);
    await f.close();
  });

  it('restores a board removed only from this installation', async () => {
    const f = await fixture();
    await f.service.connect({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '/team' } });
    const boardId = boardOf(f);
    await f.service.removeBoard('hub', boardId, 'local', 'Board');
    expect(f.service.view('hub')?.removed.map(board => board.boardId)).toEqual([boardId]);
    await f.service.restore('hub', boardId);
    expect(f.service.view('hub')?.boards.find(board => board.boardId === boardId)?.bound).toBe(true);
    await f.close();
  });
});
