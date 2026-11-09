import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { sharedDocumentToken, type SharedHubDocument } from '../../src/domain/sharing/document.js';
import { SHARING_STORAGES } from '../../src/shared/types.js';
import { migrateSharingRecord, openSharingStorage, type HubSharingRecord } from '../../src/host/sharing/state.js';

const NOW = '2026-01-01T00:00:00.000Z';
const document: SharedHubDocument = { version: 2, boards: [{ key: 'kanban', name: 'Kanban', workflow: 'name: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog\n' }] };
function record(hubId: string): HubSharingRecord {
  // Stored tokens are the document's canonical content identity, so a normalized
  // read returns exactly what was written.
  const token = sharedDocumentToken(document);
  return {
    version: 2, hubId,
    binding: { provider: 'git', intervalMinutes: 5, settings: { repository: '/team/repo' } },
    providerState: {}, syncedRevision: null,
    base: { token, document }, seen: { token, document },
    bindings: { board: 'kanban' }, orphans: {}, removed: {}, pendingRemovals: [], preview: null,
    lastCheck: { at: NOW, token }, lastError: null,
  };
}

function facility() {
  const tables = new Map<string, Map<string, unknown>>();
  const ctx = {
    storageDomain: {
      async open(spec: { name: string }) {
        let table = tables.get(spec.name);
        if (!table) { table = new Map(); tables.set(spec.name, table); }
        const current = table;
        return {
          table: () => ({
            get: (key: string) => current.get(key),
            entries: () => current.entries(),
            keys: () => current.keys(),
            get size() { return current.size; },
            put: async (key: string, value: unknown) => { current.set(key, structuredClone(value)); },
            delete: async (key: string) => { current.delete(key); },
            update: async () => { throw new Error('unused'); },
          }),
          close: async () => {},
        };
      },
    },
  } as unknown as Context;
  return { tables, ctx };
}

describe('publishing state storage', () => {
  it('declares its own per-record domain and round-trips a record across opens', async () => {
    const { ctx } = facility();
    const first = await openSharingStorage(ctx);
    await first.storage.save(record('hub'));
    expect(first.storage.load('hub')).toEqual(record('hub'));
    await first.close();

    const second = await openSharingStorage(ctx);
    expect(second.storage.load('hub')).toEqual(record('hub'));
    expect(second.storage.list()).toHaveLength(1);
    await second.storage.delete('hub');
    expect(second.storage.list()).toHaveLength(0);
    await second.close();
  });

  it('normalizes a stored version one document instead of dropping the record', async () => {
    const { tables, ctx } = facility();
    const legacy = record('hub');
    const old = { version: 1, boards: [{ key: 'kanban', name: 'Kanban', workflow: document.boards[0]!.workflow }] } as unknown as SharedHubDocument;
    legacy.base = { token: 'base', document: old };
    legacy.seen = { token: 'seen', document: old };
    legacy.orphans = { gone: { lastKey: 'gone', lastPublishedName: 'Gone' } };
    legacy.removed = { kanban: { boardId: 'board', name: 'Kanban' } };
    legacy.pendingRemovals = ['kanban'];
    const raw = tables.get('kanban_sharing') ?? new Map<string, unknown>();
    raw.set('hub', structuredClone(legacy));
    tables.set('kanban_sharing', raw);
    const reported: unknown[] = [];
    const opened = await openSharingStorage(ctx, { report: error => reported.push(error) });
    const loaded = opened.storage.load('hub');
    expect(reported).toEqual([]);
    expect(loaded?.base?.document.version).toBe(2);
    expect(loaded?.seen?.document.version).toBe(2);
    expect(loaded?.bindings).toEqual({ board: 'kanban' });
    expect(loaded?.orphans).toEqual({ gone: { lastKey: 'gone', lastPublishedName: 'Gone' } });
    expect(loaded?.removed).toEqual({ kanban: { boardId: 'board', name: 'Kanban' } });
    expect(loaded?.pendingRemovals).toEqual(['kanban']);
    await opened.close();
  });

  it('keeps an unsupported stored document blocked instead of downgrading it', async () => {
    const { tables, ctx } = facility();
    const newer = record('hub');
    const future = { version: 3, boards: [] } as unknown as SharedHubDocument;
    newer.base = { token: 'base', document: future };
    newer.seen = { token: 'seen', document: future };
    const raw = tables.get('kanban_sharing') ?? new Map<string, unknown>();
    raw.set('hub', structuredClone(newer));
    tables.set('kanban_sharing', raw);
    const reported: unknown[] = [];
    const opened = await openSharingStorage(ctx, { report: error => reported.push(error) });
    const loaded = opened.storage.load('hub');
    expect(reported).toEqual([]);
    expect(loaded?.base).toBeNull();
    expect(loaded?.seen).toBeNull();
    expect(loaded?.bindings).toEqual({ board: 'kanban' });
    expect(loaded?.lastError).toMatchObject({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' });
    await opened.close();
  });

  it('quarantines a corrupt record instead of failing the whole domain', async () => {
    const { tables, ctx } = facility();
    const valid = record('hub');
    const raw = tables.get('kanban_sharing') ?? new Map<string, unknown>();
    raw.set('hub', structuredClone(valid));
    raw.set('broken', { version: 1, hubId: 'broken' });
    tables.set('kanban_sharing', raw);
    const reported: unknown[] = [];
    const opened = await openSharingStorage(ctx, { report: error => reported.push(error) });
    expect(opened.storage.load('hub')).toEqual(valid);
    expect(opened.storage.load('broken')).toBeUndefined();
    expect(reported[0]).toMatchObject({ code: 'SHARING_STORAGE_INVALID' });
    await opened.close();
  });

  it('quarantines a record whose stored document is semantically invalid', async () => {
    const { tables, ctx } = facility();
    const invalid = record('bad');
    invalid.base = { token: 'x', document: { version: 2, boards: [
      { key: 'a', name: 'Same', workflow: document.boards[0]!.workflow },
      { key: 'b', name: 'same', workflow: document.boards[0]!.workflow },
    ] } };
    const raw = tables.get('kanban_sharing') ?? new Map<string, unknown>();
    raw.set('bad', structuredClone(invalid));
    tables.set('kanban_sharing', raw);
    const reported: unknown[] = [];
    const opened = await openSharingStorage(ctx, { report: error => reported.push(error) });
    expect(opened.storage.load('bad')).toBeUndefined();
    expect(reported[0]).toMatchObject({ code: 'SHARING_STORAGE_INVALID' });
    await opened.close();
  });

  it('refuses to persist an invalid record', async () => {
    const { ctx } = facility();
    const opened = await openSharingStorage(ctx);
    await expect(opened.storage.save({ ...record('hub'), hubId: '' })).rejects.toMatchObject({ code: 'SHARING_STORAGE_INVALID' });
    await opened.close();
  });

  it('accepts every declared storage and refuses an undeclared one', () => {
    for (const provider of SHARING_STORAGES) {
      const value = record('hub');
      value.binding = { provider, intervalMinutes: 1, settings: {} };
      expect(migrateSharingRecord(value)).toMatchObject({ binding: { provider } });
    }
    const unknown = record('hub');
    unknown.binding = { provider: 'ftp' as never, intervalMinutes: 1, settings: {} };
    expect(migrateSharingRecord(unknown)).toBeUndefined();
  });
});


describe('publishing state migration', () => {
  it('migrates a v1 Git record without losing state', () => {
    const legacy = {
      version: 1, hubId: 'hub',
      binding: { provider: 'git', repository: '/team/repo', intervalMinutes: 5 },
      base: { token: 'base', document }, seen: { token: 'seen', document },
      bindings: { board: 'kanban' }, orphans: {}, removed: {}, pendingRemovals: [], preview: null,
      lastCheck: { at: NOW, token: 'seen' }, lastError: null,
    };
    expect(migrateSharingRecord(legacy)).toMatchObject({
      version: 2, hubId: 'hub',
      binding: { provider: 'git', intervalMinutes: 5, settings: { repository: '/team/repo' } },
      providerState: {}, syncedRevision: null,
      bindings: { board: 'kanban' }, lastCheck: { at: NOW, token: 'seen' },
    });
  });
});
