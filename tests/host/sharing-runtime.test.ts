import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { SHARED_DOCUMENT_FILE } from '../../src/domain/sharing/document.js';
import { KanbanApp } from '../../src/host/app.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { suggestedFolderPath } from '../../src/host/sharing/local-folder-path.js';
import { openHubSharing } from '../../src/index.js';
import { MemoryHubStorage, TestGit, TestSessions } from './helpers.js';

function facility() {
  let closings = 0;
  const ctx = {
    storageDomain: {
      async open() {
        return {
          table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator](), keys: () => [][Symbol.iterator](), get size() { return 0; }, put: async () => {}, delete: async () => {}, update: async () => {} }),
          close: async () => { closings++; },
        };
      },
    },
  } as unknown as Context;
  return { ctx, get closings() { return closings; } };
}

const flow = (label: string): string => ['name: Flow', 'initial_column: backlog', 'columns:', '  - id: backlog', '    label: ' + label, ''].join('\n');

async function waitFor(read: () => Promise<string>, predicate: (value: string) => boolean, attempts = 100): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return read();
}

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('publishing runtime wiring', () => {
  it('opens the publishing domain and closes the domain and timers as one unit', async () => {
    vi.useFakeTimers();
    const f = facility();
    const hubs = await HubRepository.open(new MemoryHubStorage());
    const runtime = await openHubSharing(f.ctx, hubs, { root: '/tmp/dsh-sharing-runtime', report: () => {} });
    expect(runtime.service.views()).toEqual({});
    runtime.scheduler.sync();
    await runtime.close();
    expect(f.closings).toBe(1);
    await hubs.close();
  });

  it('composes the local folder storage with the injected home directory', async () => {
    const f = facility();
    const home = await mkdtemp(path.join(os.tmpdir(), 'kanban-folder-runtime-'));
    roots.push(home);
    const hubs = await HubRepository.open(new MemoryHubStorage());
    const runtime = await openHubSharing(f.ctx, hubs, { root: '/tmp/dsh-sharing-runtime', home, report: () => {} });
    const hubId = hubs.defaultHubId();
    const suggested = suggestedFolderPath(hubId, { home });

    await runtime.service.connect({ type: 'sharing.connect', hubId, provider: 'local-folder', settings: { path: suggested }, intervalMinutes: 1 });

    expect(runtime.service.view(hubId)).toMatchObject({ provider: 'local-folder', syncMode: 'continuous', status: 'published' });
    expect(await readFile(path.join(suggested, SHARED_DOCUMENT_FILE), 'utf8')).toContain('version: 1');
    await runtime.close();
    await hubs.close();
  });

  it('synchronizes an application board save and stops after disconnect', async () => {
    const f = facility();
    const home = await mkdtemp(path.join(os.tmpdir(), 'kanban-folder-runtime-'));
    roots.push(home);
    const hubs = await HubRepository.open(new MemoryHubStorage());
    const runtime = await openHubSharing(f.ctx, hubs, { root: '/tmp/dsh-sharing-runtime', home, report: () => {}, debounceMs: 5 });
    const app = new KanbanApp(hubs, new TestSessions(), new TestGit(), { sharing: runtime.service, report: () => {} });
    runtime.setNotify(() => app.sharingChanged());
    const hubId = hubs.defaultHubId();
    const boardId = hubs.requireHub(hubId).boards[0]!.id;
    const document = path.join(home, '.dsh-kanban', hubId, SHARED_DOCUMENT_FILE);
    const read = async (): Promise<string> => readFile(document, 'utf8');

    await runtime.service.connect({ type: 'sharing.connect', hubId, provider: 'local-folder', settings: { path: suggestedFolderPath(hubId, { home }) }, intervalMinutes: 1 });

    await app.command({ type: 'board.workflow.save', hubId, boardId, yaml: flow('local'), expectedRevision: hubs.requireHub(hubId).revision });
    const synchronized = await waitFor(read, value => value.includes('label: local'));
    expect(synchronized).toContain('label: local');

    await runtime.service.disconnect(hubId);
    const published = await read();
    await app.command({ type: 'board.workflow.save', hubId, boardId, yaml: flow('later'), expectedRevision: hubs.requireHub(hubId).revision });
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(await read()).toBe(published);

    await runtime.close();
    await hubs.close();
  });
});
