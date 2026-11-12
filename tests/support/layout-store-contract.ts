import { describe, expect, it } from 'vitest';
import { headToken, type BoardLog } from '../../src/domain/journal/log.js';
import type { BoardChange } from '../../src/domain/journal/event.js';
import type { SharedLayoutStore } from '../../src/host/sharing/ports.js';
import { genesisLog } from './board-log-fixture.js';

const NL = String.fromCharCode(10);
const AT = '2026-01-01T00:00:00.000Z';

export const CONTRACT_WORKFLOW = ['name: Delivery', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', ''].join(NL);

/** The identity events every contract fixture carries beside the workflow. */
export const CONTRACT_IDENTITY: readonly BoardChange[] = [
  { kind: 'board.renamed', name: 'delivery' },
  { kind: 'board.scope-changed', projectKeys: null },
  { kind: 'board.rank-changed', rank: 'i' },
];

/** A board log file as a storage keeps it. */
export function contractLog(text = CONTRACT_WORKFLOW): BoardLog {
  return genesisLog(text, CONTRACT_IDENTITY);
}

/**
 * The behaviour every storage must show through the published-layout ports. A
 * provider test runs this against its own store, so the four storages cannot drift.
 */
export type LayoutStoreFactory = () => SharedLayoutStore | Promise<SharedLayoutStore>;

export function describeLayoutStoreContract(name: string, factory: LayoutStoreFactory, emptyFactory?: LayoutStoreFactory): void {
  describe(name + ' published-layout contract', () => {
    it('serves the layout stamp and honours a matching write', async () => {
      const store = await factory();
      const first = await store.readStamp();
      expect(first).not.toBeNull();
      expect(first!.version).toBe(4);
      await expect(store.writeStamp(4, { expectedVersion: null })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
      expect(await store.writeStamp(4, { expectedVersion: first!.version })).toEqual({ version: 4 });
    });

    it('enumerates the published boards with a probe for each', async () => {
      const store = await factory();
      const listed = await store.listLogs();
      expect(listed.map(entry => entry.key)).toContain('delivery');
      for (const entry of listed) expect(await store.probe(entry.key)).toBe(entry.probe);
    });

    it('serves a board log with its probe and head', async () => {
      const store = await factory();
      const read = await store.readLog('delivery');
      expect(read).not.toBeNull();
      expect(read!.head).toBe(headToken(read!.log));
      expect(await store.probe('delivery')).toBe(read!.probe);
    });

    it('refuses a stale append and reports a new head after an accepted one', async () => {
      const store = await factory();
      const read = await store.readLog('delivery');
      const appended = await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: AT });
      expect(appended.log[appended.log.length - 1]!.seq).toBe(read!.log[read!.log.length - 1]!.seq + 1);
      expect(appended.head).toBe(headToken(appended.log));
      await expect(store.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: AT })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
    });

    it('changes the probe after an append', async () => {
      const store = await factory();
      const before = await store.probe('delivery');
      const read = await store.readLog('delivery');
      await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'Renamed' }], { expectedHead: read!.head, message: 'm', at: AT });
      expect(await store.probe('delivery')).not.toBe(before);
    });

    it('reports a board it has never stored', async () => {
      const store = await factory();
      expect(await store.probe('missing')).toBeNull();
      expect(await store.readLog('missing')).toBeNull();
    });

    it('creates a board log once and refuses to replace one', async () => {
      const store = await (emptyFactory === undefined ? factory() : emptyFactory());
      const key = 'fresh';
      const created = await store.createLog(key, contractLog());
      expect(created.log).toHaveLength(CONTRACT_IDENTITY.length + 1);
      expect(created.head).toBe(headToken(created.log));
      await expect(store.createLog(key, contractLog())).rejects.toThrow();
    });

    it('refuses an append to a board that has no log', async () => {
      const store = await (emptyFactory === undefined ? factory() : emptyFactory());
      await expect(store.appendChanges('delivery', [], { expectedHead: null, message: 'm', at: AT })).rejects.toThrow();
    });
  });
}
