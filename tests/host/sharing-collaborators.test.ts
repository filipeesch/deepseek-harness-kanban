import { describe, expect, it } from 'vitest';
import { KanbanError } from '../../src/shared/errors.js';
import { SHARED_LAYOUT_VERSION } from '../../src/domain/sharing/layout.js';
import { LayoutStampPolicy } from '../../src/host/sharing/sync/stamp.js';
import { foldIdentity, isTombstoned, NO_IDENTITY, appliedPreset, identityName, mirrorIdentity } from '../../src/host/sharing/sync/identity.js';
import { compareNullableRanks, reorderBoundBoards } from '../../src/host/sharing/sync/order.js';
import { emptyBoard, type HubSharingRecord } from '../../src/host/sharing/state.js';
import { BoardObserver } from '../../src/host/sharing/sync/observer.js';
import { BoardApplier } from '../../src/host/sharing/sync/applier.js';
import { BoardRemoval } from '../../src/host/sharing/sync/removal.js';
import { ConnectionOperations } from '../../src/host/sharing/sync/connection.js';
import type { SharingSession } from '../../src/host/sharing/sync/session.js';
import type { SharedLayoutStore } from '../../src/host/sharing/ports.js';
import type { BoardLog } from '../../src/domain/journal/log.js';
import { EmptyLayoutStore } from './sharing-stubs.js';

const AT = '2026-01-02T00:00:00.000Z';

describe('layout stamp policy', () => {
  const policy = new LayoutStampPolicy();

  it('writes the current stamp into an empty storage', async () => {
    const layout = new EmptyLayoutStore();
    await policy.ensure(layout);
    expect(layout.stampVersion).toBe(SHARED_LAYOUT_VERSION);
  });

  it('replaces an older stamp and refuses a newer one', async () => {
    const older = new EmptyLayoutStore(SHARED_LAYOUT_VERSION - 1);
    await policy.ensure(older);
    expect(older.stampVersion).toBe(SHARED_LAYOUT_VERSION);
    const newer = new EmptyLayoutStore(SHARED_LAYOUT_VERSION + 1);
    await expect(policy.ensure(newer)).rejects.toMatchObject({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' });
    expect(newer.stampVersion).toBe(SHARED_LAYOUT_VERSION + 1);
  });

  it('names the problem a stamp states', () => {
    expect(policy.versionProblem(SHARED_LAYOUT_VERSION + 1).code).toBe('SHARING_DOCUMENT_VERSION_UNSUPPORTED');
    expect(policy.versionProblem(SHARED_LAYOUT_VERSION - 1).code).toBe('SHARING_LAYOUT_OUTDATED');
  });
});

describe('board identity folding', () => {
  it('folds every board metadata event, including the recorded default', () => {
    const identity = foldIdentity(NO_IDENTITY, [
      { kind: 'board.renamed', name: 'Delivery', seq: 0, at: AT, v: 3 },
      { kind: 'board.scope-changed', projectKeys: ['app'], seq: 1, at: AT, v: 3 },
      { kind: 'board.rank-changed', rank: 'i5', seq: 2, at: AT, v: 3 },
      { kind: 'board.preset-changed', mode: 'host', seq: 3, at: AT, v: 6 },
    ]);
    expect(identity).toEqual({ name: 'Delivery', projectKeys: ['app'], rank: 'i5', presetMode: 'host' });
  });

  it('clears a recorded default with a null event', () => {
    const cleared = foldIdentity({ ...NO_IDENTITY, presetMode: 'operator' }, [{ kind: 'board.preset-changed', mode: null, seq: 0, at: AT, v: 6 }]);
    expect(cleared.presetMode).toBeNull();
  });

  it('reads a whole log independently of a checkpoint', () => {
    const log = [
      { kind: 'workflow.replaced', text: 'name: A' + String.fromCharCode(10) + 'columns: []', seq: 0, at: AT, v: 3 },
      { kind: 'board.renamed', name: 'Delivery', seq: 1, at: AT, v: 3 },
      { kind: 'board.preset-changed', mode: 'operator', seq: 2, at: AT, v: 6 },
      { kind: 'workflow.replaced', text: 'name: B' + String.fromCharCode(10) + 'columns: []', seq: 3, at: AT, v: 3 },
    ] as never;
    expect(identityName(log)).toBe('Delivery');
    expect(appliedPreset(log)).toBe('operator');
  });

  it('treats a board republished after a removal as live', () => {
    const removed = [{ kind: 'workflow.replaced', text: 'name: A' + String.fromCharCode(10) + 'columns: []', seq: 0, at: AT, v: 3 }, { kind: 'board.removed', seq: 1, at: AT, v: 3 }] as never;
    expect(isTombstoned(removed)).toBe(true);
    expect(isTombstoned([...removed, { kind: 'workflow.replaced', text: 'name: A' + String.fromCharCode(10) + 'columns: []', seq: 2, at: AT, v: 3 }] as never)).toBe(false);
  });

  it('states the mirror identity from an applied record', () => {
    expect(mirrorIdentity({ ...emptyBoard(), name: 'Delivery', projectKeys: null, rank: 'i', presetMode: 'operator' })).toEqual({ name: 'Delivery', projectKeys: null, rank: 'i', presetMode: 'operator' });
    expect(mirrorIdentity(emptyBoard())).toEqual(NO_IDENTITY);
  });
});

describe('board order', () => {
  it('orders a positioned board before an unpositioned one', () => {
    expect(compareNullableRanks('i', null)).toBeLessThan(0);
    expect(compareNullableRanks(null, null)).toBe(0);
  });

  it('reorders the bound boards and leaves unbound ones in place', () => {
    const draft = { boards: [{ id: 'a' }, { id: 'free' }, { id: 'b' }] };
    const boards = { keyA: { ...emptyBoard(), rank: 'i5' }, keyB: { ...emptyBoard(), rank: 'i' } };
    reorderBoundBoards(draft, { a: 'keyA', b: 'keyB' }, boards);
    expect(draft.boards.map(board => board.id)).toEqual(['b', 'free', 'a']);
  });
});

describe('board observation', () => {
  function session(hub: unknown): SharingSession {
    return { options: { hubs: { requireHub: () => hub } }, save: async () => {} } as unknown as SharingSession;
  }

  function layout(logs: Record<string, BoardLog | 'unreadable'>, probes: Record<string, string>): SharedLayoutStore {
    return {
      listLogs: async () => Object.keys(logs).map(key => ({ key, probe: probes[key] ?? 'p' })),
      readLog: async (key: string) => {
        const value = logs[key];
        if (value === undefined) return null;
        if (value === 'unreadable') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'The team configuration was written by a newer plugin version.');
        return { probe: probes[key] ?? 'p', head: 'h-' + key, log: value };
      },
    } as unknown as SharedLayoutStore;
  }

  const genesis = [{ kind: 'workflow.replaced', text: 'name: Board' + String.fromCharCode(10) + 'columns: []', seq: 0, at: AT, v: 3 }] as never;

  it('marks only the unreadable board as requiring a plugin update', async () => {
    const record = { hubId: 'hub', bindings: {}, boards: {}, published: {} } as unknown as HubSharingRecord;
    const observed = await new BoardObserver(session({ boards: [] }), new LayoutStampPolicy()).observe(
      record,
      layout({ newer: 'unreadable', live: genesis }, { newer: 'p1', live: 'p2' }),
    );
    expect(observed.boards.newer?.problem).toMatchObject({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' });
    expect(observed.boards.live?.problem).toBeUndefined();
    expect(observed.published.live).toBeDefined();
    expect(observed.published.newer).toBeDefined();
  });

  it('clears the recorded plugin-update state of an unbound board that now reads', async () => {
    const problem = { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'This board log was written by a newer plugin version.' };
    const named = [...(genesis as unknown as unknown[]), { kind: 'board.renamed', name: 'Newer board', seq: 1, at: AT, v: 3 }] as never;
    const record = {
      hubId: 'hub', bindings: {}, published: { newer: { key: 'newer', name: 'Newer', rank: null, removed: false } },
      boards: { newer: { ...emptyBoard(), probe: 'p1', present: true, problem } },
    } as unknown as HubSharingRecord;
    const observer = new BoardObserver(session({ boards: [] }), new LayoutStampPolicy());
    const store = layout({ newer: named }, { newer: 'p2' });
    const observed = await observer.observe(record, store);
    expect(observed.published.newer).toBeDefined();
    expect(observed.boards.newer?.problem).toBeNull();
    expect(observed.boards.newer?.present).toBe(true);
    // The recovered board carries the identity the read found, so the next check — which
    // short-circuits on the unchanged probe — still reports the team's name, not the key.
    expect(observed.boards.newer?.name).toBe('Newer board');
    expect(observed.published.newer?.name).toBe('Newer board');
    const next = await observer.observe({ ...record, boards: observed.boards, published: observed.published }, store);
    expect(next.published.newer?.name).toBe('Newer board');
  });

  it('reports an unbound tombstone as removed without reading a board', async () => {
    const removed = [...(genesis as unknown as unknown[]), { kind: 'board.removed', seq: 1, at: AT, v: 3 }] as never;
    const record = { hubId: 'hub', bindings: {}, boards: {}, published: {} } as unknown as HubSharingRecord;
    const observed = await new BoardObserver(session({ boards: [] }), new LayoutStampPolicy()).observe(record, layout({ gone: removed }, { gone: 'p1' }));
    expect(observed.published.gone).toMatchObject({ removed: true });
    expect(observed.boards.gone).toBeUndefined();
  });
});

describe('connection operations', () => {
  const genesis = [{ kind: 'workflow.replaced', text: 'name: Board' + String.fromCharCode(10) + 'columns: []', seq: 0, at: AT, v: 3 }] as never;

  function connection(hub: unknown, saved: HubSharingRecord[] = []) {
    const session = {
      options: { hubs: { requireHub: () => hub } },
      now: () => AT,
      save: async (record: HubSharingRecord) => { saved.push(record); },
      layoutFor: () => { throw new Error('unused'); },
      report: () => {},
    } as unknown as SharingSession;
    return new ConnectionOperations(session, { applyAll: async () => {} }, { publishAll: async () => {}, publishBoardNow: async () => {} }, new LayoutStampPolicy());
  }

  function layout(logs: Record<string, BoardLog | 'unreadable'>): SharedLayoutStore {
    return {
      listLogs: async () => Object.keys(logs).map(key => ({ key, probe: 'p' })),
      readLog: async (key: string) => {
        const value = logs[key];
        if (value === undefined) return null;
        if (value === 'unreadable') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'This board log was written by a newer plugin version.');
        return { probe: 'p', head: 'h-' + key, log: value };
      },
    } as unknown as SharedLayoutStore;
  }

  it('offers the readable boards of a storage that also holds a newer one', async () => {
    const record = { hubId: 'hub', bindings: {}, boards: {}, published: {} } as unknown as HubSharingRecord;
    const preview = await connection({ boards: [] }).readPreview(record, layout({ live: genesis, newer: 'unreadable' }));
    expect(preview.map(entry => entry.key)).toEqual(['live']);
  });

  it('tombstones the readable boards and remembers the one it cannot read', async () => {
    const saved: HubSharingRecord[] = [];
    const appended: string[] = [];
    const logs: Record<string, BoardLog | 'unreadable'> = { live: genesis, newer: 'unreadable' };
    const store = {
      readStamp: async () => ({ version: SHARED_LAYOUT_VERSION }),
      writeStamp: async (version: number) => ({ version }),
      listLogs: async () => Object.keys(logs).map(key => ({ key, probe: 'p' })),
      readLog: async (key: string) => {
        const value = logs[key];
        if (value === undefined) return null;
        if (value === 'unreadable') throw new KanbanError('SHARING_DOCUMENT_VERSION_UNSUPPORTED', 'This board log was written by a newer plugin version.');
        return { probe: 'p', head: 'h-' + key, log: value };
      },
      appendChanges: async (key: string) => { appended.push(key); return { probe: 'p2', head: 'h2', log: genesis }; },
    } as unknown as SharedLayoutStore;
    const session = {
      options: { hubs: { requireHub: () => ({ boards: [] }) } },
      now: () => AT,
      save: async (record: HubSharingRecord) => { saved.push(record); },
      layoutFor: () => store,
      report: () => {},
    } as unknown as SharingSession;
    const published = { key: 'live', name: 'Live', rank: 'i', removed: false };
    const record = { hubId: 'hub', bindings: {}, boards: {}, published: { live: published }, preview: { boards: [] }, orphans: {}, removed: {}, pendingRemovals: {} } as unknown as HubSharingRecord;
    const connection = new ConnectionOperations(session, { applyAll: async () => {} }, { publishAll: async () => {}, publishBoardNow: async () => {} }, new LayoutStampPolicy());
    await connection.publishInitial(record);
    expect(appended).toEqual(['live']);
    expect(saved[0]!.published.live).toMatchObject({ removed: true });
    expect(saved[0]!.boards.newer?.problem).toMatchObject({ code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED' });
    expect(saved[0]!.boards.newer?.present).toBe(true);
  });

  it('binds local boards by name and keeps the preview identity', async () => {
    const hub = { boards: [{ id: 'board', name: 'Board' }, { id: 'other', name: 'Other' }] };
    const record = {
      hubId: 'hub', bindings: { other: 'team-other' }, boards: {}, published: {},
      preview: { boards: [{ key: 'team-board', name: 'Board', projectKeys: null, rank: 'i', workflow: 'name: Board' }] },
    } as unknown as HubSharingRecord;
    const next = await connection(hub).receivePreview(record);
    expect(next.bindings).toEqual({ other: 'team-other', board: 'team-board' });
    expect(next.published['team-board']).toMatchObject({ name: 'Board', rank: 'i', removed: false });
    expect(next.preview).toBeNull();
  });
});

describe('applying every board', () => {
  it('skips a board that needs a plugin update and applies the others', async () => {
    const record = {
      hubId: 'hub', bindings: { board: 'readable' },
      published: { newer: { key: 'newer', name: 'Newer', rank: null, removed: false }, readable: { key: 'readable', name: 'Readable', rank: 'i', removed: false } },
      boards: { newer: { ...emptyBoard(), present: true, problem: { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'newer' } }, readable: { ...emptyBoard(), present: true } },
    } as unknown as HubSharingRecord;
    const session = {
      requireRecord: () => record,
      assertReady: () => {},
      layoutFor: () => ({}),
    } as unknown as SharingSession;
    const observer = { refresh: async () => record } as unknown as BoardObserver;
    const applier = new BoardApplier(session, observer);
    const applied: string[] = [];
    (applier as unknown as { applyKey: (value: HubSharingRecord, key: string, alsoRefresh?: boolean) => Promise<void> }).applyKey = async (_value, key) => { applied.push(key); };
    await applier.applyAll('hub');
    expect(applied).toEqual(['readable']);
  });
});

describe('removals owed to the team', () => {
  function removal(options: { read?: () => Promise<unknown> } = {}) {
    const saved: HubSharingRecord[] = [];
    const appended: unknown[] = [];
    const session = {
      layoutFor: () => ({
        readLog: options.read ?? (async () => ({ probe: 'p', head: 'h', log: [] })),
        appendChanges: async (key: string, changes: unknown) => { appended.push({ key, changes }); return { probe: 'p2', head: 'h2', log: [] }; },
      }),
      now: () => AT,
      report: () => {},
      save: async (record: HubSharingRecord) => { saved.push(record); },
    } as unknown as SharingSession;
    return { service: new BoardRemoval(session, { applyKey: async () => {} }), saved, appended };
  }

  const record = {
    hubId: 'hub', pendingRemovals: { gone: { name: 'Gone' } }, published: { gone: { key: 'gone', name: 'Gone', rank: null, removed: false } },
  } as unknown as HubSharingRecord;

  it('retries one owed removal and clears it', async () => {
    const f = removal();
    const next = await f.service.flushPendingRemovals(record);
    expect(f.appended).toHaveLength(1);
    expect(next.pendingRemovals).toEqual({});
    expect(next.published.gone).toBeUndefined();
    expect(f.saved).toHaveLength(1);
  });

  it('keeps the removal owed while the storage refuses it', async () => {
    const f = removal({ read: async () => { throw new KanbanError('SHARING_FAILED', 'storage is unreachable'); } });
    const next = await f.service.flushPendingRemovals(record);
    expect(f.appended).toHaveLength(0);
    expect(next.pendingRemovals).toEqual({ gone: { name: 'Gone' } });
    expect(next.published.gone).toBeDefined();
  });
});

describe('sharing session guards', () => {
  it('refuses every operation while the storage requires a review', async () => {
    const { SharingSession } = await import('../../src/host/sharing/sync/session.js');
    const session = new SharingSession({} as never);
    const record = { storageReview: { code: 'SHARING_CONCURRENT_WRITE', message: 'review', files: [] }, reviewRequired: null } as unknown as HubSharingRecord;
    expect(() => session.assertReady(record)).toThrow(expect.objectContaining({ code: 'SHARING_CONCURRENT_WRITE' }));
    expect(() => session.assertReady({ ...record, storageReview: null })).not.toThrow();
    expect(record).toBeDefined();
    expect(new KanbanError('X', 'y').code).toBe('X');
  });
});
