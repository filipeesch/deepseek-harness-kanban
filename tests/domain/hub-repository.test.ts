import { describe, expect, it, vi } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { operationDeps, MemoryHubStorage } from './hub-helpers.js';

async function repo() {
  const storage = new MemoryHubStorage();
  const hubs = await HubRepository.open(storage, operationDeps());
  return { storage, hubs, store: hubs.defaultHub() };
}

describe('HubRepository', () => {
  it('seeds one default Hub and board when the domain is empty', async () => {
    const { hubs, storage } = await repo();
    expect(hubs.list()).toHaveLength(1);
    expect(hubs.list()[0]).toMatchObject({ name: 'My Hub' });
    expect(hubs.list()[0]!.boards[0]).toMatchObject({ name: 'Kanban' });
    expect(storage.meta.initializedAt).toBeTruthy();
  });

  it('creates Hubs with unique names and lists them by creation order', async () => {
    const { hubs } = await repo();
    const second = await hubs.createHub('Second');
    expect(hubs.list().map(hub => hub.name)).toEqual(['My Hub', 'Second']);
    await expect(hubs.createHub(' second ')).rejects.toMatchObject({ code: 'HUB_NAME_CONFLICT' });
    await hubs.renameHub(second.id, 'Renamed');
    expect(hubs.requireHub(second.id).name).toBe('Renamed');
    await expect(hubs.renameHub(second.id, ' my hub ')).rejects.toMatchObject({ code: 'HUB_NAME_CONFLICT' });
  });

  it('derives safe Hub ids for reserved and long names and reopens them', async () => {
    const storage = new MemoryHubStorage();
    const hubs = await HubRepository.open(storage, operationDeps());
    const reserved = await hubs.createHub('Constructor');
    expect(reserved.id).not.toBe('constructor');
    await hubs.hub(reserved.id).addBoard('Reserved board');
    const long = await hubs.createHub('x'.repeat(300));
    expect(long.id.length).toBeLessThanOrEqual(256);
    await hubs.close();
    const reopened = await HubRepository.open(storage, operationDeps());
    expect(reopened.list().map(hub => hub.name)).toEqual(expect.arrayContaining(['Constructor', 'x'.repeat(300)]));
    expect(reopened.requireHub(long.id).boards).toHaveLength(0);
  });

  it('serializes transactions, checks expected revisions, and keeps memory on save failure', async () => {
    const { hubs, storage, store } = await repo();
    await store.addBoard('A');
    const revision = store.snapshot().revision;
    await store.transact(() => undefined, revision);
    await expect(store.transact(() => undefined, revision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const before = store.snapshot();
    storage.failSave = true;
    await expect(store.addBoard('B')).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect(store.snapshot()).toEqual(before);
    storage.failSave = false;
    await store.addBoard('B');
    expect(store.snapshot().boards.map(board => board.name)).toContain('B');
  });

  it('writes only the changed Hub record', async () => {
    const { hubs, storage } = await repo();
    const second = await hubs.createHub('Second');
    const writesBefore = storage.writes.length;
    await hubs.hub(second.id).addBoard('Only second');
    expect(storage.writes.length).toBe(writesBefore + 1);
    expect(storage.writes.at(-1)).toBe(second.id);
    expect(hubs.requireHub(hubs.defaultHubId()).boards).toHaveLength(1);
  });

  it('serializes concurrent writers, notifies subscribers, and returns snapshot clones', async () => {
    const { store } = await repo();
    const listener = vi.fn(); const off = store.subscribe(listener);
    await Promise.all([store.addBoard('Concurrent A'), store.addBoard('Concurrent B')]);
    expect(store.snapshot().boards.map(board => board.name)).toEqual(expect.arrayContaining(['Concurrent A', 'Concurrent B']));
    expect(listener).toHaveBeenCalledTimes(2);
    const snapshot = store.snapshot(); snapshot.boards[0]!.name = 'Mutated outside';
    expect(store.snapshot().boards[0]!.name).not.toBe('Mutated outside');
    off();
  });

  it('does not duplicate a seeded Hub after a metadata write failure', async () => {
    const storage = new MemoryHubStorage(); storage.failMeta = true;
    await expect(HubRepository.open(storage, operationDeps())).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect(storage.hubs.size).toBe(1);
    storage.failMeta = false;
    const reopened = await HubRepository.open(storage, operationDeps());
    expect(reopened.list()).toHaveLength(1);
  });

  it('enforces last-Hub protection and task-blocked deletion', async () => {
    const { hubs, store } = await repo();
    await store.saveProject({ name: 'Web', projectPath: '/repo', gitRootPath: '/repo' });
    await store.createTask({ projectId: store.snapshot().projects[0]!.id, title: 'Task', description: '' }, 'session');
    const second = await hubs.createHub('Second');
    await expect(hubs.deleteHub(hubs.defaultHubId())).rejects.toMatchObject({ code: 'HUB_IN_USE' });
    await hubs.deleteHub(second.id);
    await expect(hubs.deleteHub(hubs.defaultHubId())).rejects.toMatchObject({ code: 'LAST_HUB' });
  });

  it('rejects a native session shared by tasks in another Hub', async () => {
    const { hubs, store } = await repo();
    await store.saveProject({ name: 'Web', projectPath: '/repo', gitRootPath: '/repo' });
    const task = await store.createTask({ projectId: store.snapshot().projects[0]!.id, title: 'Task', description: '' }, 'shared-session');
    const second = await hubs.createHub('Second');
    const secondStore = hubs.hub(second.id);
    const secondBoard = await secondStore.addBoard('B');
    secondStore.requireProject; // keep the facade shape used by callers
    await expect(secondStore.transact(draft => {
      draft.projects.push({ id: 'p', name: 'P', projectPath: '/repo2', gitRootPath: '/repo2' });
      draft.tasks.push({ ...task, id: 'other', boardId: secondBoard.id, projectId: 'p' });
    })).rejects.toMatchObject({ code: 'SESSION_IN_USE' });
  });

  it('rejects a project identifier shared by two Hubs', async () => {
    const { hubs, store } = await repo();
    await store.saveProject({ id: 'shared-project', name: 'A', projectPath: '/a', gitRootPath: '/a' });
    const second = await hubs.createHub('Second');
    await expect(hubs.hub(second.id).saveProject({ id: 'shared-project', name: 'B', projectPath: '/b', gitRootPath: '/b' })).rejects.toMatchObject({ code: 'PROJECT_ID_CONFLICT' });
  });

  it('tracks settings with their own revision', async () => {
    const { hubs, store } = await repo();
    await hubs.saveSettings({ worktreeBasePath: '/trees' }, 0);
    expect(store.snapshot().settings).toEqual({ worktreeBasePath: '/trees' });
    await expect(hubs.saveSettings({ worktreeBasePath: '/other' }, 0)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await hubs.saveSettings({}, 1);
    expect(store.snapshot().settings).toEqual({});
  });
});
