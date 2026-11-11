import { describe, expect, it } from 'vitest';
import { readSharedConfiguration, serializeSharedManifest, sharedManifestToken, type SharedHubManifest } from '../../src/domain/sharing/manifest.js';
import { createBoardLog, encodeBoardLog, headToken } from '../../src/domain/journal/log.js';
import { unseenEvents } from '../../src/host/sharing/ports.js';
import type { SharedLayoutStore } from '../../src/host/sharing/ports.js';

const NL = String.fromCharCode(10);
const AT = '2026-01-01T00:00:00.000Z';

export const CONTRACT_WORKFLOW = ['name: Delivery', 'columns:', '  - id: backlog', '    key: s1', '    label: Backlog', ''].join(NL);

/** The manifest every contract fixture starts from. */
export function contractManifest(keys: readonly string[] = ['delivery']): SharedHubManifest {
  return { version: 3, boards: keys.map(key => ({ key, name: key })) };
}

/** A board log file as a storage keeps it. */
export function storedBoardLog(text: string): string {
  return JSON.stringify(encodeBoardLog(createBoardLog(text)));
}

/**
 * The behaviour every storage must show through the published-layout ports. A
 * provider test runs this against its own store, so the four storages cannot drift.
 */
export type LayoutStoreFactory = () => SharedLayoutStore | Promise<SharedLayoutStore>;

export function describeLayoutStoreContract(name: string, factory: LayoutStoreFactory, emptyFactory?: LayoutStoreFactory): void {
  describe(name + ' published-layout contract', () => {
    it('serves a manifest with its token and honours a matching cache', async () => {
      const store = await factory();
      const first = await store.readManifest();
      expect(first).not.toBeNull();
      expect(first!.token).toBe(sharedManifestToken(first!.manifest));
      expect(await store.readManifest(undefined, first)).toBe(first);
    });

    it('refuses a stale manifest write and accepts a matching one', async () => {
      const store = await factory();
      const read = await store.readManifest();
      await expect(store.writeManifest(contractManifest(['delivery', 'ops']), { expectedToken: null, message: 'm' })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
      const written = await store.writeManifest(contractManifest(['delivery', 'ops']), { expectedToken: read!.token, message: 'm' });
      expect(written.token).toBe(sharedManifestToken(contractManifest(['delivery', 'ops'])));
      const after = await store.readManifest();
      expect(after!.manifest.boards.map(board => board.key)).toEqual(['delivery', 'ops']);
      expect(after!.manifest).toEqual(readSharedConfiguration(serializeSharedManifest(contractManifest(['delivery', 'ops']))).manifest);
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
      expect(appended.log.events.map(event => event.seq)).toEqual([1]);
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

    it('reports only the events a cursor has not seen', async () => {
      const store = await factory();
      const read = await store.readLog('delivery');
      const appended = await store.appendChanges('delivery', [
        { kind: 'workflow.field-changed', field: 'name', value: 'One' },
        { kind: 'workflow.field-changed', field: 'name', value: 'Two' },
      ], { expectedHead: read!.head, message: 'm', at: AT });
      expect(unseenEvents(appended, 1).map(event => event.seq)).toEqual([2]);
      expect(unseenEvents(appended, 2)).toEqual([]);
    });

    it('reports a board it has never stored', async () => {
      const store = await factory();
      expect(await store.probe('missing')).toBeNull();
      expect(await store.readLog('missing')).toBeNull();
    });

    it('creates a board log once and refuses to replace one', async () => {
      const store = await (emptyFactory === undefined ? factory() : emptyFactory());
      const key = 'fresh';
      const created = await store.createLog(key, CONTRACT_WORKFLOW);
      expect(created.log.snapshot.text).toBe(CONTRACT_WORKFLOW);
      expect(created.head).toBe(headToken(created.log));
      await expect(store.createLog(key, CONTRACT_WORKFLOW)).rejects.toThrow();
    });

    it('refuses an append against a head that no longer matches', async () => {
      const store = await factory();
      const read = await store.readLog('delivery');
      await store.appendChanges('delivery', [{ kind: 'workflow.field-changed', field: 'name', value: 'One' }], { expectedHead: read!.head, message: 'm', at: AT });
      await expect(store.appendChanges('delivery', [], { expectedHead: read!.head, message: 'm', at: AT })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_STALE_TOKEN' }));
    });

    if (emptyFactory !== undefined) {
      it('refuses an append to a board that has no log', async () => {
        const store = await emptyFactory();
        expect(await store.readLog('delivery')).toBeNull();
        await expect(store.appendChanges('delivery', [], { expectedHead: null, message: 'm', at: AT })).rejects.toThrow();
      });
    }
  });
}
